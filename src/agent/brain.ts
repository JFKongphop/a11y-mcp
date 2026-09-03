import { chat, type ChatMessage, type ToolSpec } from './openai';
import { showStatus } from './status';
import { postToIsolated } from '../content/bridge';

// The agent brain (MAIN world). Turns a Thai voice command into typed WebMCP tool
// calls: it reads the page's own registered tools via document.modelContext, lets
// GPT decide which to call, executes them, and speaks back in Thai.
//
// It supports a multi-turn conversation: the mic re-opens after the agent asks a
// question, so a clarification is a real spoken dialogue. Error / needs_human
// speech still comes from our Thai templates (in each tool result), never from
// model prose — the same failure must sound the same every time. Free narration
// (reading the form aloud, asking a question) is written by GPT in Thai.

function mc(): any {
  return (document as any).modelContext;
}

/** executeTool returns a JSON string of { content:[{type,text}] }; unwrap to the inner text. */
async function execTool(tool: any, argsJson: string): Promise<string> {
  const raw = await mc().executeTool(tool, argsJson);
  try {
    return JSON.parse(raw).content[0].text;
  } catch {
    return typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
}

function systemPrompt(formJson: string): string {
  return [
    'You are a Thai-speaking accessibility assistant that operates an HTML form on this page',
    'through typed tools (WebMCP), for a user who may be blind or may not read the page language.',
    'The user speaks Thai. The form structure (from describe_form) is:',
    formJson,
    '',
    'IMPORTANT: any plain text you reply with is SPOKEN ALOUD to the user, so write it in short,',
    'natural, spoken Thai — never English, never JSON, never markdown.',
    '',
    'Behaviours:',
    '- FILL: call fill_form; the keys of `values` are field ids from the structure above.',
    '  Preserve as typed (do NOT translate): email, phone, numbers, dates, passport/national-id,',
    '  and person names (keep Latin script). Translate Thai free text (e.g. purpose) into English.',
    '  For <select> fields use one of the given option values or labels.',
    '- READ / EXPLAIN: if the user asks to hear, read, or explain the form, call read_form, then',
    '  reply with a concise spoken-Thai summary of each field and whether it is required.',
    '- SELF-CORRECT: if fill_form returns a `failed` item you can fix (pattern_mismatch,',
    '  out_of_range, too_long, too_short, not_an_option), use its `expected` to fix the value and',
    '  call fill_form again for that field (up to two retries). Do not ask the user about a fixable failure.',
    '- ASK FOR MISSING: if a `failed` item is `required_missing` (a required field the user has not',
    '  given), ask the user ONE short spoken-Thai question for that field, then fill it from their answer.',
    '- CLARIFY UNLABELED: if fill_form returns items in `needs_human`, ask the user ONE short',
    '  spoken-Thai question naming that field. When the user answers, call fill_form again with the',
    '  value AND list that field id in `confirmed` so it is allowed to fill.',
    '  Ask about only ONE missing/unclear field per reply, the most important first.',
    '- SUBMIT: call submit_form ONLY if the user explicitly asks to submit or send. Never otherwise.',
    '- If you are unsure what a field means and the user has not told you, leave it out.',
  ].join('\n');
}

interface FillResult {
  filled?: string[];
  failed?: { reason?: string; message_th?: string }[];
  needs_human?: { field: string; label: string }[];
}

let running = false;
// Conversation persists across mic turns so a clarification answer has context.
let conversation: ChatMessage[] | null = null;

export async function runAgent(transcript: string): Promise<void> {
  if (running) return; // one command at a time (Paxa is concurrency-1 anyway)
  if (!mc()) {
    showStatus('WebMCP ไม่พร้อมใช้งานบนหน้านี้');
    return;
  }
  running = true;
  showStatus(`ได้ยิน: ${transcript}\nกำลังคิด…`);

  try {
    const registered = await mc().getTools();
    const byName: Record<string, any> = Object.fromEntries(registered.map((t: any) => [t.name, t]));
    const tools: ToolSpec[] = registered.map((t: any) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        // getTools() returns inputSchema as a JSON string; OpenAI wants an object.
        parameters:
          typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema,
      },
    }));

    if (!conversation || conversation.length > 24) {
      const formJson = byName.describe_form ? await execTool(byName.describe_form, '{}') : '{}';
      conversation = [{ role: 'system', content: systemPrompt(formJson) }];
    }
    conversation.push({ role: 'user', content: transcript });

    let lastFill: FillResult | null = null;
    let finalText: string | null = null;

    for (let turn = 0; turn < 5; turn++) {
      const msg = await chat(conversation, tools);
      conversation.push(msg);
      if (!msg.tool_calls?.length) {
        finalText = msg.content;
        break;
      }

      for (const call of msg.tool_calls) {
        const tool = byName[call.function.name];
        let argsJson = call.function.arguments || '{}';

        // Coerce fill_form values to strings so page-side validation accepts them
        // even when the model emits a number (e.g. stay_days: 14).
        if (call.function.name === 'fill_form') {
          try {
            const a = JSON.parse(argsJson);
            if (a?.values) for (const k of Object.keys(a.values)) a.values[k] = String(a.values[k]);
            argsJson = JSON.stringify(a);
          } catch {
            /* leave as-is */
          }
        }

        const resultText = tool
          ? await execTool(tool, argsJson)
          : JSON.stringify({ error: 'unknown_tool' });

        if (call.function.name === 'fill_form') {
          try {
            lastFill = JSON.parse(resultText);
          } catch {
            /* ignore */
          }
        }

        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: resultText,
        });
      }
    }

    // Compose the spoken reply. When GPT produced text (a question or a form
    // read-back), that covers everything — speak it (plus a filled count). When it
    // did not, fall back to our Thai templates for errors / needs_human.
    const parts: string[] = [];
    if (lastFill?.filled?.length) parts.push(`กรอกข้อมูลแล้ว ${lastFill.filled.length} ช่อง`);
    if (finalText) {
      parts.push(finalText);
    } else {
      for (const f of lastFill?.failed ?? []) if (f.message_th) parts.push(f.message_th);
      for (const n of lastFill?.needs_human ?? []) parts.push(`ช่อง ${n.label} ไม่แน่ใจ กรุณาระบุด้วยตนเอง`);
    }

    const speech = parts.join(' ');
    if (speech) {
      postToIsolated({ type: 'speak', text: speech });
      showStatus(`ได้ยิน: ${transcript}\n${speech}`);
    } else {
      showStatus(`ได้ยิน: ${transcript}\nดำเนินการเรียบร้อย`);
    }

    // Re-open the mic when we still need the user: an unlabeled field to confirm,
    // or a required field they have not given yet. This is the spoken clarification loop.
    const hasRequiredMissing = (lastFill?.failed ?? []).some((f) => f.reason === 'required_missing');
    const stillNeedsHuman = (lastFill?.needs_human?.length ?? 0) > 0;
    if (stillNeedsHuman || hasRequiredMissing) postToIsolated({ type: 'listen' });
    else conversation = null; // command resolved; next mic click starts fresh
  } catch (e) {
    console.warn('[a11y-mcp] agent error', e);
    conversation = null;
    showStatus('เกิดข้อผิดพลาดในการประมวลผลคำสั่ง');
  } finally {
    running = false;
  }
}

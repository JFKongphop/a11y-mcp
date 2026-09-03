// Minimal OpenAI chat-completions client for the agent brain. Runs in the MAIN
// world (it needs document.modelContext); OpenAI returns permissive CORS, so the
// browser call works with no proxy.
//
// KEY HANDLING: the key lives in ./secrets.ts, which is git-ignored but still
// bundled into dist/. It therefore ships in the product (per the hackathon
// choice) yet never enters Git history — important because OpenAI auto-revokes
// keys it finds in public repos. Unlike the free Paxa key, an OpenAI key BILLS:
// set a low usage limit on it in the OpenAI dashboard and rotate after the event.
// For a real release, move it behind a proxy and point OPENAI_BASE there.

import { OPENAI_API_KEY } from './secrets';

const OPENAI_BASE = 'https://api.openai.com/v1';
export const MODEL = 'gpt-4o-mini';

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface ToolSpec {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

export async function chat(
  messages: ChatMessage[],
  tools: ToolSpec[]
): Promise<ChatMessage> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`openai ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices[0].message as ChatMessage;
}

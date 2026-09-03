import { parseForm, findElement, type Field, type ParsedForm } from '../parser';
import { thaiError, type FieldError } from './errors';
import { EMPTY_INPUT_SCHEMA, FILL_INPUT_SCHEMA, parseFillArgs } from './schema';
import { confirmWithUser } from '../content/confirm';
import { postToIsolated, type ParseReport } from '../content/bridge';

// Layer 2 — the WebMCP tool layer.
//
// The spec moved (as CLAUDE.md warned): the API is now `document.modelContext`
// (navigator.modelContext was deprecated in Chrome 150). Verified live in
// Chrome 152, the surface is: registerTool (async, returns a Promise), getTools,
// executeTool, ontoolchange. There is NO unregisterTool, and registering a
// duplicate tool name throws "Duplicate tool name".
//
// So we register the three tools EXACTLY ONCE. They are intentionally generic
// ("the form on this page"), so they never go stale — instead of re-registering
// on DOM change, the MutationObserver just refreshes the mutable `current` state
// the tool callbacks read. This fits the new API better than the old
// unregister-and-re-add dance and sidesteps the duplicate-name error entirely.

let current: { form: HTMLFormElement; parsed: ParsedForm } | null = null;
let toolsRegistered = false;

function mc(): any {
  return (document as any).modelContext;
}

/** Feature-detect the WebMCP surface. The spec is unstable; trust the runtime. */
export function modelContextAvailable(): boolean {
  const m = mc();
  return !!m && typeof m.registerTool === 'function';
}

function buildReport(parsed: ParsedForm | null): ParseReport {
  const fields = parsed?.fields ?? [];
  return {
    href: location.href,
    hasForm: parsed !== null,
    mapped: fields.filter((f) => f.confidence === 'high').length,
    ambiguous: fields.filter((f) => f.confidence === 'medium').length,
    unlabeled: fields.filter((f) => f.confidence === 'low').length,
    total: fields.length,
  };
}

const NO_FORM = { formId: '', fields: [], submitLabel: '' } satisfies ParsedForm;

/** Register the three tools once. Callbacks read module-level `current` live. */
function registerToolsOnce() {
  if (toolsRegistered || !modelContextAvailable()) return;
  toolsRegistered = true; // set before awaiting so a re-entrant call can't double-register

  const register = (tool: any) => {
    // registerTool is async now; swallow the duplicate-name error that a second
    // injection into the same document would raise.
    Promise.resolve()
      .then(() => mc().registerTool(tool))
      .catch((e: unknown) => console.warn('[a11y-mcp] registerTool failed', tool.name, e));
  };

  register({
    name: 'describe_form',
    description:
      'Return the structure of the form on this page: field ids, accessible labels, ' +
      'types, required flags, and constraints. Call this first to learn what fill_form expects.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    execute: async () => ({
      content: [{ type: 'text', text: JSON.stringify(current?.parsed ?? NO_FORM, null, 2) }],
    }),
  });

  register({
    name: 'read_form',
    description:
      'Return the fields to READ ALOUD to a user who cannot read the page (blind, low vision, ' +
      'or does not read the page language): each field id, its accessible label, whether it is ' +
      'required, and any <select> options. Call this when the user asks to hear, read, or explain ' +
      'the form; then narrate it back in the user’s language.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    execute: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            (current?.parsed.fields ?? []).map((f) => ({
              id: f.id,
              label: f.label,
              required: f.required,
              type: f.type,
              options: f.constraints.options?.map((o) => o.label),
            }))
          ),
        },
      ],
    }),
  });

  register({
    name: 'fill_form',
    description:
      'Fill form fields with the given values. Validates each value against the page ' +
      'constraints before writing. Returns which fields were filled, which failed ' +
      'validation and why (reactive: retry with a corrected value), and which could not ' +
      'be identified confidently and must be confirmed by the user first (needs_human: ask, do not guess).',
    inputSchema: FILL_INPUT_SCHEMA,
    execute: async (args: unknown) => {
      if (!current) return { content: [{ type: 'text', text: JSON.stringify({ error: 'no_form_on_page' }) }] };
      const parsedArgs = parseFillArgs(args);
      if ('error' in parsedArgs) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: parsedArgs.error }) }] };
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify(await fill(parsedArgs.values, parsedArgs.confirmed ?? [])) },
        ],
      };
    },
  });

  register({
    name: 'submit_form',
    description:
      'Submit the form. Requires explicit user confirmation — this opens a confirmation ' +
      'overlay and never submits unless the user agrees. Never call this without the user asking to submit.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    execute: async () => {
      if (!current) return { content: [{ type: 'text', text: 'No form on this page.' }] };
      const ok = await confirmWithUser(current.parsed, current.form);
      if (!ok) return { content: [{ type: 'text', text: 'Cancelled by user.' }] };
      current.form.requestSubmit();
      return { content: [{ type: 'text', text: 'Submitted.' }] };
    },
  });

  console.log('[a11y-mcp] registered describe_form, read_form, fill_form, submit_form');
}

/** Re-parse the current form and refresh state + the popup badge. Safe to call often. */
export function syncTools() {
  if (!modelContextAvailable()) return;
  registerToolsOnce();

  const form = document.querySelector('form');
  if (!form) {
    current = null;
    postToIsolated({ type: 'parse-report', report: buildReport(null) });
    return;
  }

  const parsed = parseForm(form);
  current = { form, parsed };
  postToIsolated({ type: 'parse-report', report: buildReport(parsed) });
}

interface FillResult {
  filled: string[];
  failed: (FieldError & { message_th: string })[];
  needs_human: { field: string; label: string; why: string }[];
}

async function fill(values: Record<string, string>, confirmed: string[]): Promise<FillResult> {
  const { form, parsed } = current!;
  const filled: string[] = [];
  const failed: FieldError[] = [];
  const needs_human: { field: string; label: string; why: string }[] = [];

  for (const field of parsed.fields) {
    const raw = values[field.id];

    if (raw == null) {
      if (field.required) {
        failed.push({ field: field.id, label: field.label, reason: 'required_missing' });
      }
      continue;
    }

    // Preemptive: the parser was not sure what this field is, so nothing is
    // filled — UNLESS the user explicitly confirmed it. A confidently-wrong value
    // looks correct and nobody catches it, but an explicitly-confirmed one is safe.
    if (field.confidence === 'low' && !confirmed.includes(field.id)) {
      needs_human.push({
        field: field.id,
        label: field.label,
        why: 'Field label could not be determined reliably. Ask the user before filling.',
      });
      continue;
    }

    // Reactive: the value violates a page constraint. The agent retries with a
    // corrected value; no human needed.
    const err = validate(field, raw);
    if (err) {
      failed.push(err);
      continue;
    }

    const el = findElement(form, field.id) as HTMLInputElement | null;
    if (!el) continue;
    // For a <select>, validation accepts either the option value or its visible
    // label; resolve a label to its underlying value so the option truly selects.
    const opts = field.constraints.options;
    el.value = opts ? opts.find((o) => o.value === raw || o.label === raw)?.value ?? raw : raw;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(field.id);
  }

  return {
    filled,
    failed: failed.map((e) => ({ ...e, message_th: thaiError(e) })),
    needs_human,
  };
}

function validate(f: Field, v: string): FieldError | null {
  const c = f.constraints;
  const base = { field: f.id, label: f.label };

  if (c.options && !c.options.some((o) => o.value === v || o.label === v)) {
    return {
      ...base,
      reason: 'not_an_option',
      expected: c.options.map((o) => o.label).join(', '),
      got: v,
    };
  }
  if (c.pattern && !new RegExp(`^(?:${c.pattern})$`).test(v)) {
    return { ...base, reason: 'pattern_mismatch', expected: c.pattern, got: v };
  }
  if (c.maxLength != null && v.length > c.maxLength) {
    return { ...base, reason: 'too_long', expected: String(c.maxLength), got: String(v.length) };
  }
  if (c.minLength != null && v.length < c.minLength) {
    return { ...base, reason: 'too_short', expected: String(c.minLength), got: String(v.length) };
  }
  if (f.type === 'number') {
    const n = Number(v);
    if ((c.min != null && n < c.min) || (c.max != null && n > c.max)) {
      return {
        ...base,
        reason: 'out_of_range',
        expected: `${c.min ?? '-∞'}–${c.max ?? '∞'}`,
        got: v,
      };
    }
  }
  return null;
}

// Debounced re-sync. Tools are registered once; this only refreshes `current`
// state and the badge, so an SPA route change is reflected with no ghost tools.
let pending: number | undefined;

export function startToolSync() {
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = window.setTimeout(syncTools, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  syncTools();
}

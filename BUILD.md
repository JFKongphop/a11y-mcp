# a11y-mcp — Build Specification

Full implementation spec. Read `CLAUDE.md` for project rationale and constraints; this document is the build itself.

**Execute phases in order. Phase 1 ends in a hard checkpoint — do not proceed past it on failure.**

---

## Phase 0 — Scaffold

```bash
npm create vite@latest a11y-mcp -- --template vanilla-ts
cd a11y-mcp
npm i -D @crxjs/vite-plugin@beta
npm i zod
```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
});
```

### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "a11y-mcp",
  "version": "0.1.0",
  "description": "Voice-operable web forms with typed agent tools",
  "permissions": ["scripting", "activeTab", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": { "default_popup": "src/popup/index.html" },
  "content_scripts": [
    {
      "matches": ["https://*/*"],
      "js": ["src/content/isolated.ts"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://*/*"],
      "js": ["src/content/main.ts"],
      "world": "MAIN",
      "run_at": "document_idle"
    }
  ]
}
```

Two content scripts on purpose. `main.ts` runs in the page world and can reach `navigator.modelContext` but has no `chrome.*` APIs. `isolated.ts` has `chrome.*` but cannot see the page's `navigator`. They talk over `window.postMessage`.

### Directory layout

```
src/
  content/
    main.ts          # MAIN world — registers tools, touches DOM
    isolated.ts      # ISOLATED world — chrome APIs, proxy calls
    bridge.ts        # postMessage protocol, shared types
  parser/
    index.ts         # parseForm()
    accessibleName.ts
    constraints.ts
    classify.ts      # preserve-or-translate
  tools/
    register.ts
    schema.ts        # Zod → JSON Schema
    errors.ts        # stable enum + Thai strings
  voice/
    client.ts        # calls proxy
    mic.ts           # Web Speech API
  popup/
    index.html
    popup.ts
proxy/
  worker.ts
```

---

## Phase 1 — Injection (CHECKPOINT)

Everything rests on this. Build nothing else until it passes.

### `src/content/main.ts` — minimal probe

```ts
function probe() {
  if (!window.isSecureContext) {
    console.warn('[a11y-mcp] not a secure context');
    return;
  }
  const mc = (navigator as any).modelContext;
  if (!mc) {
    console.warn('[a11y-mcp] navigator.modelContext unavailable');
    return;
  }

  console.log('[a11y-mcp] modelContext methods:', Object.keys(Object.getPrototypeOf(mc)));

  mc.registerTool({
    name: 'a11y_probe',
    description: 'Test tool. Returns a fixed string to prove injection works.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => ({
      content: [{ type: 'text', text: 'a11y-mcp injection OK' }],
    }),
  });

  console.log('[a11y-mcp] probe registered');
}

probe();
```

### Verify

1. `npm run build`, load `dist/` unpacked at `chrome://extensions`
2. Enable the WebMCP flag in `chrome://flags`
3. Open any HTTPS page. Console should log the method list and the confirmation.
4. If `navigator.modelContextTesting` exists, run `await navigator.modelContextTesting.getTools()` and confirm `a11y_probe` appears.

**Log the actual method list.** Sources conflict on whether `provideContext` still exists. Whatever `Object.keys` reports is the truth — use that, not this document.

### CHECKPOINT

If the tool does not register, **stop and report**. Do not build the parser. Likely causes to investigate, in order:

- Content script `world: "MAIN"` not supported in the installed Chrome version → try `chrome.scripting.executeScript` with `world: 'MAIN'` from a background worker instead
- Flag not enabled, or page is HTTP
- API renamed again (it was `window.agent` in earlier drafts)

---

## Phase 2 — Paxa proxy

The API key must never reach the browser bundle.

### `proxy/worker.ts`

```ts
export default {
  async fetch(req: Request, env: { PAXA_API_KEY: string }): Promise<Response> {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    const upstream =
      url.pathname === '/tts'
        ? 'https://api.paxalabs.com/v1/tts'
        : url.pathname === '/translate'
        ? 'https://api.paxalabs.com/v1/translate'
        : null;

    if (!upstream) return new Response('not found', { status: 404, headers: cors });

    const res = await fetch(upstream, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAXA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: await req.text(),
    });

    return new Response(res.body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });
  },
};
```

Deploy with `wrangler deploy`, set the secret with `wrangler secret put PAXA_API_KEY`.

**Verify the translate endpoint path against Paxa's docs** — `/v1/tts` is confirmed from their site, the translation path is assumed.

### `src/voice/client.ts`

```ts
const PROXY = 'https://YOUR-WORKER.workers.dev';
const audioCache = new Map<string, string>();

export async function speakThai(text: string, voice = 'nomyen'): Promise<void> {
  let url = audioCache.get(text);
  if (!url) {
    const res = await fetch(`${PROXY}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, model: 'paxa-tts-flash-v1' }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    url = URL.createObjectURL(await res.blob());
    audioCache.set(text, url);
  }
  await new Audio(url).play();
}

export async function toThai(text: string): Promise<string> {
  const res = await fetch(`${PROXY}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source: 'en', target: 'th' }),
  });
  if (!res.ok) return text; // degrade to English rather than break the flow
  const data = await res.json();
  return data.translation ?? text;
}
```

Cache is not an optimization here — field labels and button text get spoken repeatedly on one page, and uncached TTS makes the demo feel broken.

---

## Phase 3 — Parser

### `src/parser/accessibleName.ts`

```ts
export interface NameResult {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

export function accessibleName(el: HTMLElement): NameResult {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return { name: aria, confidence: 'high', source: 'aria-label' };

  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return { name: text, confidence: 'high', source: 'aria-labelledby' };
  }

  if (el.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
    const text = label?.textContent?.trim();
    if (text) return { name: text, confidence: 'high', source: 'label-for' };
  }

  const wrapping = el.closest('label')?.textContent?.trim();
  if (wrapping) return { name: wrapping, confidence: 'medium', source: 'label-wrap' };

  const ph = el.getAttribute('placeholder')?.trim();
  if (ph) return { name: ph, confidence: 'low', source: 'placeholder' };

  const nameAttr = el.getAttribute('name');
  if (nameAttr) return { name: nameAttr, confidence: 'low', source: 'name-attr' };

  return { name: '', confidence: 'low', source: 'none' };
}
```

Confidence is the whole honesty story. `low` means the field goes to `needs_human` and never gets filled silently.

### `src/parser/classify.ts`

```ts
const PRESERVE_TYPES = new Set([
  'email', 'tel', 'number', 'url', 'date', 'time',
  'datetime-local', 'month', 'week', 'password',
]);

const PRESERVE_HINTS = /passport|iban|swift|postcode|zip|code|id|number|no\.|account/i;

export function shouldTranslate(el: HTMLElement, type: string, label: string): boolean {
  if (PRESERVE_TYPES.has(type)) return false;
  if (el.hasAttribute('pattern')) return false;
  if (PRESERVE_HINTS.test(label)) return false;
  if (el.getAttribute('autocomplete')?.includes('name')) return false;
  return true;
}
```

Getting this wrong submits `ประเทศไทย` into a field expecting `Thailand`. When uncertain, preserve — a wrong-language value is worse than an untranslated one.

### `src/parser/index.ts`

```ts
import { accessibleName } from './accessibleName';
import { shouldTranslate } from './classify';

export interface Field {
  id: string;
  label: string;
  type: string;
  required: boolean;
  confidence: 'high' | 'medium' | 'low';
  translate: boolean;
  group?: string;
  constraints: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    options?: { value: string; label: string }[];
  };
}

export interface ParsedForm {
  formId: string;
  fields: Field[];
  submitLabel: string;
}

export function parseForm(form: HTMLFormElement, index = 0): ParsedForm {
  const els = Array.from(
    form.querySelectorAll<HTMLElement>('input, select, textarea')
  ).filter((el) => {
    const t = (el as HTMLInputElement).type;
    return t !== 'hidden' && t !== 'submit' && t !== 'button' && !(el as HTMLInputElement).disabled;
  });

  const fields: Field[] = els.map((el, i) => {
    const { name, confidence } = accessibleName(el);
    const type = (el as HTMLInputElement).type ?? el.tagName.toLowerCase();
    const key = el.id || el.getAttribute('name') || `field_${i}`;

    const options =
      el.tagName === 'SELECT'
        ? Array.from((el as HTMLSelectElement).options).map((o) => ({
            value: o.value,
            label: o.textContent?.trim() ?? o.value,
          }))
        : undefined;

    return {
      id: key,
      label: name || key,
      type,
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      confidence,
      translate: shouldTranslate(el, type, name),
      group: el.closest('fieldset')?.querySelector('legend')?.textContent?.trim(),
      constraints: {
        pattern: el.getAttribute('pattern') ?? undefined,
        minLength: numAttr(el, 'minlength'),
        maxLength: numAttr(el, 'maxlength'),
        min: numAttr(el, 'min'),
        max: numAttr(el, 'max'),
        options,
      },
    };
  });

  const submitEl = form.querySelector<HTMLElement>('[type=submit], button:not([type=button])');

  return {
    formId: form.id || `form_${index}`,
    fields,
    submitLabel: submitEl?.textContent?.trim() || 'Submit',
  };
}

function numAttr(el: HTMLElement, attr: string): number | undefined {
  const v = el.getAttribute(attr);
  return v == null ? undefined : Number(v);
}

export function findElement(form: HTMLFormElement, fieldId: string): HTMLElement | null {
  return (
    form.querySelector<HTMLElement>(`#${CSS.escape(fieldId)}`) ??
    form.querySelector<HTMLElement>(`[name="${CSS.escape(fieldId)}"]`)
  );
}
```

---

## Phase 4 — Tools

### `src/tools/errors.ts`

```ts
export type Reason =
  | 'pattern_mismatch'
  | 'out_of_range'
  | 'required_missing'
  | 'too_long'
  | 'too_short'
  | 'not_an_option';

export interface FieldError {
  field: string;
  label: string;
  reason: Reason;
  expected?: string;
  got?: string;
}

const TH: Record<Reason, (e: FieldError) => string> = {
  pattern_mismatch: (e) => `ช่อง ${e.label} รูปแบบไม่ถูกต้อง ต้องเป็น ${e.expected}`,
  out_of_range: (e) => `ช่อง ${e.label} ต้องอยู่ในช่วง ${e.expected} คุณกรอก ${e.got}`,
  required_missing: (e) => `ช่อง ${e.label} จำเป็นต้องกรอก`,
  too_long: (e) => `ช่อง ${e.label} ยาวเกินไป ต้องไม่เกิน ${e.expected} ตัวอักษร`,
  too_short: (e) => `ช่อง ${e.label} สั้นเกินไป ต้องอย่างน้อย ${e.expected} ตัวอักษร`,
  not_an_option: (e) => `ช่อง ${e.label} ไม่มีตัวเลือกนี้ เลือกได้จาก ${e.expected}`,
};

export const thaiError = (e: FieldError) => TH[e.reason](e);
```

Templates, not model-generated prose. The same failure must speak identically every time, and must work with no model call.

### `src/tools/register.ts`

```ts
import { parseForm, findElement, type ParsedForm } from '../parser';
import { thaiError, type FieldError } from './errors';

let current: { form: HTMLFormElement; parsed: ParsedForm } | null = null;
let registered: string[] = [];

function mc() {
  return (navigator as any).modelContext;
}

function unregisterAll() {
  for (const n of registered) {
    try { mc().unregisterTool(n); } catch {}
  }
  registered = [];
}

function reg(tool: any) {
  mc().registerTool(tool);
  registered.push(tool.name);
}

export function syncTools() {
  unregisterAll();

  const form = document.querySelector('form');
  if (!form) return;

  const parsed = parseForm(form);
  current = { form, parsed };

  reg({
    name: 'describe_form',
    description: 'Return the structure of the form on this page: fields, types, required flags, and constraints.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => ({
      content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
    }),
  });

  reg({
    name: 'fill_form',
    description:
      'Fill form fields with the given values. Validates against page constraints. ' +
      'Returns which fields were filled, which failed validation and why, and which could not be ' +
      'identified confidently and must be confirmed by the user.',
    inputSchema: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description: 'Map of field id to value.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['values'],
    },
    execute: async ({ values }: { values: Record<string, string> }) =>
      ({ content: [{ type: 'text', text: JSON.stringify(await fill(values)) }] }),
  });

  reg({
    name: 'submit_form',
    description:
      'Submit the form. Requires explicit user confirmation — never call this without the user agreeing first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const ok = await confirmWithUser();
      if (!ok) return { content: [{ type: 'text', text: 'Cancelled by user.' }] };
      current!.form.requestSubmit();
      return { content: [{ type: 'text', text: 'Submitted.' }] };
    },
  });
}

async function fill(values: Record<string, string>) {
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

    if (field.confidence === 'low') {
      needs_human.push({
        field: field.id,
        label: field.label,
        why: 'Field label could not be determined reliably. Ask the user before filling.',
      });
      continue;
    }

    const err = validate(field, raw);
    if (err) { failed.push(err); continue; }

    const el = findElement(form, field.id) as HTMLInputElement | null;
    if (!el) continue;
    el.value = raw;
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

function validate(f: ReturnType<typeof parseForm>['fields'][number], v: string): FieldError | null {
  const c = f.constraints;
  const base = { field: f.id, label: f.label };

  if (c.options && !c.options.some((o) => o.value === v || o.label === v)) {
    return { ...base, reason: 'not_an_option', expected: c.options.map((o) => o.label).join(', '), got: v };
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
      return { ...base, reason: 'out_of_range', expected: `${c.min ?? '-∞'}–${c.max ?? '∞'}`, got: v };
    }
  }
  return null;
}
```

`needs_human` fields are skipped entirely, not filled with a guess. That is the point — a confidently-wrong value on a visa form looks correct and nobody catches it.

### MutationObserver

```ts
let pending: number | undefined;
const observer = new MutationObserver(() => {
  clearTimeout(pending);
  pending = window.setTimeout(syncTools, 300);
});
observer.observe(document.body, { childList: true, subtree: true });
syncTools();
```

Debounced. Without unregistering on change, SPAs leave ghost tools pointing at elements that no longer exist and the agent calls things the user cannot see.

---

## Phase 5 — Confirmation and mic

### Confirmation overlay

`submit_form` must block on a real human decision. Render a fixed-position overlay listing every field about to be submitted, speak a Thai summary through Paxa, and resolve the promise on click.

```ts
async function confirmWithUser(): Promise<boolean> {
  const { parsed, form } = current!;
  const lines = parsed.fields
    .map((f) => {
      const el = findElement(form, f.id) as HTMLInputElement | null;
      return el?.value ? `${f.label}: ${el.value}` : null;
    })
    .filter(Boolean) as string[];

  postToIsolated({ type: 'speak', text: `กำลังจะส่งข้อมูล ${lines.length} รายการ` });

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'assertive');
    el.style.cssText =
      'position:fixed;inset:auto 16px 16px auto;z-index:2147483647;background:#fff;' +
      'color:#111;padding:16px;border:2px solid #111;border-radius:8px;max-width:360px;font:14px system-ui';
    el.innerHTML =
      `<strong>ยืนยันการส่ง</strong><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;

    const yes = document.createElement('button');
    yes.textContent = 'ยืนยัน';
    const no = document.createElement('button');
    no.textContent = 'ยกเลิก';
    el.append(yes, no);
    document.body.appendChild(el);

    yes.onclick = () => { el.remove(); resolve(true); };
    no.onclick = () => { el.remove(); resolve(false); };
    yes.focus();
  });
}
```

### `src/voice/mic.ts`

```ts
export function listenThai(onResult: (text: string) => void) {
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) throw new Error('Web Speech API unavailable');
  const rec = new SR();
  rec.lang = 'th-TH';
  rec.interimResults = false;
  rec.onresult = (e: any) => onResult(e.results[0][0].transcript);
  rec.start();
  return () => rec.stop();
}
```

Web Speech API for input — Paxa's speech-to-text is still in progress and must not be depended on.

### Bridge

MAIN and ISOLATED worlds share nothing. Proxy calls (`fetch` to the Worker) belong in ISOLATED; DOM and tool registration belong in MAIN.

```ts
// MAIN
export function postToIsolated(msg: unknown) {
  window.postMessage({ __a11y_mcp: true, ...(msg as object) }, '*');
}

// ISOLATED
window.addEventListener('message', async (e) => {
  if (e.source !== window || !(e.data as any)?.__a11y_mcp) return;
  if (e.data.type === 'speak') await speakThai(e.data.text);
});
```

Check `e.source !== window` — any page script can post messages.

---

## Phase 6 — Confidence badge

Popup shows the parse result for the active tab: `8 fields mapped · 2 ambiguous · 1 unlabeled`.

This is the honesty feature. A badly-marked-up site is not a failure; it is the tool reporting truthfully. Ship it — it is what makes the universal claim defensible.

---

## Phase 7 — Verification

Test against three real English forms with reasonable semantics. Record which ones work.

For each, confirm:

- [ ] `describe_form` returns every visible field
- [ ] `fill_form` populates the DOM and the site's own validation accepts it
- [ ] A deliberately bad value returns the right `reason` and the Thai message is correct
- [ ] An unlabeled field lands in `needs_human` and is **not** filled
- [ ] `submit_form` cannot fire without the overlay being confirmed
- [ ] Navigating an SPA route re-registers tools and leaves no ghosts
- [ ] Thai audio plays within ~1s of the trigger

---

## Known risks

| Risk | Mitigation |
|---|---|
| `world: "MAIN"` unsupported | Fall back to `chrome.scripting.executeScript` with `world: 'MAIN'` from a background worker |
| `provideContext` removed from spec | Use `registerTool`/`unregisterTool` only; feature-detect at startup |
| Paxa translate endpoint path assumed | Verify against Paxa docs in Phase 2 |
| TTS latency makes demo feel broken | Cache aggressively, pre-fetch next field, use streaming websocket |
| Wrong-language value submitted | `shouldTranslate` defaults to preserve when uncertain |
| Form uses a custom widget, not `<input>` | Out of scope — report as unmapped in the badge |

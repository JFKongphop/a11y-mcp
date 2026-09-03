# a11y-mcp

**Speak Thai. Fill any English web form. Never touch the keyboard.**

a11y-mcp is a Chrome extension that turns any semantically sound web form into
typed tools an AI agent can call — then lets a Thai speaker **read, fill, correct,
and submit** that form entirely by voice, with every confirmation and error spoken
back in Thai *before* anything is sent.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

**▶ [Watch the 1-minute demo](https://youtu.be/EIvvUC6lh3U)** — voice-driven form filling, self-correction, and the Thai read-back in action.

[![a11y-mcp demo video](https://img.youtube.com/vi/EIvvUC6lh3U/maxresdefault.jpg)](https://youtu.be/EIvvUC6lh3U)

---

## The problem

Two failures, stacked on top of each other.

**1. Agents "use" websites by guessing pixels.** An AI agent that fills a form
looks at the screen and guesses which box is which and which button submits. It
guesses wrong, and when the page rejects a value it just sees a red border — it
has no idea *why*.

**2. Accessibility tooling is built for English.** A Thai person in front of an
English-only form — a visa application, a university portal, an airline check-in —
is stuck. These forms are usually well-marked-up and completely unusable if you
don't read English. Screen readers mangle code-switched Thai, and nobody
translates the forms.

**Our lead user:** a Thai person facing an English-only form. Served without
changing anything: blind users, people with motor impairments, elderly users —
anyone who can't reliably use a mouse and keyboard. This is a *capability*, not a
special-needs product.

---

## The solution

The web page exposes **typed tools** (via the WebMCP standard,
`document.modelContext`). An AI brain listens to Thai speech, calls those tools,
and the page answers with **structured, typed feedback** — "this value failed the
pattern, expected 13 digits" — instead of a red border. The agent self-corrects.
When it isn't sure, it **asks in Thai and listens for the answer**. It never
submits without a human clicking confirm.

```
🎤 you speak Thai
   → GPT-4o-mini reads the page's own tools + form structure
   → calls read_form / fill_form / submit_form
   → the page validates and answers with typed results
   → the agent self-corrects, or asks you in Thai, or fills
   → Paxa speaks the result back in Thai
```

---

## How it works, step by step

Imagine a Thai user, `Somchai`, at an English visa form he cannot read.

1. **He clicks the 🎤 button** and says, in Thai, *"อ่านฟอร์มนี้ให้ฟังหน่อย"* (read
   me this form). The agent calls `read_form` and **speaks every field aloud in
   Thai** — name, email, nationality, length of stay. Now he knows what the form
   wants.
2. **He speaks his details** in one breath: *"ชื่อ Somchai นามสกุล Jaidee อีเมล
   somchai@example.com อยู่ 14 วัน มาเที่ยว"*. GPT figures out which field each
   piece belongs to and calls `fill_form`.
3. **The page validates as it fills.** His name stays in Latin script; "14" goes in
   the number field; *"มาเที่ยว"* is **translated to "Vacation"** for the free-text
   box; *"ไทย"* is matched to the `<select>` option **`TH`**.
4. **He forgot his passport number** (a required field). Instead of silently
   skipping it, the agent **asks him in Thai** — *"เลขหนังสือเดินทางคืออะไร"* — and
   the mic re-opens on its own. He answers; the field fills.
5. **One field on the page has no label at all.** The parser wasn't sure what it
   means, so it was **left empty, not guessed** — and the agent said so. A
   confidently-wrong value on a visa form is the failure mode that actually hurts
   people; this refuses to make it.
6. **He says *"ส่งฟอร์ม"*** (submit). A confirmation box lists every value, a Thai
   voice reads the count, and **nothing is sent until he clicks ยืนยัน.**

---

## Features, explained

### 🔊 1. Read the form aloud in Thai — `read_form`
A blind or non-English-reading user can **hear the whole form** before filling it:
each field's label (translated to Thai), whether it's required, and what options a
dropdown has. This closes the accessibility loop — **perceive → fill → confirm** —
instead of only writing to a form the user can't see.

### 🗣️ 2. Fill by natural voice — `fill_form`
Speak your details in any order, in plain Thai. GPT maps each spoken value to the
right field using the form's own structure. You never name a field or click a box.

### 🌐 3. Preserve-or-translate, per field
The single most dangerous mistake is submitting `ประเทศไทย` into a box that expects
`Thailand`. So each field is classified:
- **Preserved as typed:** email, phone, numbers, dates, passport/national-id, and
  person names (kept in Latin script).
- **Translated to English:** free text and textareas (*"มาเที่ยว" → "Vacation"*).
- **Matched, not translated:** `<select>` values are matched against the option
  list (*"ไทย" → `TH`*).

### 🔁 4. Self-correction from typed errors
When the page rejects a value, it returns a **typed reason** — `pattern_mismatch`,
`out_of_range`, `too_long`, `not_an_option` — with what it expected. The agent
uses that to **fix the value and retry, with no human involved.** This is the
entire argument for WebMCP, demonstrated in one interaction: a clicking agent sees
a red border; this gets a machine-readable error and self-corrects.

### 💬 5. Ask-and-listen clarification
Two situations make the agent **stop and ask, in Thai, then re-open the mic**:
- A **required field is missing** and can't be inferred ("what's your email?").
- A field is **unlabeled / ambiguous**, so the parser marked it low-confidence.

Your spoken answer is passed back with a `confirmed` flag, which is the *only* way
a low-confidence field gets filled — an explicit human OK, never a silent guess.

### ✋ 6. Human-in-the-loop submit — `submit_form`
`submit_form` is a separate tool on purpose. It opens a confirmation overlay
listing every value, speaks a Thai summary, and **blocks until you click ยืนยัน.**
The agent can never submit on its own.

### 📊 7. Honest confidence badge
The toolbar popup shows `10 mapped · 0 ambiguous · 1 unlabeled`. A badly-marked-up
site isn't a failure — it's the tool **telling the truth** about what it can and
can't do, instead of filling wrong values silently.

---

## The four WebMCP tools

The thinnest, most important part of the codebase (~200 lines). Tool granularity
and error shapes are where "thoughtful use of WebMCP" lives.

| Tool | Purpose |
|---|---|
| `describe_form()` | Full structure: field ids, labels, types, required flags, constraints. |
| `read_form()` | The fields to **read aloud** — labels, required flags, options. |
| `fill_form(values, confirmed?)` | Validates each value, fills what passes, returns `filled` / `failed` / `needs_human`. `confirmed` bypasses the low-confidence guard after explicit human approval. |
| `submit_form()` | Human-gated submit — opens the confirmation overlay, never fires alone. |

`fill_form`'s response is the heart of the design:

```jsonc
{
  "filled":  ["given_name", "email", "nationality"],
  "failed":  [{ "field": "national_id", "reason": "pattern_mismatch",
               "expected": "[0-9]{13}", "got": "12 digits",
               "message_th": "ช่อง National ID number รูปแบบไม่ถูกต้อง ต้องเป็น [0-9]{13}" }],
  "needs_human": [{ "field": "ref_code", "label": "ref_code",
                    "why": "Field label could not be determined reliably." }]
}
```

- **`failed` is reactive** — the page rejected a value; the agent retries. Harmless.
- **`needs_human` is preemptive** — the parser was unsure, so **nothing was
  filled**; the agent must ask. This is the distinction that protects real users.

Error text comes from **stable Thai templates keyed by the error enum** — never
model-generated. The same failure sounds the same every time, and works with no
model call.

---

## Architecture

Three layers, delivered as an MV3 Chrome extension. The extension is the vehicle,
not the product — if Chrome shipped this natively, the parser and tool design are
what remain.

| Layer | Path | World | Job |
|---|---|---|---|
| 1 — Parser | `src/parser/` | — | DOM → schema + confidence + preserve/translate flags |
| 2 — Tools | `src/tools/` | MAIN | WebMCP registration, validation, stable error shapes |
| 3 — Brain | `src/agent/` | MAIN | GPT-4o-mini: Thai speech → typed tool calls |
| 3 — Voice | `src/voice/` | ISOLATED | Paxa TTS/translate, Web Speech mic |

Two content scripts talk over `window.postMessage`:

- **`src/content/main.ts`** (MAIN world) — the only world that can reach
  `document.modelContext`. It registers tools, touches the DOM, and runs the brain.
- **`src/content/isolated.ts`** (ISOLATED world) — has `chrome.*`, calls Paxa,
  owns the mic button, feeds the popup badge.

A debounced **MutationObserver** keeps the parse fresh on DOM change. Tools are
registered **once** with generic names, so SPA route changes never leave ghost
tools (and it sidesteps the fact that the current API has no `unregisterTool`).

> **Note on the WebMCP spec (it's unstable).** The API moved from
> `navigator.modelContext` to **`document.modelContext`** (navigator was
> deprecated in Chrome 150). Verified live in Chrome 152: `registerTool` is async,
> there is no `unregisterTool`, duplicate tool names throw, `getTools()` returns
> `inputSchema` as a JSON string, and `executeTool(tool, argsJSON)` takes args as a
> JSON string. The code targets this real surface.

---

## Tech stack

- **TypeScript** throughout · **Vite** + `@crxjs/vite-plugin` · **Zod** for the
  schema-once / validate-at-runtime tool boundary.
- **OpenAI GPT-4o-mini** — the brain that turns Thai speech into tool calls
  (function calling). Natively understands Thai, so it produces correct per-field
  values without a separate translator.
- **Paxa Labs** — Thai TTS (`paxa-tts-flash-v1`, voice `yoyo`) and translation
  (`paxa-translation-lite-v1`). Both verified against the live API.
- **Web Speech API** — Thai speech-to-text for voice input.

Both APIs allow direct browser calls (`access-control-allow-origin: *`), so there
is no proxy in the demo path. An optional Cloudflare Worker (`proxy/`) is included
for a production key-hiding setup.

---

## Build & run

```bash
npm install
npm run build          # tsc --noEmit && vite build  → dist/
```

1. In `chrome://flags`, enable **WebMCP for testing** (`#enable-webmcp-testing`)
   and **relaunch Chrome fully** (a flag change needs a real restart).
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → select `dist/`.
3. Serve a form over localhost (a secure context, so `document.modelContext`
   exists): `npx serve demo -p 3000`, then open
   `http://localhost:3000/visa-form.html`.

To reflect a code change, `npm run build` again and click **↻ reload** on the
extension card. (`npm run dev` gives hot-reload for faster iteration.)

### Keys
- **Paxa** key is hardcoded in `src/voice/client.ts` (free, capped hackathon key).
- **OpenAI** key lives in `src/agent/secrets.ts`, which is **git-ignored** but still
  bundled into `dist/` — it ships in the product yet never enters Git history
  (OpenAI auto-revokes keys found in public repos). Copy `secrets.example.ts` to
  `secrets.ts` and paste your key. Set a spend limit on it.

---

## Try it by voice

1. Click the **🎤** button (bottom-left) — this also grants the mic and unlocks audio.
2. **Fill:** *"ชื่อ สมชาย นามสกุล ใจดี อีเมล somchai@example.com อยู่ 14 วัน"*
3. **Read aloud:** *"อ่านฟอร์มนี้ให้ฟังหน่อย"*
4. **Clarify:** say only *"ชื่อ สมชาย"* — it fills the name, then asks for a missing
   required field in Thai and re-opens the mic.
5. **Submit:** *"ส่งฟอร์ม"* → confirmation overlay → click **ยืนยัน**.

---

## Tests

```bash
npm test        # headless jsdom run of parser → tools against demo/visa-form.html
```

29 assertions covering everything that doesn't need the Chrome flag: field
extraction, confidence, preserve/translate flags, constraint validation, the
stable error enum + Thai strings, the `filled` / `failed` / `needs_human` split,
`read_form`, and the `confirmed` bypass. The demo form has one deliberately
unlabeled field to exercise the `needs_human` path.

---

## Honest limits

Works on sites with **reasonable semantics** — not "works everywhere." When markup
is bad, the confidence badge says so rather than filling wrong values silently. A
bad site isn't a failure; it's the tool being truthful, and an overreaching claim
that breaks in front of a judge is worse than a narrow claim that holds.

**Out of scope:** cross-page memory (a privacy design problem), custom non-`<input>`
widgets (reported as unmapped), and full stateful tool surfaces.

---

## Why WebMCP is necessary here

A clicking agent sees a red border and interprets pixels. This gets a **typed error
back from the page** and self-corrects — that is the entire argument for the
standard, in one interaction. The impact argument is that it works **in Thai, for
people Western accessibility tooling has never served.** Constraint feedback alone
is a competent engineering demo; the Thai angle alone is a TTS wrapper. Together
they're a conversational accessibility agent for the open web.

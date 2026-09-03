# a11y-mcp

Chrome extension that turns any semantically sound web form into typed tools an AI agent can call, then speaks confirmations and errors in Thai before anything is submitted.

Built for the OpenAI WebMCP Challenge.

---

## 0. Read this first

**The WebMCP spec is unstable.** Sources conflict on whether `provideContext()` and `clearContext()` still exist — one source says they were removed in the March 2026 spec revision, others still document them. Before writing any layer 2 code, check the current API at `github.com/webmachinelearning/webmcp` and in `chrome://flags`. Do not trust this document or any blog post for the exact API surface.

`navigator.modelContext` is `[SecureContext]` — it only exists on HTTPS pages. Check `window.isSecureContext` before calling anything.

**Build in the order given in section 5.** Step 1 is the one that can kill the whole design. Do it before writing the parser.

---

## 1. What this is

Two failures stacked on top of each other:

1. Agents that "use" websites do it by guessing which pixel is the submit button. They guess wrong.
2. Accessibility tooling is built for English. A Thai user gets mangled pronunciation on code-switched sentences, and form errors get announced in the wrong place or not at all.

**Lead persona:** a Thai person facing an English-only form — visa application, university portal, airline check-in. These forms are usually well-marked-up and completely unusable if you don't read English well. Nobody translates them.

**Also served without changing anything:** blind users, people with motor impairments, elderly users, anyone who can't reliably use a mouse and keyboard.

Do not brand this as "software for blind people." It is a capability, not a special-needs product.

---

## 2. Stack

- **TypeScript throughout.** No Rust. The parser's work is DOM traversal — the data lives in JavaScript, and crossing a WASM boundary to read twenty form fields is slower and adds a build step for nothing.
- **Vite** + `@crxjs/vite-plugin` — MV3 bundling and hot reload
- **Zod** — defines the schema once, gives both JSON Schema generation and runtime validation. This is exactly the constraint-feedback need, so lean on it.
- **Web Speech API** for voice input (Paxa's speech-to-text is still in progress — do not depend on it)
- **Paxa Labs** for translation and TTS output
- **Cloudflare Worker or Vercel edge function** as the Paxa proxy

---

## 3. Architecture

Three layers, delivered as a Chrome extension. The extension is the vehicle, not the product — if Chrome shipped this natively tomorrow, the parser and tool design would still be what was built.

### Layer 1 — Parser (TypeScript)

Walks the DOM. Per field, extracts:

- **Accessible name**, resolved in priority order: `aria-label` → `aria-labelledby` → `<label for>` → placeholder
- **Constraints:** `type`, `required`, `pattern`, `min`/`max`, `maxlength`, `<select>` options
- **Grouping** via `fieldset` / `legend`
- **Confidence score** — did we actually find a label, or are we guessing?
- **Preserve-or-translate flag** — see below

Output: JSON Schema plus metadata.

**Preserve-or-translate is not optional.** The user speaks Thai; the form needs English. Get this wrong and you submit `ประเทศไทย` into a field expecting `Thailand`.

- **Preserve as typed:** `email`, `tel`, `number`, `url`, `date`, anything with a `pattern`, and Latin-script name fields
- **Translate:** free text, textareas, and `<select>` (selects are easiest — you have the option list, so match against it rather than translating blind)

### Layer 2 — Tool layer (WebMCP)

The thinnest part of the codebase and the most important part of the submission. This is the only place the judges' standard actually shows up. Maybe 200 lines. Tool granularity, error shapes, and when tools appear and vanish are what "thoughtful use of WebMCP" means on the rubric.

Three tools:

```ts
describe_form()      // structure, field names, types, required flags, constraints
fill_form(values)    // validates against parsed constraints, fills what it can
submit_form()        // separate on purpose — never fires without human confirmation
```

`submit_form` is deliberately its own tool. That separation is the human-in-the-loop boundary and judges look for it.

**Response shape from `fill_form`:**

```ts
{
  filled: ["name", "phone"],
  failed: [{
    field: "national_id",
    reason: "pattern_mismatch",   // stable enum
    expected: "13 digits",
    got: "12 digits"
  }],
  needs_human: ["field_7"]
}
```

Two different recovery paths, and they must behave differently:

- **`failed` is reactive.** The page rejected a value. The agent retries and self-corrects with no human involvement.
- **`needs_human` is preemptive.** The parser wasn't sure what the field means, so **nothing was filled**. The agent must ask, not guess.

The distinction matters for real users. A wrong retry is harmless — the field rejects again. A confidently-filled field the parser misread is dangerous, because it looks correct and nobody catches it. Silent wrong answers are the failure mode that actually hurts people.

**`reason` must be a stable enum:** `pattern_mismatch`, `out_of_range`, `required_missing`, `too_long`. Thai text is generated from the enum. Never let the model write error prose — the same failure must speak the same way every time, and it must work without a model call.

**MutationObserver** re-scans on DOM change and unregisters stale tools. Without this, SPAs leave ghost tools pointing at elements that no longer exist, and the agent calls tools the user can't see.

### Layer 3 — Voice (Paxa)

Two directions:

- **Reading:** English label → Paxa Translate → Paxa TTS → spoken Thai
- **Writing:** user speaks Thai → translate-flagged fields converted to English, preserve-flagged fields pass through as typed

**API key never ships in the extension bundle.** Anyone can open DevTools. Key lives in the proxy, server-side.

Latency work, or the demo feels sluggish:
- Use the streaming websocket, not plain HTTP
- Pre-fetch audio for the next field
- Cache repeated strings — button labels and field names get read many times per page

### Delivery — Chrome extension

Content script injected with `world: "MAIN"`. `navigator.modelContext` belongs to the page; an isolated-world content script cannot reach it. **This is the assumption the entire design rests on. Verify it works before building anything else.**

Ship a mic button in the extension. The extension publishes tools; something has to call them. Relying on the browser's built-in agent means the demo shows someone talking to Chrome's assistant instead of to this product. Self-contained is a better product and a much better video.

---

## 4. Repo layout

```
a11y-mcp/
  extension/        # content script, MAIN world injection, mic button, popup
  parser/           # DOM → schema + confidence + translate flags
  tools/            # WebMCP registration, validation, error shapes
  proxy/            # Cloudflare Worker — Paxa key lives here
  demo/             # screen recordings
  README.md
```

Check `a11y-mcp` is free on npm and GitHub before committing to the name. If taken, `a11y-webmcp` is more precise anyway.

---

## 5. Build order

Deliberately ordered so the highest-risk unknown surfaces first.

1. **Injection.** Register a fake hardcoded tool on a page you don't own, via `world: "MAIN"`. Confirm an agent can see it. **If this doesn't work, nothing else matters.** Do not write the parser first.
2. **Paxa proxy.** Worker or edge function, key server-side, one `curl` that returns audio. Then test the streaming websocket and confirm word timestamps come back.
3. **Parser** on one real form. Verify against 2–3 actual English forms — a visa application is the most legible target for non-Thai judges.
4. **Three tools** with the `filled` / `failed` / `needs_human` response shape.
5. **Mic button** and the full loop end to end.
6. **Confidence badge** — "8 fields mapped, 2 ambiguous, 1 unlabeled".
7. **Video** with English subtitles.

---

## 6. Demo

Agent fills eight fields. Hits a validation error, fixes itself, no human involved. Then stops on an unlabeled field and asks in Thai. User confirms. Submit fires.

Two visibly different behaviors in one run — reads as deliberate design rather than one feature with two names.

**English subtitles throughout.** Every judge is non-Thai. They'll hear Thai audio and see an English form and understand nothing otherwise. Subtitle the spoken commands and confirmations.

Lead with the person and the finished task. Do not explain constraint feedback — let it happen on screen.

**Do not blindfold-simulate.** Screen recording with real screen reader audio (NVDA or VoiceOver) side by side with the tool is stronger, and simulation reads badly to anyone who works in accessibility.

---

## 7. Honest limits — state these in the README

Works on sites with reasonable semantics. Not "works everywhere."

When markup is bad, the badge says so rather than filling wrong values silently. The confidence readout turns the biggest weakness into a truthfulness feature: a bad site isn't a failure, it's the tool being honest.

A universal claim gets judged on the sites the judges try, not the ones that were tested. An overreaching claim that breaks in front of a judge is worse than a narrow claim that holds.

---

## 8. Out of scope

- **Cross-page memory.** Storing a passport number across sites is a privacy design problem, not a weekend feature.
- **Rust/WASM.** Decided against — see section 2.
- **Fundraising or roadmap language in the submission.** Judges score the artifact. Roadmap talk reads as a substitute for a working demo.
- **Full stateful tool surfaces.** Partially free via the MutationObserver re-registration. Don't chase the complete version.

---

## 9. Why WebMCP is necessary here

A clicking agent sees a red border and interprets pixels. This gets a typed error back from the page and self-corrects. That is the entire argument for the standard, demonstrated in one interaction.

The technical argument is constraint feedback. The impact argument is that it works in Thai, for people Western accessibility tooling has never served. Both are needed — constraint feedback alone is a competent engineering demo; the Thai angle alone is a TTS wrapper.

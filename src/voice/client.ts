// Calls the Paxa API directly from the ISOLATED-world content script.
//
// HACKATHON NOTE: the API key is hardcoded below and therefore ships in the
// bundle — a deliberate override of the "key never ships in the extension" rule
// in CLAUDE.md. It's acceptable here because this is a free, no-card hackathon
// key (100-credit cap, worst case someone burns the free quota). For a real
// release, move this back behind the Cloudflare Worker in proxy/worker.ts and
// point PAXA_BASE at that Worker instead.
//
// Paxa returns `access-control-allow-origin: *` and allows the Authorization
// header, so direct cross-origin browser calls work with no proxy.
//
// Verified against the live API (https://paxalabs.com/docs):
//   POST /v1/tts        -> audio/mpeg (MP3) binary
//   POST /v1/translate  -> { translations: [{ text, detected_source }], usage }
// Both require a `model` field. Translation targets Thai only (X -> th).

const PAXA_BASE = 'https://api.paxalabs.com';
const PAXA_API_KEY = 'pxa_HlUGo0duVLjkhnCzz7XRIlOvAem5v4VALT2ygXJ2';

const TTS_MODEL = 'paxa-tts-flash-v1';
const TRANSLATE_MODEL = 'paxa-translation-lite-v1';

const authHeaders = {
  Authorization: `Bearer ${PAXA_API_KEY}`,
  'Content-Type': 'application/json',
};

// Caching is not an optimization here: field labels and button text get spoken
// repeatedly on one page, and uncached TTS makes the demo feel broken. It also
// matters for quota — the free plan is 10 req/min, concurrency 1.
const audioCache = new Map<string, string>();
const translateCache = new Map<string, string>();

export async function speakThai(text: string, voice = 'yoyo'): Promise<void> {
  if (!text) return;
  const cacheKey = `${voice}:${text}`;
  let url = audioCache.get(cacheKey);
  if (!url) {
    const res = await fetch(`${PAXA_BASE}/v1/tts`, {
      method: 'POST',
      headers: authHeaders,
      // stream:false — we read the full blob and hand it to Audio(); a streamed
      // body can't be cached or replayed the same way. Format defaults to MP3,
      // which Chrome's Audio() plays natively.
      body: JSON.stringify({ text, voice, model: TTS_MODEL, stream: false }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    url = URL.createObjectURL(await res.blob());
    audioCache.set(cacheKey, url);
  }
  await new Audio(url).play();
}

// Reading direction only: English (or any supported source) -> Thai. Paxa's
// translate model targets Thai, so this is exactly the label-reading path. The
// writing direction (Thai -> English) is not supported by this model — see README.
export async function toThai(text: string, source = 'en', target = 'th'): Promise<string> {
  if (!text) return text;
  const key = `${source}:${target}:${text}`;
  const cached = translateCache.get(key);
  if (cached != null) return cached;

  const res = await fetch(`${PAXA_BASE}/v1/translate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ text, source, target, model: TRANSLATE_MODEL }),
  });
  if (!res.ok) return text; // degrade to source language rather than break the flow

  const data = await res.json();
  const out = (data.translations?.[0]?.text ?? text) as string;
  translateCache.set(key, out);
  return out;
}

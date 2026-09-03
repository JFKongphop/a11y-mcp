// Cloudflare Worker — the Paxa key lives here, server-side, and never ships in
// the extension bundle. Deploy with `wrangler deploy`; set the secret with
// `wrangler secret put PAXA_API_KEY`.
//
// Both paths verified against the live Paxa API (https://paxalabs.com/docs):
//   /v1/tts        -> audio/mpeg binary
//   /v1/translate  -> JSON { translations: [...] }; requires a `model` field
// The Worker is endpoint-agnostic — it just adds auth + CORS and forwards.

export interface Env {
  PAXA_API_KEY: string;
}

const UPSTREAMS: Record<string, string> = {
  '/tts': 'https://api.paxalabs.com/v1/tts',
  '/translate': 'https://api.paxalabs.com/v1/translate',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    const upstream = UPSTREAMS[url.pathname];
    if (!upstream) return new Response('not found', { status: 404, headers: cors });
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

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

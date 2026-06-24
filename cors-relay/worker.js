/*
 * TriLink CORS relay — a tiny stateless Cloudflare Worker.
 *
 * Some hosts (Bitbucket, Dropbox, …) don't send cross-origin headers, so a
 * browser can't read their `.version` files directly. This Worker re-fetches the
 * file server-side and returns it with an `Access-Control-Allow-Origin` header so
 * the TriLink page can read it. It is NOT a general-purpose open proxy: it only
 * relays `.version` files, only GET, and caps the response size.
 *
 * Deploy with `wrangler deploy`, then put the Worker URL into CORS_PROXY in
 * deeplink.js (or set self.TRILINK_CORS_PROXY before that script loads).
 */

const MAX_BYTES = 256 * 1024; // .version files are tiny; cap to discourage abuse

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return new Response('Missing ?url=', { status: 400, headers: CORS });
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response('Bad url', { status: 400, headers: CORS });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return new Response('Only http(s) is allowed', { status: 400, headers: CORS });
    }
    // Only relay .version files (ignore any query/hash). This keeps the Worker
    // from being usable as a general-purpose open proxy.
    if (!/\.version$/i.test(parsed.pathname)) {
      return new Response('Only .version files are relayed', { status: 400, headers: CORS });
    }

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        method: 'GET',
        headers: { Accept: 'text/plain, application/json, */*' },
        redirect: 'follow', // Bitbucket/Dropbox raw links often redirect
      });
    } catch {
      return new Response('Upstream fetch failed', { status: 502, headers: CORS });
    }

    if (!upstream.ok) {
      return new Response('Upstream returned ' + upstream.status, { status: 502, headers: CORS });
    }

    const body = await upstream.text();
    if (body.length > MAX_BYTES) {
      return new Response('File too large', { status: 413, headers: CORS });
    }

    return new Response(body, {
      headers: {
        ...CORS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};

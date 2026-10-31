/**
 * Cloudflare Worker API for the GitHub Pages QR Referral Campaign.
 * Database: Cloudflare D1 (SQLite dialect). No Node.js server required.
 * Secret bindings (wrangler secret put): ADMIN_TOKEN, VISITOR_SECRET.
 * Plain variables: CAMPAIGN_SLUG, SITE_ORIGIN.
 */
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const validId = /^[a-f0-9]{32}$/;
const CAMPAIGN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function getSiteOrigin(env) {
  try {
    const url = new URL(env.SITE_ORIGIN);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
function headersFor(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}
async function sha256(raw) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(raw)));
}
async function isAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (typeof expected !== 'string' || expected.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  if (!supplied.startsWith('Bearer ') || supplied.length > 4096) return false;
  const token = supplied.substring('Bearer '.length);
  const [left, right] = await Promise.all([sha256(token), sha256(expected)]);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
async function visitorHash(visitorId, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`referral-visitor:${visitorId}`))));
}
async function issueCode(env, campaign, visitorId) {
  const visitor = await visitorHash(visitorId, env.VISITOR_SECRET);
  const existing = await env.DB.prepare(
    'SELECT code, created_at FROM referrals WHERE campaign_slug = ? AND visitor_hash = ?'
  ).bind(campaign, visitor).first();
  if (existing) return { campaign, code: existing.code, createdAt: existing.created_at, reused: true };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `REF-${hex(crypto.getRandomValues(new Uint8Array(8))).toUpperCase()}`;
    const createdAt = new Date().toISOString();
    // D1 UNIQUE constraints mean simultaneous requests for the same visitor
    // result in exactly one row; code collisions are retried.
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO referrals (campaign_slug, code, visitor_hash, created_at) VALUES (?, ?, ?, ?)'
    ).bind(campaign, code, visitor, createdAt).run();
    const row = await env.DB.prepare(
      'SELECT code, created_at FROM referrals WHERE campaign_slug = ? AND visitor_hash = ?'
    ).bind(campaign, visitor).first();
    if (row) return { campaign, code: row.code, createdAt: row.created_at,
      reused: Number(result.meta?.changes ?? 0) === 0 };
  }
  throw new Error('Unable to issue a unique referral code.');
}
function csvCell(value) {
  let str = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(str)) str = "'" + str;
  return `"${str.replaceAll('"', '""')}"`;
}
function exportCsv(env, campaign, corsHeaders) {
  let cursor = Number.MAX_SAFE_INTEGER;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('\uFEFFcode,campaign,created_at\r\n'));
    },
    async pull(controller) {
      try {
        const result = await env.DB.prepare(
          'SELECT id, code, campaign_slug, created_at FROM referrals WHERE campaign_slug = ? AND id < ? ORDER BY id DESC LIMIT 500'
        ).bind(campaign, cursor).all();
        const rows = result.results ?? [];
        if (rows.length === 0) { controller.close(); return; }
        cursor = rows[rows.length - 1].id;
        const chunk = rows.map(row => [row.code, row.campaign_slug, row.created_at].map(csvCell).join(',') + '\r\n').join('');
        controller.enqueue(encoder.encode(chunk));
      } catch (error) { controller.error(error); }
    }
  });
  return new Response(stream, { status: 200, headers: {
    ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="referrals-${campaign}.csv"`
  } });
}
export default {
  async fetch(request, env) {
    const siteOrigin = getSiteOrigin(env);
    if (!siteOrigin || !CAMPAIGN_PATTERN.test(env.CAMPAIGN_SLUG || '')) {
      return json({ error: 'Worker configuration incomplete: update SITE_ORIGIN and CAMPAIGN_SLUG.' }, 503,
        { 'Cache-Control': 'no-store' });
    }
    const cors = headersFor(siteOrigin);
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, service: 'qr-referral-api' }, 200, cors);
    }
    // Only the configured GitHub Pages site may call the API from a browser.
    // This is not a substitute for authentication on the admin endpoints.
    if (request.headers.get('Origin') !== siteOrigin) {
      return json({ error: 'Origin not allowed.' }, 403, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.DB) return json({ error: 'D1 database not configured.' }, 503, cors);

    try {
      if (pathname === '/api/referrals' && request.method === 'POST') {
        if (typeof env.VISITOR_SECRET !== 'string' || env.VISITOR_SECRET.length < 32) {
          return json({ error: 'Visitor secret is not configured.' }, 503, cors);
        }
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'JSON body required.' }, 415, cors);
        }
        if (Number(request.headers.get('Content-Length') || 0) > 2048) {
          return json({ error: 'Request too large.' }, 413, cors);
        }
        const raw = await request.text();
        if (raw.length > 2048) return json({ error: 'Request too large.' }, 413, cors);
        let data;
        try { data = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400, cors); }
        if (data?.campaign !== env.CAMPAIGN_SLUG || !validId.test(data?.visitorId || '')) {
          return json({ error: 'Invalid campaign or visitor ID.' }, 400, cors);
        }
        const result = await issueCode(env, env.CAMPAIGN_SLUG, data.visitorId);
        return json(result, result.reused ? 200 : 201, cors);
      }
      if (pathname.startsWith('/api/admin/') && request.method === 'GET') {
        if (!await isAdmin(request, env)) return json({ error: 'Invalid admin token.' }, 401, cors);
        if (pathname === '/api/admin/stats') {
          const totalResult = await env.DB.prepare(
            'SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ?'
          ).bind(env.CAMPAIGN_SLUG).first();
          const recentResult = await env.DB.prepare(
            'SELECT code, created_at AS createdAt FROM referrals WHERE campaign_slug = ? ORDER BY id DESC LIMIT 100'
          ).bind(env.CAMPAIGN_SLUG).all();
          return json({ campaign: env.CAMPAIGN_SLUG, total: Number(totalResult?.total ?? 0),
            recent: recentResult.results ?? [] }, 200, cors);
        }
        if (pathname === '/api/admin/export.csv') return exportCsv(env, env.CAMPAIGN_SLUG, cors);
      }
      return json({ error: 'Not found.' }, 404, cors);
    } catch (error) {
      // Log only general failure; never log secrets or visitor IDs.
      console.error('Referral API error:', error?.message || 'Unknown error');
      return json({ error: 'Unexpected server or database error.' }, 500, cors);
    }
  }
};

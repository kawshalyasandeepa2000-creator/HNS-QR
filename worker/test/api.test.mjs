import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const schema = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const allowedOrigin = 'https://example.github.io';
const body = { campaign: 'outdoor-2026', visitorId: 'a'.repeat(32) };
function dbAdapter() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    prepare(sql) {
      const query = db.prepare(sql);
      return {
        bind(...params) {
          return {
            first: async () => query.get(...params),
            all: async () => ({ results: query.all(...params) }),
            run: async () => ({ meta: { changes: query.run(...params).changes } })
          };
        }
      };
    },
    close() { db.close(); }
  };
}
const env = () => ({
  DB: dbAdapter(),
  CAMPAIGN_SLUG: 'outdoor-2026',
  SITE_ORIGIN: allowedOrigin,
  ADMIN_TOKEN: 'a'.repeat(64),
  VISITOR_SECRET: 'b'.repeat(64)
});
function req(path, { method = 'GET', origin = allowedOrigin, token, json } = {}) {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (json) headers.set('Content-Type', 'application/json');
  return new Request('https://api.example.workers.dev' + path,
    { method, headers, ...(json ? { body: JSON.stringify(json) } : {}) });
}

test('same browser gets same referral, another browser gets a different one', async () => {
  const config = env();
  try {
    const one = await worker.fetch(req('/api/referrals', { method: 'POST', json: body }), config);
    assert.equal(one.status, 201);
    const a = await one.json(); assert.match(a.code, /^REF-[0-9A-F]{16}$/);
    const two = await worker.fetch(req('/api/referrals', { method: 'POST', json: body }), config);
    assert.equal(two.status, 200);
    const b = await two.json(); assert.equal(b.code, a.code); assert.equal(b.reused, true);
    const three = await worker.fetch(req('/api/referrals', { method: 'POST', json: { ...body, visitorId: 'b'.repeat(32) } }), config);
    assert.equal(three.status, 201); assert.notEqual((await three.json()).code, a.code);
    const stats = await worker.fetch(req('/api/admin/stats', { token: config.ADMIN_TOKEN }), config);
    assert.equal(stats.status, 200); assert.equal((await stats.json()).total, 2);
  } finally { config.DB.close(); }
});

test('rejects wrong website origin and wrong admin token', async () => {
  const config = env();
  try {
    assert.equal((await worker.fetch(req('/api/referrals', { method: 'POST', origin: 'https://bad.example', json: body }), config)).status, 403);
    assert.equal((await worker.fetch(req('/api/admin/stats', { token: 'bad' }), config)).status, 401);
    const options = await worker.fetch(req('/api/referrals', { method: 'OPTIONS' }), config);
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
    const invalidId = await worker.fetch(req('/api/referrals', { method: 'POST', json: { ...body, visitorId: 'bad' } }), config);
    assert.equal(invalidId.status, 400);
  } finally { config.DB.close(); }
});

test('admin can download SQL records as CSV', async () => {
  const config = env();
  try {
    await worker.fetch(req('/api/referrals', { method: 'POST', json: body }), config);
    const csvResponse = await worker.fetch(req('/api/admin/export.csv', { token: config.ADMIN_TOKEN }), config);
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.match(csv, /code,campaign,created_at/);
    assert.match(csv, /REF-[0-9A-F]{16}/);
  } finally { config.DB.close(); }
});

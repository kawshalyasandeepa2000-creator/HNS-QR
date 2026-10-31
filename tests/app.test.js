import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import Database from 'better-sqlite3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      server.close(() => resolvePort(p));
    });
    server.on('error', reject);
  });
}

test('QR referral, duplicate visits, database and CSV admin flow', { timeout: 30000 }, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'qr-referrals-'));
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const adminPassword = randomBytes(24).toString('hex');
  const dbPath = join(temporary, 'referrals.sqlite');
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_BASE_URL: origin,
      CAMPAIGN_SLUG: 'event-test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: adminPassword,
      COOKIE_SECRET: randomBytes(48).toString('hex'),
      DB_PATH: dbPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', c => { output += c; });
  server.stderr.on('data', c => { output += c; });
  try {
    let up = false;
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) break;
      try { const r = await fetch(`${origin}/api/config`); if (r.ok) { up = true; break; } }
      catch { /* still starting */ }
      await sleep(200);
    }
    assert.equal(up, true, `Server did not start: ${output}`);
    const route = await fetch(`${origin}/c/event-test`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /Download code as PNG/);

    const claim = (cookie = '') => fetch(`${origin}/api/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ campaign: 'event-test' })
    });
    const first = await claim();
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.match(firstBody.code, /^REF-[0-9A-F]{16}$/);
    const firstCookie = first.headers.get('set-cookie').split(';')[0];
    const again = await claim(firstCookie);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).code, firstBody.code);

    const simultaneousRepeats = await Promise.all(Array.from({ length: 10 }, () => claim(firstCookie)));
    assert.ok(simultaneousRepeats.every(r => r.status === 200));
    assert.ok((await Promise.all(simultaneousRepeats.map(r => r.json()))).every(x => x.code === firstBody.code));
    const others = await Promise.all(Array.from({ length: 30 }, () => claim()));
    assert.ok(others.every(r => r.status === 201));
    const otherCodes = await Promise.all(others.map(r => r.json()));
    assert.equal(new Set([firstBody.code, ...otherCodes.map(x => x.code)]).size, 31);
    const invalidOrigin = await fetch(`${origin}/api/referrals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
      body: JSON.stringify({ campaign: 'event-test' })
    });
    assert.equal(invalidOrigin.status, 403);
    const bad = await fetch(`${origin}/api/admin/stats`);
    assert.equal(bad.status, 401);
    const auth = { Authorization: 'Basic ' + Buffer.from('admin:' + adminPassword).toString('base64') };
    const stats = await fetch(`${origin}/api/admin/stats`, { headers: auth });
    assert.equal(stats.status, 200);
    const data = await stats.json();
    assert.equal(data.total, 31);
    assert.equal(data.qrTarget, `${origin}/c/event-test`);
    const qr = await fetch(`${origin}/admin/qr.png`, { headers: auth });
    assert.equal(qr.status, 200);
    const bytes = Buffer.from(await qr.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const csv = await fetch(`${origin}/api/admin/export.csv`, { headers: auth });
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    assert.match(csvText, new RegExp(firstBody.code));
    assert.equal(csvText.trim().split('\n').length, 32);
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM referrals').get().total, 31);
    db.close();
  } finally {
    server.kill('SIGTERM');
    await sleep(350);
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

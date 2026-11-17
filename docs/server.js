import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const campaign = process.env.CAMPAIGN_SLUG || 'outdoor-2026';
const baseUrl = process.env.APP_BASE_URL || '';
const adminUser = process.env.ADMIN_USERNAME || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const cookieSecret = process.env.COOKIE_SECRET || '';
const dbPath = resolve(projectRoot, process.env.DB_PATH || './data/referrals.sqlite');

if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid PORT');
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(campaign)) throw new Error('Invalid CAMPAIGN_SLUG');
if (!adminUser || adminPassword.length < 16 || cookieSecret.length < 32) {
  throw new Error('Admin credentials/secrets missing or weak. Run npm run setup first.');
}
let publicOrigin;
try {
  const u = new URL(baseUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
    throw new Error('URL should be just the origin');
  }
  publicOrigin = u.origin;
} catch {
  throw new Error('Set APP_BASE_URL to your site origin, e.g. https://yourdomain.com');
}
if (process.env.NODE_ENV === 'production' && !publicOrigin.startsWith('https://')) {
  throw new Error('Production APP_BASE_URL must use HTTPS');
}
const isHttps = publicOrigin.startsWith('https://');
const qrTarget = `${publicOrigin}/c/${campaign}`;

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
db.exec(readFileSync(join(projectRoot, 'sql/schema.sql'), 'utf8'));

const selectByVisitor = db.prepare('SELECT code, created_at FROM referrals WHERE campaign_slug = ? AND visitor_hash = ?');
const insertReferral = db.prepare('INSERT OR IGNORE INTO referrals (campaign_slug, code, visitor_hash, created_at) VALUES (?, ?, ?, ?)');
function getOrCreate(slug, visitorHash) {
  // A single transaction protects uniqueness for simultaneous customers.
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = selectByVisitor.get(slug, visitorHash);
    if (existing) {
      db.exec('COMMIT');
      return { code: existing.code, createdAt: existing.created_at, reused: true };
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = `REF-${randomBytes(8).toString('hex').toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const result = insertReferral.run(slug, code, visitorHash, createdAt);
      if (Number(result.changes) === 1) {
        db.exec('COMMIT');
        return { code, createdAt, reused: false };
      }
      const concurrentlyCreated = selectByVisitor.get(slug, visitorHash);
      if (concurrentlyCreated) {
        db.exec('COMMIT');
        return { code: concurrentlyCreated.code, createdAt: concurrentlyCreated.created_at, reused: true };
      }
      // Rare collision with a code already issued; try another random code.
    }
    throw new Error('Could not allocate a unique referral code');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function mac(message) {
  return createHmac('sha256', cookieSecret).update(message).digest('hex');
}
function getVisitorId(req, res) {
  const rawCookies = req.headers.cookie || '';
  const item = rawCookies.split(';').map(x => x.trim()).find(x => x.startsWith('qr_visitor='));
  const signed = item ? item.slice('qr_visitor='.length) : '';
  const match = /^([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(signed);
  if (match) {
    const given = Buffer.from(match[2], 'hex');
    const expected = Buffer.from(mac(match[1]), 'hex');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return match[1];
  }
  const id = randomBytes(24).toString('hex');
  res.cookie('qr_visitor', `${id}.${mac(id)}`, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  return id;
}

function fixedTimeEqual(a, b) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function adminOnly(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const authorization = req.get('authorization') || '';
  let givenUser = '', givenPassword = '';
  if (authorization.startsWith('Basic ')) {
    try {
      const pair = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const boundary = pair.indexOf(':');
      if (boundary >= 0) {
        givenUser = pair.slice(0, boundary);
        givenPassword = pair.slice(boundary + 1);
      }
    } catch { /* invalid authorization */ }
  }
  if (fixedTimeEqual(givenUser, adminUser) && fixedTimeEqual(givenPassword, adminPassword)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Campaign Admin", charset="UTF-8"');
  return res.status(401).send('Admin login required');
}
function csvField(input) {
  const s = String(input ?? '');
  // Protect spreadsheet users from formula injection if future columns become editable.
  const safe = /^[=+@\-\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: isHttps ? [] : null
  }
} }));
app.use(express.json({ limit: '4kb' }));
app.use(express.static(join(projectRoot, 'public'), { index: false, maxAge: '1h' }));

app.get('/', (_req, res) => res.redirect(302, `/c/${campaign}`));
app.get('/c/:slug', (req, res) => {
  if (req.params.slug !== campaign) return res.status(404).send('Campaign not found');
  res.set('Cache-Control', 'no-store');
  return res.sendFile(join(projectRoot, 'public/index.html'));
});
app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ campaign });
});

// A generous per-IP limit avoids blocking a crowd sharing one venue Wi-Fi IP.
const referralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' }
});
app.post('/api/referrals', referralLimiter, (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && origin !== publicOrigin) return res.status(403).json({ error: 'Invalid origin' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
    if (req.body?.campaign !== campaign) return res.status(400).json({ error: 'Invalid campaign' });
    const visitorId = getVisitorId(req, res);
    const visitorHash = createHmac('sha256', cookieSecret).update('visitor:' + visitorId).digest('hex');
    const result = getOrCreate(campaign, visitorHash);
    return res.status(result.reused ? 200 : 201).json({
      campaign,
      code: result.code,
      createdAt: result.createdAt,
      reused: result.reused
    });
  } catch (err) { next(err); }
});

app.get('/admin', adminOnly, (_req, res) => res.sendFile(join(projectRoot, 'private/admin.html')));
app.get('/api/admin/stats', adminOnly, (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE campaign_slug = ?').get(campaign).n;
  const recent = db.prepare('SELECT code, created_at AS createdAt FROM referrals WHERE campaign_slug = ? ORDER BY id DESC LIMIT 100').all(campaign);
  res.json({ campaign, qrTarget, total, recent });
});
app.get('/api/admin/export.csv', adminOnly, (_req, res) => {
  const rows = db.prepare('SELECT code, campaign_slug, created_at FROM referrals WHERE campaign_slug = ? ORDER BY id DESC').iterate(campaign);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="referrals-${campaign}.csv"`,
    'Cache-Control': 'no-store'
  });
  res.write('\uFEFFcode,campaign,created_at\r\n');
  for (const row of rows) {
    res.write([row.code, row.campaign_slug, row.created_at].map(csvField).join(',') + '\r\n');
  }
  res.end();
});
app.get('/admin/qr.png', adminOnly, async (_req, res, next) => {
  try {
    const png = await QRCode.toBuffer(qrTarget, {
      type: 'png', errorCorrectionLevel: 'H', margin: 4, width: 1200,
      color: { dark: '#0f172a', light: '#ffffff' }
    });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="campaign-qr.png"' });
    res.send(png);
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Unexpected server error' });
});

const server = app.listen(port, () => {
  console.log(`Customer page: ${qrTarget}`);
  console.log(`Admin page:     ${publicOrigin}/admin`);
  console.log(`Database file:  ${dbPath}`);
});
function shutDown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

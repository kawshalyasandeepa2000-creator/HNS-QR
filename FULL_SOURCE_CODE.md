# Complete Source Code — QR Referral Campaign

This is a convenience copy. The ZIP contains the original editable source files and folder structure.

## `package.json`

```json
{
  "name": "qr-referral-campaign",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Outdoor campaign QR-to-referral website with SQLite and CSV export",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "setup": "node scripts/setup.js",
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "better-sqlite3": "^13.0.3",
    "dotenv": "^16.6.1",
    "express": "^5.3.0",
    "express-rate-limit": "^8.7.1",
    "helmet": "^8.3.0",
    "qrcode": "^1.5.4"
  }
}
```

## `.env.example`

```text
# Run `npm run setup` to create an actual .env with random secrets.
APP_BASE_URL=http://localhost:3000
PORT=3000
NODE_ENV=development
CAMPAIGN_SLUG=outdoor-2026
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YOUR_RANDOM_PASSWORD_FROM_SETUP
COOKIE_SECRET=YOUR_RANDOM_SECRET_FROM_SETUP
DB_PATH=./data/referrals.sqlite
```

## `.gitignore`

```text
node_modules/
.env
*.log
.DS_Store
data/*
!data/.gitkeep
coverage/
```

## `server.js`

```javascript
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import Database from 'better-sqlite3';
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
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(readFileSync(join(projectRoot, 'sql/schema.sql'), 'utf8'));

const selectByVisitor = db.prepare('SELECT code, created_at FROM referrals WHERE campaign_slug = ? AND visitor_hash = ?');
const insertReferral = db.prepare('INSERT INTO referrals (campaign_slug, code, visitor_hash, created_at) VALUES (?, ?, ?, ?)');
const getOrCreate = db.transaction((slug, visitorHash) => {
  const existing = selectByVisitor.get(slug, visitorHash);
  if (existing) return { code: existing.code, createdAt: existing.created_at, reused: true };

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `REF-${randomBytes(8).toString('hex').toUpperCase()}`;
    const createdAt = new Date().toISOString();
    try {
      insertReferral.run(slug, code, visitorHash, createdAt);
      return { code, createdAt, reused: false };
    } catch (err) {
      if (!String(err.code || '').startsWith('SQLITE_CONSTRAINT')) throw err;
      const concurrentlyCreated = selectByVisitor.get(slug, visitorHash);
      if (concurrentlyCreated) return { code: concurrentlyCreated.code, createdAt: concurrentlyCreated.created_at, reused: true };
      // A rare random-code collision. Try another value.
    }
  }
  throw new Error('Could not allocate a unique referral code');
});

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
    const result = getOrCreate.immediate(campaign, visitorHash);
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
```

## `sql/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_slug TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  visitor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_slug, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_referrals_campaign_created
  ON referrals (campaign_slug, created_at DESC);

-- Example: see all codes, latest first:
-- SELECT code, campaign_slug, created_at FROM referrals ORDER BY id DESC;
-- Example: total codes for a campaign:
-- SELECT COUNT(*) FROM referrals WHERE campaign_slug = 'outdoor-2026';
```

## `scripts/setup.js`

```javascript
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.env');
if (existsSync(output)) {
  console.log('.env already exists. No changes made.');
  process.exit(0);
}
const adminPassword = randomBytes(18).toString('base64url');
const cookieSecret = randomBytes(48).toString('hex');
const data = [
  '# Edit APP_BASE_URL before printing QR codes or going live.',
  'APP_BASE_URL=http://localhost:3000',
  'PORT=3000',
  'NODE_ENV=development',
  'CAMPAIGN_SLUG=outdoor-2026',
  'ADMIN_USERNAME=admin',
  `ADMIN_PASSWORD=${adminPassword}`,
  `COOKIE_SECRET=${cookieSecret}`,
  'DB_PATH=./data/referrals.sqlite',
  ''
].join('\n');
writeFileSync(output, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log('Created .env. Keep it private (never upload it to GitHub).');
console.log('Admin username: admin');
console.log(`Admin password: ${adminPassword}`);
console.log('Your local admin page: http://localhost:3000/admin');
```

## `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0f766e" />
  <title>Claim Your Referral Code</title>
  <link rel="stylesheet" href="/style.css" />
  <script src="/app.js" defer></script>
</head>
<body class="customer-page">
  <main class="layout">
    <div class="intro">
      <div class="eyebrow"><span class="dot"></span> OUTDOOR CAMPAIGN</div>
      <h1>Your next reward<br /><span>starts here.</span></h1>
      <p>Thanks for visiting us! Your personal referral code is ready to be created automatically.</p>
      <div class="features"><span>✓ Unique code</span><span>✓ Instant access</span><span>✓ Save & share</span></div>
    </div>

    <section class="ticket" aria-labelledby="ticket-title">
      <div class="ticket-top">
        <div class="ticket-label">YOUR REFERRAL PASS</div>
        <h2 id="ticket-title">A little something for you.</h2>
        <p id="status" role="status" aria-live="polite">Generating your code...</p>
      </div>
      <div class="ticket-middle">
        <div class="code-caption">YOUR UNIQUE CODE</div>
        <div id="referral-code" class="code loading" aria-live="polite">•••• •••• ••••</div>
        <div id="created-at" class="date"></div>
      </div>
      <div class="ticket-actions">
        <button id="download-button" class="button primary" disabled>↓ Download code as PNG</button>
        <button id="copy-button" class="button secondary" disabled>Copy code</button>
        <button id="retry-button" class="button secondary hidden">Try again</button>
      </div>
      <div class="ticket-footer">Keep your code safe. Show or share it when participating in the referral program.</div>
    </section>
    <footer class="site-footer">One referral code per browser for this campaign. Terms and referral rewards are determined by the campaign organizer.</footer>
  </main>
</body>
</html>
```

## `public/app.js`

```javascript
const codeElement = document.querySelector('#referral-code');
const statusElement = document.querySelector('#status');
const createdAtElement = document.querySelector('#created-at');
const downloadButton = document.querySelector('#download-button');
const copyButton = document.querySelector('#copy-button');
const retryButton = document.querySelector('#retry-button');
let referral = null;

async function loadReferral() {
  statusElement.textContent = 'Generating your code...';
  retryButton.classList.add('hidden');
  downloadButton.disabled = true;
  copyButton.disabled = true;
  try {
    const parts = location.pathname.split('/');
    const campaign = parts[1] === 'c' ? parts[2] : null;
    if (!campaign) throw new Error('Campaign link is not valid.');
    const response = await fetch('/api/referrals', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not create your code.');
    referral = data;
    codeElement.textContent = data.code;
    codeElement.classList.remove('loading');
    statusElement.textContent = data.reused ? 'Welcome back! Here is your saved code.' : 'Success! Your code is ready.';
    createdAtElement.textContent = 'Issued: ' + new Date(data.createdAt).toLocaleString();
    downloadButton.disabled = false;
    copyButton.disabled = false;
  } catch (err) {
    statusElement.textContent = err.message || 'Something went wrong.';
    codeElement.textContent = 'Unavailable';
    createdAtElement.textContent = '';
    retryButton.classList.remove('hidden');
  }
}

async function downloadCard() {
  if (!referral) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f0fdfa';
  context.fillRect(0, 0, 1200, 630);
  context.fillStyle = '#115e59';
  context.fillRect(0, 0, 1200, 165);
  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  context.font = 'bold 32px Arial, sans-serif';
  context.fillText('YOUR REFERRAL PASS', 600, 92);
  context.fillStyle = '#0f172a';
  context.font = 'bold 42px Arial, sans-serif';
  context.fillText('Thanks for visiting!', 600, 262);
  context.fillStyle = '#0f766e';
  context.font = 'bold 65px monospace';
  context.fillText(referral.code, 600, 376);
  context.fillStyle = '#475569';
  context.font = '26px Arial, sans-serif';
  context.fillText(`Campaign: ${referral.campaign}`, 600, 455);
  context.font = '24px Arial, sans-serif';
  context.fillText('Save this code to share or redeem according to campaign terms.', 600, 515);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { statusElement.textContent = 'Could not create download. Please copy your code.'; return; }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${referral.code}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyCode() {
  if (!referral) return;
  try {
    await navigator.clipboard.writeText(referral.code);
    const previous = copyButton.textContent;
    copyButton.textContent = 'Copied!';
    setTimeout(() => { copyButton.textContent = previous; }, 1500);
  } catch { statusElement.textContent = 'Copy unavailable. Select and copy the code above.'; }
}

downloadButton.addEventListener('click', downloadCard);
copyButton.addEventListener('click', copyCode);
retryButton.addEventListener('click', loadReferral);
loadReferral();
```

## `public/style.css`

```css
:root{color-scheme:light;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-synthesis:none;--ink:#102a33;--teal:#0f766e;--muted:#657680;--line:#e2ecea}
*{box-sizing:border-box}body{margin:0;color:var(--ink)}.customer-page{min-height:100vh;background:radial-gradient(circle at 0 0,#c9f9e4 0%,transparent 44%),linear-gradient(135deg,#f4fff9,#dff7f4 60%,#eefcfb)}.layout{max-width:1100px;min-height:100vh;margin:auto;padding:70px 26px 24px;display:grid;grid-template-columns:1fr 470px;align-items:center;column-gap:65px}.intro{padding-bottom:60px}.eyebrow{color:#0c7668;font-size:12px;letter-spacing:.2em;font-weight:800;display:flex;align-items:center;gap:9px}.dot{height:9px;width:9px;display:inline-block;background:#18a879;border-radius:50%}.intro h1{font-size:clamp(44px,6vw,76px);letter-spacing:-.055em;line-height:1.06;margin:26px 0}.intro h1 span{color:#087e71}.intro p{font-size:19px;line-height:1.7;max-width:450px;color:#60767b}.features{display:flex;flex-wrap:wrap;gap:10px;margin-top:25px}.features span{background:#ffffff9c;color:#18665f;border:1px solid #d6ede5;padding:10px 13px;border-radius:50px;font-size:12px;font-weight:700}.ticket{background:#fff;border-radius:27px;box-shadow:0 22px 80px #114c4629;border:1px solid #def0e9;overflow:hidden}.ticket-top{padding:32px 36px 26px;background:#0e5c55;color:#fff}.ticket-label{font-size:11px;font-weight:800;letter-spacing:.2em;color:#a3f0da}.ticket-top h2{margin:14px 0;font-size:28px;letter-spacing:-.03em}.ticket-top p{color:#d2f4ea;font-size:14px;line-height:1.5;min-height:20px}.ticket-middle{padding:42px 22px 36px;text-align:center;border-bottom:2px dashed #d8e9e7;position:relative}.code-caption{font-size:11px;letter-spacing:.18em;font-weight:800;color:#698884}.code{font-size:clamp(20px,3vw,30px);font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:900;color:#0b6d64;letter-spacing:.06em;overflow-wrap:anywhere;padding:22px 3px}.code.loading{color:#9bb3b0}.date{font-size:12px;color:#879a98}.ticket-actions{display:grid;gap:11px;padding:28px 30px 18px}.button{display:inline-flex;justify-content:center;align-items:center;border-radius:12px;border:1px solid transparent;text-decoration:none;min-height:48px;padding:12px 17px;font:700 14px inherit;cursor:pointer;font-size:14px;font-weight:750;transition:transform .14s ease,opacity .14s ease}.button:hover:not(:disabled){transform:translateY(-1px)}.button:disabled{opacity:.48;cursor:not-allowed}.primary{background:var(--teal);color:white}.secondary{background:#eef8f5;color:#155d58;border-color:#deeeea}.outline{background:white;border-color:#c8dfd9;color:#16655e}.hidden{display:none!important}.ticket-footer{text-align:center;font-size:12px;color:#8a9c9b;line-height:1.55;padding:0 32px 30px}.site-footer{grid-column:1/-1;text-align:center;font-size:12px;color:#7e9692;margin-top:26px}.admin-page{background:#f6faf9}.admin-shell{max-width:1320px;margin:0 auto;padding:44px 28px 70px}.admin-header{display:flex;justify-content:space-between;gap:20px;align-items:center}.admin-header h1{font-size:38px;letter-spacing:-.04em;margin:15px 0 8px}.admin-header p,.admin-panel>p{color:var(--muted)}.admin-cards{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:26px 0}.stat-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px}.stat-card div{font-size:13px;color:#718782}.stat-card strong{display:block;font-size:26px;margin-top:12px}.admin-columns{display:grid;grid-template-columns:430px 1fr;gap:20px;align-items:start}.admin-panel{background:white;border-radius:18px;border:1px solid var(--line);padding:26px;overflow:hidden}.admin-panel>h2,.section-header h2{font-size:20px;margin:0}.admin-panel>p{font-size:14px;line-height:1.55}.poster{background:#e5f8ef;border:2px solid #0c695e;margin:20px auto 18px;max-width:350px;min-height:485px;display:flex;align-items:center;flex-direction:column;justify-content:center;padding:24px 17px;text-align:center}.poster-eyebrow{color:#17756b;font-size:10px;font-weight:800;letter-spacing:.17em}.poster h2{font-size:26px;line-height:1.12;margin:18px 0 13px;letter-spacing:-.025em}.poster p{font-size:13px;line-height:1.6;margin:0;color:#456d66}.qr-image{display:block;width:230px;height:230px;margin:15px auto;image-rendering:pixelated}.qr-url{font-size:10px;word-break:break-all;color:#205d57}.poster-actions{display:flex;gap:8px;flex-wrap:wrap}.hint{font-size:12px!important}.section-header{display:flex;align-items:center;justify-content:space-between;gap:15px}.small{min-height:38px;padding:7px 12px}.table-scroll{overflow:auto;max-height:620px}table{width:100%;border-collapse:collapse;min-width:440px}th{text-align:left;color:#65847d;font-size:12px;background:#f4faf7;position:sticky;top:0}td{font-size:13px;color:#304c48}td,th{padding:14px;border-bottom:1px solid #e4efeb}td:first-child{font-weight:700;font-family:ui-monospace,monospace}.error{color:#b91c1c!important}
@media(max-width:860px){.layout{grid-template-columns:1fr;max-width:550px;padding:50px 17px 22px;gap:25px}.intro{padding-bottom:0;text-align:center}.intro p{font-size:16px}.intro .eyebrow,.features{justify-content:center}.intro h1{font-size:47px}.ticket{width:100%}.site-footer{grid-column:1}.admin-columns{grid-template-columns:1fr}.admin-header{align-items:flex-start;flex-direction:column}}
@media(max-width:480px){.ticket-top{padding:27px}.ticket-middle{padding:31px 15px}.ticket-actions{padding:23px}.admin-shell{padding:28px 12px}.admin-cards{grid-template-columns:1fr}.admin-panel{padding:17px}.poster{padding:20px 12px}}
@page{size:A4 portrait;margin:10mm}
@media print{body.admin-page{background:#fff}.admin-shell>*{display:none!important}.admin-shell{padding:0}.admin-columns{display:block!important}.admin-panel{display:none!important;border:0!important;padding:0!important}.poster-panel{display:block!important}.poster-panel>*{display:none!important}.poster-panel .poster{display:flex!important;max-width:none;width:185mm;height:263mm;margin:0 auto;border:3px solid #0c695e;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}.poster h2{font-size:46px}.poster p{font-size:22px}.poster .poster-eyebrow{font-size:17px}.poster .qr-image{width:112mm;height:112mm}.poster .qr-url{font-size:15px}}
```

## `private/admin.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Campaign Admin</title>
  <link rel="stylesheet" href="/style.css" />
  <script src="/admin.js" defer></script>
</head>
<body class="admin-page">
  <div class="admin-shell">
    <header class="admin-header">
      <div><div class="eyebrow">CAMPAIGN CONTROL CENTER</div><h1>Referral dashboard</h1><p>Print one QR for everyone. Track unique codes securely.</p></div>
      <a class="button outline" href="/api/admin/export.csv">↓ Export all codes (CSV)</a>
    </header>
    <section class="admin-cards">
      <div class="stat-card"><div>Campaign</div><strong id="campaign-name">Loading...</strong></div>
      <div class="stat-card"><div>Referral codes issued</div><strong id="total-count">—</strong></div>
    </section>
    <div class="admin-columns">
      <section class="admin-panel poster-panel">
        <h2>Printable QR flyer</h2>
        <p>All printed copies contain the same campaign URL.</p>
        <div class="poster" id="poster">
          <div class="poster-eyebrow">SCAN • JOIN • SHARE</div>
          <h2>SCAN & GET YOUR<br />REFERRAL CODE</h2>
          <p>Scan with your phone camera and download your unique code instantly.</p>
          <img class="qr-image" src="/admin/qr.png" alt="Your campaign QR code" />
          <div id="qr-url" class="qr-url"></div>
        </div>
        <div class="poster-actions">
          <button class="button primary" id="print-button">Print flyer</button>
          <a class="button secondary" href="/admin/qr.png" download="campaign-qr.png">Download QR PNG</a>
        </div>
        <p class="hint">Print at 100% with strong contrast. Test the QR on a real phone before printing flyers.</p>
      </section>
      <section class="admin-panel">
        <div class="section-header"><h2>Latest referral codes</h2><button class="button secondary small" id="refresh-button">Refresh</button></div>
        <p>Showing the latest 100. Export CSV for every code.</p>
        <div class="table-scroll"><table><thead><tr><th>Referral code</th><th>Created (UTC)</th></tr></thead><tbody id="referral-rows"><tr><td colspan="2">Loading...</td></tr></tbody></table></div>
        <p id="admin-error" class="error" role="alert"></p>
      </section>
    </div>
  </div>
</body>
</html>
```

## `public/admin.js`

```javascript
const campaignName = document.querySelector('#campaign-name');
const totalCount = document.querySelector('#total-count');
const referralRows = document.querySelector('#referral-rows');
const adminError = document.querySelector('#admin-error');
const qrUrl = document.querySelector('#qr-url');
async function refresh() {
  adminError.textContent = '';
  try {
    const response = await fetch('/api/admin/stats', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load admin data. Check your login.');
    const data = await response.json();
    campaignName.textContent = data.campaign;
    totalCount.textContent = data.total.toLocaleString();
    qrUrl.textContent = data.qrTarget;
    referralRows.replaceChildren();
    if (!data.recent.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No referral codes yet. Scan the QR to create the first one.';
      tr.append(td);
      referralRows.append(tr);
    } else {
      for (const row of data.recent) {
        const tr = document.createElement('tr');
        for (const value of [row.code, row.createdAt]) {
          const td = document.createElement('td');
          td.textContent = value;
          tr.append(td);
        }
        referralRows.append(tr);
      }
    }
  } catch (error) { adminError.textContent = error.message; }
}
document.querySelector('#refresh-button').addEventListener('click', refresh);
document.querySelector('#print-button').addEventListener('click', () => window.print());
refresh();
```

## `tests/app.test.js`

```javascript
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
```

## `README.md`

```text
# Outdoor QR Referral Campaign — Complete JavaScript Website

One printed QR code, many visitors, unique downloadable referral codes, and an admin SQL/CSV export.

## What happens

1. The organizer prints the QR from `/admin` onto all campaign flyers.
2. A customer scans with their phone camera, opening `https://yourdomain.com/c/outdoor-2026`.
3. The browser calls `POST /api/referrals` automatically; no form or signup needed.
4. The server generates a cryptographically random code such as `REF-A08DF93C5E27B426` and saves it in a **SQLite SQL database**.
5. The visitor can **Download code as PNG** or **Copy code**.
6. The organizer logs into `/admin` to see the latest 100 codes or export **all** codes to a CSV file that opens in Excel/Google Sheets.

**Important:** The QR is **the same for everyone**. The code is unique per *browser cookie*, not a verified human identity. Reopening the page from the same browser yields the same code; different phones/browser profiles get different codes. Clearing cookies, private browsing, or another browser may issue a new code. A strict one-per-person policy requires customer signup plus verified phone OTP/account login (not included). Generating a code does not authenticate the customer or prove their identity.

## Requirements

- Node.js 22+ (Node 24 LTS is also suitable)
- npm
- A computer for local setup
- For printing a campaign QR usable by everyone: a publicly reachable HTTPS domain and Node.js hosting with **persistent disk** storage for `data/referrals.sqlite`

## Step-by-step local installation

```bash
# 1. Unzip the project and enter its directory.
cd qr-referral-campaign

# 2. Install Node dependencies.
npm install

# 3. Create .env, random admin password, and cookie signing secret.
npm run setup

# 4. Start the server.
npm start
```

Open **http://localhost:3000/c/outdoor-2026** to see the customer page.
Open **http://localhost:3000/admin** to see the admin dashboard. When the browser asks for credentials, use username `admin` and the password printed by `npm run setup`. If you forgot it, inspect `ADMIN_PASSWORD` inside your local `.env` file; **do not share it**.

Starting the server creates `data/referrals.sqlite` automatically. Scan from a different browser/profile to see another code. Localhost can only be reached from the same computer, so do **not** print its QR for customers.

## Step-by-step public launch

1. Get a domain, e.g. `campaign.example.com`.
2. Deploy this Node.js application to a VPS or hosting service that runs persistent Node processes and provides persistent storage. Examples: a VPS with Nginx + Node, or a platform offering a persistent volume. **Do not deploy SQLite to an ephemeral filesystem or deploy multiple independent replicas writing different SQLite files.** For multi-server scale, migrate to a hosted SQL service (PostgreSQL/MySQL) with centralized credentials/identity.
3. Set environment variables from `.env` on the server, especially:

   ```env
   NODE_ENV=production
   APP_BASE_URL=https://campaign.example.com
   CAMPAIGN_SLUG=outdoor-2026
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a-strong-random-password>
   COOKIE_SECRET=<at-least-32-random-characters>
   DB_PATH=./data/referrals.sqlite
   ```

4. Make your domain point to the server, configure HTTPS, forward traffic to Node on `PORT=3000` through your reverse proxy, and ensure the SQLite `data/` directory is writable and permanently stored. Do not expose that directory over the web. Do not commit `.env` to Git.
5. Restart your server after setting `APP_BASE_URL`, then visit `https://campaign.example.com/admin`.
6. Print the flyer via **Print flyer**, or choose **Download QR PNG** if you want to place it in your own leaflet design. Confirm the QR contains your **HTTPS live domain**, not `localhost`.
7. Test with **two different phones**. Both should receive different codes. On refreshing the same phone/browser, its code should stay the same.
8. Download the **Export all codes (CSV)** file and check the records in Excel.

**If you change `APP_BASE_URL` or `CAMPAIGN_SLUG` after printing, old printed QR links will not update.** Finalize the live URL before printing. Keep the same campaign and domain accessible for the campaign duration.

## URLs and functionality

| URL | Action | Access |
|---|---|---|
| `/c/outdoor-2026` | QR destination / customer referral page | Public |
| `/api/referrals` | Creates/returns code, JSON POST | Public, same-origin |
| `/admin` | Dashboard with flyer, print and download | Admin password |
| `/admin/qr.png` | High-resolution print QR | Admin password |
| `/api/admin/stats` | Count and latest 100 codes | Admin password |
| `/api/admin/export.csv` | Complete CSV list | Admin password |

### SQL data

SQLite is a real SQL database, **not a spreadsheet**. The generated file is at `data/referrals.sqlite`. It includes a `referrals` table with these columns:

| Column | Description |
|---|---|
| `id` | Sequential internal record ID |
| `campaign_slug` | Campaign whose QR was scanned |
| `code` | Unique referral code |
| `visitor_hash` | Pseudonymous hash, not personal name or phone |
| `created_at` | ISO UTC timestamp when code was created |

You can inspect the database using DB Browser for SQLite or command-line SQLite:

```sql
SELECT id, code, campaign_slug, created_at
FROM referrals
ORDER BY id DESC;
```

Export **all** codes via the dashboard to CSV (compatible with Excel). Use the CSV download instead of granting the public direct access to the SQL database.

## Test the project

```bash
npm test
```

The test automatically launches a disposable server and database; it checks different visitors get different codes, returning visitors get the same code, admin authentication, QR image format, and CSV export.

## Structure

```text
qr-referral-campaign/
  .env.example         # editable configuration template (no secrets)
  .gitignore           # excludes secrets and DB
  package.json         # dependencies, scripts
  server.js            # Express API, SQLite, QR image generation, admin access
  public/
    index.html         # customer referral page
    app.js             # auto-claim, copy and PNG download
    admin.js           # admin stats table
    style.css          # responsive customer/admin/print styles
  private/
    admin.html          # password-protected admin page
  scripts/
    setup.js           # generate secure local credentials
  sql/
    schema.sql         # SQLite database table
  data/
    .gitkeep           # runtime DB lives here (excluded from zip)
  tests/
    app.test.js         # integration checks
```

## Deployment/security notes

- Run your public site on **HTTPS** so visitor cookies and admin Basic authentication are encrypted in transit.
- Change `ADMIN_PASSWORD` to a unique strong password. Protect `/admin` behind a VPN/SSO if you have large-scale campaigns; Basic authentication is a small-project starter, not an enterprise admin system.
- The per-IP limiter is deliberately high for venues where many people share one Wi-Fi IP; it is **not** fraud prevention.
- Use a persistent disk and back up the database, including WAL/SHM files via SQLite's backup API or during a coordinated stop. Running against a non-persistent disk loses referrals on restarts.
- The QR image simply contains a website URL; the unique referral code is allocated by the backend **when the page loads**, not embedded in the printed QR image.
- A camera QR preview, antivirus link check, or manually opened URL is not necessarily a confirmed customer. The app does not collect names or verify referrals, purchases, or payouts. Add a redemption/attribution system before paying referral commissions.
- The frontend automatically calls the API once when opened. If cookies are disabled, a returning visitor might get a new code. Users must keep the code they've downloaded.
- A single SQLite database is appropriate for small/medium events on one Node server; for very high volumes or multiple replicas, migrate to a managed SQL database.
```

# Full source — GitHub Pages + Cloudflare Workers D1 QR Referral Website

## docs/index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0f766e">
  <title>Claim Your Referral Code</title>
  <link rel="stylesheet" href="./style.css">
  <script src="./config.js" defer></script>
  <script src="./app.js" defer></script>
</head>
<body class="customer-page">
  <main class="layout">
    <div class="intro">
      <div class="eyebrow"><span class="dot"></span> OUTDOOR CAMPAIGN</div>
      <h1>Your next reward<br><span>starts here.</span></h1>
      <p>Thanks for visiting us! Claim your individual referral code instantly. Keep it to share or redeem according to the campaign terms.</p>
      <div class="features"><span>✓ Unique code</span><span>✓ Instant access</span><span>✓ Save &amp; share</span></div>
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
      <div class="ticket-footer">Keep your referral code safe. The campaign organizer determines referral terms and rewards.</div>
    </section>
    <footer class="site-footer">One code per browser and campaign in normal use. Browser clearing or another device may produce a new code.</footer>
  </main>
</body>
</html>
```

## docs/app.js

```javascript
'use strict';
const cfg = window.CAMPAIGN_CONFIG;
const codeElement = document.querySelector('#referral-code');
const statusElement = document.querySelector('#status');
const createdAtElement = document.querySelector('#created-at');
const downloadButton = document.querySelector('#download-button');
const copyButton = document.querySelector('#copy-button');
const retryButton = document.querySelector('#retry-button');
let referral = null;

function getVisitorId(campaign) {
  const key = `qr-referral-visitor:${campaign}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
  } catch { /* storage unavailable, use session-only ID */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(key, id); } catch { /* same browser may receive new code next time */ }
  return id;
}
function apiUrl(path) {
  if (!cfg || !/^https:\/\//.test(cfg.apiBaseUrl) || cfg.apiBaseUrl.includes('YOUR-')) {
    throw new Error('Website not configured yet. Ask the organizer to set the Cloudflare API URL.');
  }
  return `${cfg.apiBaseUrl.replace(/\/$/, '')}${path}`;
}
async function loadReferral() {
  statusElement.textContent = 'Generating your code...';
  retryButton.classList.add('hidden');
  downloadButton.disabled = true;
  copyButton.disabled = true;
  try {
    const response = await fetch(apiUrl('/api/referrals'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign: cfg.campaign, visitorId: getVisitorId(cfg.campaign) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not generate your code.');
    referral = data;
    codeElement.textContent = data.code;
    codeElement.classList.remove('loading');
    statusElement.textContent = data.reused ? 'Welcome back! Here is your saved code.' : 'Success! Your code is ready.';
    createdAtElement.textContent = `Issued: ${new Date(data.createdAt).toLocaleString()}`;
    downloadButton.disabled = false;
    copyButton.disabled = false;
  } catch (error) {
    referral = null;
    statusElement.textContent = error.message || 'Could not connect. Please try again.';
    codeElement.textContent = 'Unavailable';
    codeElement.classList.remove('loading');
    createdAtElement.textContent = '';
    retryButton.classList.remove('hidden');
  }
}
async function downloadCard() {
  if (!referral) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0fdfa'; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = '#115e59'; ctx.fillRect(0, 0, 1200, 165);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 32px Arial'; ctx.fillText('YOUR REFERRAL PASS', 600, 92);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 42px Arial'; ctx.fillText('Thanks for visiting!', 600, 262);
  ctx.fillStyle = '#0f766e'; ctx.font = 'bold 61px monospace'; ctx.fillText(referral.code, 600, 376);
  ctx.fillStyle = '#475569'; ctx.font = '26px Arial'; ctx.fillText(`Campaign: ${referral.campaign}`, 600, 455);
  ctx.font = '24px Arial'; ctx.fillText('Keep this code safe and share it according to campaign terms.', 600, 515);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { statusElement.textContent = 'Image download unavailable. Please copy the code instead.'; return; }
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${referral.code}.png`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
async function copyCode() {
  if (!referral) return;
  try {
    await navigator.clipboard.writeText(referral.code);
    copyButton.textContent = 'Copied!'; setTimeout(() => { copyButton.textContent = 'Copy code'; }, 1500);
  } catch { statusElement.textContent = 'Select and manually copy the code above.'; }
}
downloadButton.addEventListener('click', downloadCard);
copyButton.addEventListener('click', copyCode);
retryButton.addEventListener('click', loadReferral);
loadReferral();
```

## docs/admin.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Referral Admin Dashboard</title>
  <link rel="stylesheet" href="./style.css">
  <script src="./config.js" defer></script>
  <!-- QRCode library is for drawing QR on the admin page only. -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" defer></script>
  <script src="./admin.js" defer></script>
</head>
<body class="admin-page">
  <div class="admin-shell">
    <header class="admin-header">
      <div><div class="eyebrow">CAMPAIGN CONTROL CENTER</div><h1>Referral dashboard</h1><p>Print one QR for everyone. Track unique referral codes in Cloudflare D1.</p></div>
      <a class="button outline" href="./">View customer website</a>
    </header>
    <section class="admin-panel login-panel" id="login-panel">
      <h2>Administrator sign in</h2>
      <p>Enter the secret ADMIN_TOKEN that you set in Cloudflare. It is never stored in this website's code or in browser storage.</p>
      <form id="login-form" class="login-form">
        <label for="token-input">Admin token</label>
        <input id="token-input" type="password" autocomplete="off" required placeholder="Paste your Cloudflare ADMIN_TOKEN">
        <button class="button primary" type="submit">Sign in</button>
      </form>
      <p id="login-error" class="error" role="alert"></p>
    </section>
    <div id="dashboard" class="hidden">
      <section class="admin-cards">
        <div class="stat-card"><div>Campaign</div><strong id="campaign-name">—</strong></div>
        <div class="stat-card"><div>Referral codes issued</div><strong id="total-count">—</strong></div>
      </section>
      <div class="admin-columns">
        <section class="admin-panel poster-panel">
          <h2>Printable QR flyer</h2><p>The same QR works for every customer, with separate codes in D1.</p>
          <div class="poster" id="poster">
            <div class="poster-eyebrow">SCAN • JOIN • SHARE</div>
            <h2>SCAN &amp; GET YOUR<br>REFERRAL CODE</h2>
            <p>Scan with your phone camera and download your unique code instantly.</p>
            <div id="qr-container" class="qr-container" aria-label="QR code for the customer page"></div>
            <div id="qr-url" class="qr-url"></div>
          </div>
          <div class="poster-actions">
            <button class="button primary" id="print-button" type="button">Print flyer</button>
            <button class="button secondary" id="qr-download" type="button">Download QR PNG</button>
          </div>
          <p class="hint">Use a high-contrast print and test on two phones before printing the flyers.</p>
        </section>
        <section class="admin-panel">
          <div class="section-header"><h2>Latest referral codes</h2><button class="button secondary small" id="refresh-button" type="button">Refresh</button></div>
          <p>Showing the latest 100. Export CSV to download every code.</p>
          <button id="csv-button" class="button primary" type="button">↓ Export all referral codes (CSV)</button>
          <div class="table-scroll"><table><thead><tr><th>Referral code</th><th>Created (UTC)</th></tr></thead><tbody id="referral-rows"><tr><td colspan="2">Loading...</td></tr></tbody></table></div>
          <p id="admin-error" class="error" role="alert"></p>
          <button id="logout-button" class="button secondary" type="button">Sign out</button>
        </section>
      </div>
    </div>
  </div>
</body>
</html>
```

## docs/admin.js

```javascript
'use strict';
const cfg = window.CAMPAIGN_CONFIG;
const origin = cfg?.apiBaseUrl?.replace(/\/$/, '');
const customerUrl = new URL('./', window.location.href).href;
const dashboard = document.querySelector('#dashboard');
const loginPanel = document.querySelector('#login-panel');
const loginError = document.querySelector('#login-error');
const adminError = document.querySelector('#admin-error');
let adminToken = ''; // Only in memory, never localStorage/cookies.
let qrBuilt = false;

async function api(path) {
  if (!origin?.startsWith('https://') || origin.includes('YOUR-')) throw new Error('First set the Worker URL in docs/config.js.');
  const response = await fetch(origin + path, {
    headers: { Authorization: `Bearer ${adminToken}` }, cache: 'no-store'
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Invalid admin token.' : `Server error (${response.status}).`);
  return response;
}
function renderRows(recent) {
  const tbody = document.querySelector('#referral-rows'); tbody.replaceChildren();
  if (!recent.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 2; td.textContent = 'No referral codes yet.'; tr.append(td); tbody.append(tr); return;
  }
  for (const row of recent) {
    const tr = document.createElement('tr');
    for (const field of [row.code, row.createdAt]) {
      const td = document.createElement('td'); td.textContent = field; tr.append(td);
    }
    tbody.append(tr);
  }
}
function buildQR() {
  document.querySelector('#qr-url').textContent = customerUrl;
  if (qrBuilt) return;
  if (typeof QRCode === 'undefined') {
    adminError.textContent = 'QR library could not load. Check internet access or allow cdnjs.cloudflare.com.';
    return;
  }
  new QRCode(document.querySelector('#qr-container'), {
    text: customerUrl, width: 900, height: 900,
    colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
  });
  qrBuilt = true;
}
async function refresh() {
  adminError.textContent = '';
  try {
    const response = await api('/api/admin/stats');
    const data = await response.json();
    document.querySelector('#campaign-name').textContent = data.campaign;
    document.querySelector('#total-count').textContent = Number(data.total).toLocaleString();
    renderRows(data.recent);
    buildQR();
  } catch (err) { adminError.textContent = err.message; }
}
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); loginError.textContent = '';
  adminToken = document.querySelector('#token-input').value.trim();
  try {
    const data = await (await api('/api/admin/stats')).json();
    document.querySelector('#token-input').value = '';
    loginPanel.classList.add('hidden'); dashboard.classList.remove('hidden');
    document.querySelector('#campaign-name').textContent = data.campaign;
    document.querySelector('#total-count').textContent = Number(data.total).toLocaleString();
    renderRows(data.recent);
    buildQR();
  } catch (err) { adminToken = ''; loginError.textContent = err.message; }
});
document.querySelector('#refresh-button').addEventListener('click', refresh);
document.querySelector('#print-button').addEventListener('click', () => window.print());
document.querySelector('#logout-button').addEventListener('click', () => {
  adminToken = ''; dashboard.classList.add('hidden'); loginPanel.classList.remove('hidden');
});
document.querySelector('#qr-download').addEventListener('click', () => {
  const canvas = document.querySelector('#qr-container canvas');
  const img = document.querySelector('#qr-container img');
  if (!canvas && !img) { adminError.textContent = 'QR image not ready.'; return; }
  const a = document.createElement('a');
  a.href = canvas ? canvas.toDataURL('image/png') : img.src;
  a.download = 'campaign-qr.png'; document.body.append(a); a.click(); a.remove();
});
document.querySelector('#csv-button').addEventListener('click', async () => {
  adminError.textContent = '';
  try {
    const blob = await (await api('/api/admin/export.csv')).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = `referrals-${cfg.campaign}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (err) { adminError.textContent = err.message; }
});
```

## docs/config.js

```javascript
// PUBLIC configuration (safe to store in GitHub).
// After deploying your Cloudflare Worker, paste its exact workers.dev URL here.
window.CAMPAIGN_CONFIG = Object.freeze({
  apiBaseUrl: 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev',
  campaign: 'outdoor-2026'
});
```

## docs/style.css

```css
:root{color-scheme:light;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-synthesis:none;--ink:#102a33;--teal:#0f766e;--muted:#657680;--line:#e2ecea}
*{box-sizing:border-box}body{margin:0;color:var(--ink)}.customer-page{min-height:100vh;background:radial-gradient(circle at 0 0,#c9f9e4 0%,transparent 44%),linear-gradient(135deg,#f4fff9,#dff7f4 60%,#eefcfb)}.layout{max-width:1100px;min-height:100vh;margin:auto;padding:70px 26px 24px;display:grid;grid-template-columns:1fr 470px;align-items:center;column-gap:65px}.intro{padding-bottom:60px}.eyebrow{color:#0c7668;font-size:12px;letter-spacing:.2em;font-weight:800;display:flex;align-items:center;gap:9px}.dot{height:9px;width:9px;display:inline-block;background:#18a879;border-radius:50%}.intro h1{font-size:clamp(44px,6vw,76px);letter-spacing:-.055em;line-height:1.06;margin:26px 0}.intro h1 span{color:#087e71}.intro p{font-size:19px;line-height:1.7;max-width:450px;color:#60767b}.features{display:flex;flex-wrap:wrap;gap:10px;margin-top:25px}.features span{background:#ffffff9c;color:#18665f;border:1px solid #d6ede5;padding:10px 13px;border-radius:50px;font-size:12px;font-weight:700}.ticket{background:#fff;border-radius:27px;box-shadow:0 22px 80px #114c4629;border:1px solid #def0e9;overflow:hidden}.ticket-top{padding:32px 36px 26px;background:#0e5c55;color:#fff}.ticket-label{font-size:11px;font-weight:800;letter-spacing:.2em;color:#a3f0da}.ticket-top h2{margin:14px 0;font-size:28px;letter-spacing:-.03em}.ticket-top p{color:#d2f4ea;font-size:14px;line-height:1.5;min-height:20px}.ticket-middle{padding:42px 22px 36px;text-align:center;border-bottom:2px dashed #d8e9e7;position:relative}.code-caption{font-size:11px;letter-spacing:.18em;font-weight:800;color:#698884}.code{font-size:clamp(20px,3vw,30px);font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:900;color:#0b6d64;letter-spacing:.06em;overflow-wrap:anywhere;padding:22px 3px}.code.loading{color:#9bb3b0}.date{font-size:12px;color:#879a98}.ticket-actions{display:grid;gap:11px;padding:28px 30px 18px}.button{display:inline-flex;justify-content:center;align-items:center;border-radius:12px;border:1px solid transparent;text-decoration:none;min-height:48px;padding:12px 17px;font:700 14px inherit;cursor:pointer;font-size:14px;font-weight:750;transition:transform .14s ease,opacity .14s ease}.button:hover:not(:disabled){transform:translateY(-1px)}.button:disabled{opacity:.48;cursor:not-allowed}.primary{background:var(--teal);color:white}.secondary{background:#eef8f5;color:#155d58;border-color:#deeeea}.outline{background:white;border-color:#c8dfd9;color:#16655e}.hidden{display:none!important}.ticket-footer{text-align:center;font-size:12px;color:#8a9c9b;line-height:1.55;padding:0 32px 30px}.site-footer{grid-column:1/-1;text-align:center;font-size:12px;color:#7e9692;margin-top:26px}.admin-page{background:#f6faf9}.admin-shell{max-width:1320px;margin:0 auto;padding:44px 28px 70px}.admin-header{display:flex;justify-content:space-between;gap:20px;align-items:center}.admin-header h1{font-size:38px;letter-spacing:-.04em;margin:15px 0 8px}.admin-header p,.admin-panel>p{color:var(--muted)}.admin-cards{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:26px 0}.stat-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px}.stat-card div{font-size:13px;color:#718782}.stat-card strong{display:block;font-size:26px;margin-top:12px}.admin-columns{display:grid;grid-template-columns:430px 1fr;gap:20px;align-items:start}.admin-panel{background:white;border-radius:18px;border:1px solid var(--line);padding:26px;overflow:hidden}.admin-panel>h2,.section-header h2{font-size:20px;margin:0}.admin-panel>p{font-size:14px;line-height:1.55}.poster{background:#e5f8ef;border:2px solid #0c695e;margin:20px auto 18px;max-width:350px;min-height:485px;display:flex;align-items:center;flex-direction:column;justify-content:center;padding:24px 17px;text-align:center}.poster-eyebrow{color:#17756b;font-size:10px;font-weight:800;letter-spacing:.17em}.poster h2{font-size:26px;line-height:1.12;margin:18px 0 13px;letter-spacing:-.025em}.poster p{font-size:13px;line-height:1.6;margin:0;color:#456d66}.qr-image{display:block;width:230px;height:230px;margin:15px auto;image-rendering:pixelated}.qr-url{font-size:10px;word-break:break-all;color:#205d57}.poster-actions{display:flex;gap:8px;flex-wrap:wrap}.hint{font-size:12px!important}.section-header{display:flex;align-items:center;justify-content:space-between;gap:15px}.small{min-height:38px;padding:7px 12px}.table-scroll{overflow:auto;max-height:620px}table{width:100%;border-collapse:collapse;min-width:440px}th{text-align:left;color:#65847d;font-size:12px;background:#f4faf7;position:sticky;top:0}td{font-size:13px;color:#304c48}td,th{padding:14px;border-bottom:1px solid #e4efeb}td:first-child{font-weight:700;font-family:ui-monospace,monospace}.error{color:#b91c1c!important}
@media(max-width:860px){.layout{grid-template-columns:1fr;max-width:550px;padding:50px 17px 22px;gap:25px}.intro{padding-bottom:0;text-align:center}.intro p{font-size:16px}.intro .eyebrow,.features{justify-content:center}.intro h1{font-size:47px}.ticket{width:100%}.site-footer{grid-column:1}.admin-columns{grid-template-columns:1fr}.admin-header{align-items:flex-start;flex-direction:column}}
@media(max-width:480px){.ticket-top{padding:27px}.ticket-middle{padding:31px 15px}.ticket-actions{padding:23px}.admin-shell{padding:28px 12px}.admin-cards{grid-template-columns:1fr}.admin-panel{padding:17px}.poster{padding:20px 12px}}
@page{size:A4 portrait;margin:10mm}
@media print{body.admin-page{background:#fff}.admin-shell>*{display:none!important}.admin-shell{padding:0}.admin-columns{display:block!important}.admin-panel{display:none!important;border:0!important;padding:0!important}.poster-panel{display:block!important}.poster-panel>*{display:none!important}.poster-panel .poster{display:flex!important;max-width:none;width:185mm;height:263mm;margin:0 auto;border:3px solid #0c695e;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}.poster h2{font-size:46px}.poster p{font-size:22px}.poster .poster-eyebrow{font-size:17px}.poster .qr-image{width:112mm;height:112mm}.poster .qr-url{font-size:15px}}
/* GitHub Pages dashboard additions */
.login-panel{max-width:680px;margin:30px auto;padding:32px}
.login-form{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-top:22px}
.login-form label{flex-basis:100%;font-weight:700;font-size:14px}
.login-form input{border:1px solid #b5d3cb;border-radius:10px;font-size:15px;padding:12px;min-height:48px;flex:1;min-width:230px}
.qr-container{background:#fff;padding:8px;margin:18px auto;min-height:246px;min-width:246px;display:flex;align-items:center;justify-content:center}
.qr-container canvas,.qr-container img{width:230px!important;height:230px!important;image-rendering:pixelated}
#csv-button{margin:12px 0 16px}
@media print{.poster .qr-container{width:120mm;height:120mm;padding:4mm}.poster .qr-container canvas,.poster .qr-container img{width:112mm!important;height:112mm!important}}

/* Allow the nested admin dashboard poster to print, despite the old .admin-shell rules. */
@media print{
 .admin-shell>#dashboard{display:block!important}
 .admin-shell>#dashboard .admin-cards{display:none!important}
 .admin-shell>#dashboard .admin-columns{display:block!important}
 .admin-shell>#dashboard .admin-panel{display:none!important}
 .admin-shell>#dashboard .poster-panel{display:block!important}
}
```

## worker/src/index.js

```javascript
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
```

## worker/wrangler.toml

```toml
name = "qr-referral-api"
main = "src/index.js"
compatibility_date = "2026-10-31"
workers_dev = true

[vars]
CAMPAIGN_SLUG = "outdoor-2026"
# Replace YOUR-GITHUB-USERNAME. Include https:// but NOT the repository path.
SITE_ORIGIN = "https://YOUR-GITHUB-USERNAME.github.io"

# D1 binding gets added automatically when running:
# npx wrangler d1 create qr-referral-d1 --binding DB --update-config
# If Wrangler prints a binding instead, paste its [[d1_databases]] block here.
```

## worker/sql/schema.sql

```sql
-- Cloudflare D1 database schema (SQLite dialect).
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_slug TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  visitor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_slug, visitor_hash)
);
CREATE INDEX IF NOT EXISTS idx_campaign_recent ON referrals(campaign_slug, id DESC);

-- To check data in Cloudflare D1:
-- SELECT id, code, campaign_slug, created_at FROM referrals ORDER BY id DESC LIMIT 20;
```

## worker/package.json

```json
{
  "name": "qr-referral-cloudflare-worker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Cloudflare Workers and D1 API for GitHub Pages QR referral campaign",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "node --test test/*.test.mjs"
  },
  "devDependencies": {
    "wrangler": "^4.0.0"
  }
}
```

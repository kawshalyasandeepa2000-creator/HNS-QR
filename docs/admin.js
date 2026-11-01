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
    td.colSpan = 4; td.textContent = 'No referral codes yet.'; tr.append(td); tbody.append(tr); return;
  }
  for (const row of recent) {
    const tr = document.createElement('tr');
    for (const field of [row.fullName || '—', row.mobileNumber || '—', row.code, row.createdAt]) {
      const td = document.createElement('td');
      if (field === row.mobileNumber && /^\+[0-9]{8,15}$/.test(field || '')) {
        const link = document.createElement('a');
        link.href = `tel:${field}`;
        link.textContent = field;
        link.title = 'Call this customer';
        td.append(link);
      } else {
        td.textContent = field;
      }
      tr.append(td);
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

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

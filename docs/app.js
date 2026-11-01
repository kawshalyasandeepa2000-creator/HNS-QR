'use strict';
const cfg = window.CAMPAIGN_CONFIG;
const codeElement = document.querySelector('#referral-code');
const statusElement = document.querySelector('#status');
const createdAtElement = document.querySelector('#created-at');
const downloadButton = document.querySelector('#download-button');
const copyButton = document.querySelector('#copy-button');
const referralForm = document.querySelector('#referral-form');
const claimButton = document.querySelector('#claim-button');
const passDetails = document.querySelector('#pass-details');
const referralActions = document.querySelector('#referral-actions');
const issuedTo = document.querySelector('#issued-to');
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
async function submitReferral(event) {
  event.preventDefault();
  if (!referralForm.reportValidity()) return;
  const fullName = document.querySelector('#full-name').value.trim();
  const mobileNumber = document.querySelector('#mobile-number').value.trim();
  const consent = document.querySelector('#contact-consent').checked;
  if (!consent) return;

  statusElement.textContent = 'Saving your details and creating your referral pass...';
  claimButton.disabled = true;
  downloadButton.disabled = true;
  copyButton.disabled = true;
  try {
    const response = await fetch(apiUrl('/api/referrals'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign: cfg.campaign, visitorId: getVisitorId(cfg.campaign),
        fullName, mobileNumber, consent
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not issue your code.');
    referral = data;
    codeElement.textContent = data.code;
    issuedTo.textContent = `Issued to: ${data.fullName || fullName}`;
    codeElement.classList.remove('loading');
    statusElement.textContent = data.reused ? 'Welcome back! Here is your registered code.' : 'Success! Your referral pass is ready.';
    createdAtElement.textContent = `Issued: ${new Date(data.createdAt).toLocaleString()}`;
    passDetails.classList.remove('hidden');
    referralActions.classList.remove('hidden');
    referralForm.classList.add('hidden');
    downloadButton.disabled = false;
    copyButton.disabled = false;
  } catch (error) {
    referral = null;
    statusElement.textContent = error.message || 'Could not connect. Please check your details and try again.';
  } finally {
    claimButton.disabled = false;
  }
}
async function downloadCard() {
  if (!referral) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Helen & Sons branded pass, using the same SQL-issued code as the website.
  ctx.fillStyle = '#f2f7fc';
  ctx.fillRect(0, 0, 1200, 630);
  const blue = ctx.createLinearGradient(0, 0, 1200, 230);
  blue.addColorStop(0, '#07294f');
  blue.addColorStop(1, '#0a5c9b');
  ctx.fillStyle = blue;
  ctx.fillRect(0, 0, 1200, 226);
  ctx.fillStyle = '#e4b447';
  ctx.fillRect(0, 226, 1200, 10);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.fillText('HELEN & SONS', 600, 105);
  ctx.fillStyle = '#f5d58b';
  ctx.font = 'bold 25px Arial, sans-serif';
  ctx.fillText('VISA CONSULTANCY  |  REFERRAL PASS', 600, 160);

  ctx.fillStyle = '#506c8b';
  ctx.font = 'bold 25px Arial, sans-serif';
  ctx.fillText('YOUR UNIQUE REFERRAL CODE', 600, 310);
  ctx.fillStyle = '#082b52';
  ctx.font = 'bold 64px Consolas, monospace';
  ctx.fillText(referral.code, 600, 406);
  ctx.fillStyle = '#375f84';
  ctx.font = '24px Arial, sans-serif';
  ctx.fillText(`Issued to: ${(referral.fullName || '').slice(0, 60)}`, 600, 470);
  ctx.font = '21px Arial, sans-serif';
  ctx.fillText('Helen & Sons | UAE visa and business consultancy', 600, 499);
  ctx.fillStyle = '#7088a1';
  ctx.font = '20px Arial, sans-serif';
  ctx.fillText('Keep this pass for referrals. Rewards, if any, are subject to campaign terms.', 600, 549);
  ctx.fillText('helensons.ae  •  This pass does not guarantee visa approval.', 600, 580);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    statusElement.textContent = 'Image download unavailable. Please copy the code instead.';
    return;
  }
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `Helen-and-Sons-Referral-${referral.code}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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
referralForm.addEventListener('submit', submitReferral);

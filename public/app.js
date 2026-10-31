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

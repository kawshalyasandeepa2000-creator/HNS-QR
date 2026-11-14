"use strict";
// Uses the exact same Cloudflare Worker endpoints as your current dashboard.
// Admin token lives only in this tab's memory; it is never saved to disk.
const config = window.CAMPAIGN_CONFIG;
const apiOrigin = config?.apiBaseUrl?.replace(/\/$/, "");
const customerUrl = new URL("./", document.baseURI).href;
const $ = selector => document.querySelector(selector);
const dom = {
  dashboard: $("#dashboard"), loginPanel: $("#login-panel"), loginError: $("#login-error"),
  adminError: $("#admin-error"), tokenInput: $("#token-input"), loginButton: $("#sign-in-button"),
  status: $("#connection-status"), records: $("#referral-rows"), search: $("#record-search")
};
let adminToken = "";
let recentRecords = [];
let qrBuilt = false;

async function api(path) {
  if (!apiOrigin?.startsWith("https://") || apiOrigin.includes("YOUR-")) {
    throw new Error("Cloudflare API is not configured in docs/config.js.");
  }
  const response = await fetch(apiOrigin + path, {
    headers: { Authorization: `Bearer ${adminToken}` },
    cache: "no-store"
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Invalid admin token. Please check the token in Cloudflare.");
    throw new Error(`Cloudflare API error (${response.status}).`);
  }
  return response;
}

function showError(target, error) {
  target.textContent = error instanceof Error ? error.message : String(error);
}

function makeCell(row, index) {
  const td = document.createElement("td");
  const text = row ?? "—";
  if (index === 0) td.className = "customer-name-cell";
  if (index === 1 && /^\+[0-9]{8,15}$/.test(text)) {
    const a = document.createElement("a");
    a.href = `tel:${text}`;
    a.textContent = text;
    a.title = "Call customer";
    td.append(a);
  } else if (index === 2 && text !== "—" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    const a = document.createElement("a");
    a.href = `mailto:${text}`;
    a.textContent = text;
    a.title = "Email customer";
    td.append(a);
  } else {
    td.textContent = text;
  }
  if (index === 3) td.className = "referral-code-cell";
  return td;
}

function renderRecords() {
  const query = dom.search.value.trim().toLowerCase();
  const filtered = recentRecords.filter(row => [
    row.fullName, row.mobileNumber, row.email, row.code, row.createdAt
  ].some(value => String(value || "").toLowerCase().includes(query)));
  dom.records.replaceChildren();
  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-records";
    td.textContent = query ? "No customers match this search." : "No referral registrations yet.";
    tr.append(td);
    dom.records.append(tr);
  } else {
    for (const row of filtered) {
      const tr = document.createElement("tr");
      [row.fullName || "—", row.mobileNumber || "—", row.email || "—", row.code || "—", row.createdAt || "—"]
        .forEach((value, index) => tr.append(makeCell(value, index)));
      dom.records.append(tr);
    }
  }
  $("#display-count").textContent = `${filtered.length} of ${recentRecords.length} recent records shown`;
}

function paintStats(data) {
  const list = Array.isArray(data?.recent) ? data.recent : [];
  recentRecords = list;
  // The customer-facing campaign label is a dashboard alias only.
  // Keep data.campaign / config.campaign unchanged for D1 and Worker operations.
  $("#campaign-name").textContent = "RISE 17 - 2026";
  $("#campaign-name").title = `Database campaign: ${data.campaign || config?.campaign || "outdoor-2026"}`;
  $("#total-count").textContent = Number(data.total || 0).toLocaleString();
  $("#recent-count").textContent = list.length.toLocaleString();
  $("#email-count").textContent = list.filter(item => typeof item.email === "string" && item.email.trim()).length.toLocaleString();
  dom.status.textContent = "● Data connected";
  dom.status.classList.add("connected");
  renderRecords();
  renderDailyChart(list);
}


// Chart uses only actual timestamps returned by the existing Cloudflare API.
// It is deliberately labelled "from the latest 100" rather than claiming a
// complete campaign-wide 7-day historical report.
function renderDailyChart(list) {
  const chart = $("#daily-chart");
  if (!chart) return;
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return { d, key, count: 0 };
  });
  const dayLookup = new Map(days.map(item => [item.key, item]));
  for (const row of list) {
    const d = new Date(row.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const target = dayLookup.get(key);
    if (target) target.count++;
  }
  const max = Math.max(1, ...days.map(item => item.count));
  chart.replaceChildren();
  for (const item of days) {
    const root = document.createElement("div");
    root.className = "daily-bar-item";
    const count = document.createElement("span");
    count.className = "daily-bar-count";
    count.textContent = String(item.count);
    const bar = document.createElement("div");
    bar.className = "daily-bar";
    bar.style.height = `${Math.max(3, Math.round(item.count / max * 103))}px`;
    bar.title = `${item.count} registrations`;
    const date = document.createElement("span");
    date.className = "daily-bar-date";
    date.textContent = item.d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    root.append(count, bar, date);
    chart.append(root);
  }
}

// Optional dashboard QR panel: hidden by default until the admin asks for it.
// Show/hide never deletes QR data, customer records, or the campaign.
const qrFlyer = $("#qr-flyer");
const qrToggle = $("#qr-visibility-toggle");
function setQRVisible(visible) {
  qrFlyer.classList.toggle("hidden", !visible);
  qrToggle.setAttribute("aria-expanded", String(visible));
  qrToggle.querySelector(".qr-toggle-label").textContent = visible ? "Hide QR flyer" : "Show QR flyer";
  if (visible) {
    buildQR();
    qrFlyer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
qrToggle.addEventListener("click", () => {
  if (dom.dashboard.classList.contains("hidden")) {
    dom.loginPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  setQRVisible(qrFlyer.classList.contains("hidden"));
});

function buildQR() {
  $("#qr-url").textContent = customerUrl;
  if (qrBuilt) return;
  if (typeof QRCode === "undefined") {
    dom.adminError.textContent = "QR code library could not load. Check your internet connection and try Refresh.";
    return;
  }
  const target = $("#qr-container");
  target.replaceChildren();
  new QRCode(target, {
    text: customerUrl,
    width: 320,
    height: 320,
    colorDark: "#0B2463",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
  qrBuilt = true;
}

async function fetchDashboard() {
  dom.adminError.textContent = "";
  const data = await (await api("/api/admin/stats")).json();
  paintStats(data);
  if (!qrFlyer.classList.contains("hidden")) buildQR();
  return data;
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  dom.loginError.textContent = "";
  adminToken = dom.tokenInput.value.trim();
  dom.loginButton.disabled = true;
  dom.loginButton.textContent = "Signing in…";
  try {
    await fetchDashboard();
    dom.tokenInput.value = "";
    dom.loginPanel.classList.add("hidden");
    dom.dashboard.classList.remove("hidden");
    document.body.classList.add("is-signed-in");
  } catch (error) {
    adminToken = "";
    showError(dom.loginError, error);
  } finally {
    dom.loginButton.disabled = false;
    dom.loginButton.textContent = "Access dashboard →";
  }
});

$("#toggle-token").addEventListener("click", () => {
  const showing = dom.tokenInput.type === "text";
  dom.tokenInput.type = showing ? "password" : "text";
  $("#toggle-token").textContent = showing ? "Show" : "Hide";
  $("#toggle-token").setAttribute("aria-label", showing ? "Show token" : "Hide token");
  $("#toggle-token").setAttribute("aria-pressed", String(!showing));
});

$("#refresh-button").addEventListener("click", async () => {
  const button = $("#refresh-button");
  button.disabled = true;
  try { await fetchDashboard(); }
  catch (error) { showError(dom.adminError, error); }
  finally { button.disabled = false; }
});

dom.search.addEventListener("input", renderRecords);

$("#logout-button").addEventListener("click", () => {
  adminToken = "";
  recentRecords = [];
  dom.records.replaceChildren();
  dom.dashboard.classList.add("hidden");
  setQRVisible(false);
  dom.loginPanel.classList.remove("hidden");
  dom.status.textContent = "Secure admin access";
  dom.status.classList.remove("connected");
  document.body.classList.remove("is-signed-in");
  dom.search.value = "";
  dom.loginError.textContent = "";
  window.scrollTo({ top: 0, behavior: "auto" });
});

$("#print-button").addEventListener("click", () => {
  if (!qrBuilt) { dom.adminError.textContent = "QR image is not ready."; return; }
  window.print();
});

$("#qr-download").addEventListener("click", () => {
  // Synchronous image creation allows mobile browsers to save the branded PNG.
  const notice = $("#qr-notice");
  if (notice) notice.textContent = "";
  const qrCanvas = $("#qr-container canvas");
  const qrImg = $("#qr-container img");
  if (!qrCanvas && !(qrImg && qrImg.complete && qrImg.naturalWidth)) {
    if (notice) notice.textContent = "QR code is not ready. Try Refresh records.";
    return;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 850;
    canvas.height = 1180;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot create an image.");
    ctx.fillStyle = "#0B2463";
    ctx.fillRect(0, 0, 850, 1180);
    const flyerBand = ctx.createLinearGradient(24,24,826,1156);
    flyerBand.addColorStop(0, "#F5E77E");
    flyerBand.addColorStop(1, "#C89116");
    ctx.fillStyle = flyerBand;
    ctx.fillRect(24, 24, 802, 1132);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(42, 42, 766, 1096);
    const topBand = ctx.createLinearGradient(42,42,808,62);
    topBand.addColorStop(0, "#0B2463");
    topBand.addColorStop(1, "#0D286A");
    ctx.fillStyle = topBand;
    ctx.fillRect(42, 42, 766, 20);

    const brandImg = $(".poster-logo img");
    if (brandImg && brandImg.complete && brandImg.naturalWidth) {
      ctx.fillStyle = "#0B2463";
      ctx.beginPath();
      ctx.roundRect(107, 110, 636, 170, 19);
      ctx.fill();
      const logoWidth = 560;
      const logoHeight = logoWidth * brandImg.naturalHeight / brandImg.naturalWidth;
      ctx.drawImage(brandImg, (850 - logoWidth) / 2, 120 + (150-logoHeight)/2, logoWidth, logoHeight);
    } else {
      ctx.textAlign = "center";
      ctx.fillStyle = "#0B2463";
      ctx.font = "bold 35px Arial, sans-serif";
      ctx.fillText("HELEN AND SONS", 425, 237);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#0B2463";
    ctx.font = "bold 27px Arial, sans-serif";
    ctx.fillText("OFFICIAL REFERRAL PROGRAMME", 425, 373, 720);
    ctx.font = "bold 49px Arial, sans-serif";
    ctx.fillText("SCAN & GET YOUR", 425, 458, 730);
    ctx.fillStyle = "#C89116";
    ctx.fillText("REFERRAL CODE", 425, 521, 730);
    ctx.fillStyle = "#00005C";
    ctx.font = "24px Arial, sans-serif";
    ctx.fillText("Name, mobile and email required.", 425, 574, 730);

    const qrBack = ctx.createLinearGradient(190,622,660,1092);
    qrBack.addColorStop(0, "#0B2463");
    qrBack.addColorStop(1, "#0D286A");
    ctx.fillStyle = qrBack;
    ctx.fillRect(190, 622, 470, 470);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(201, 633, 448, 448);
    ctx.drawImage(qrCanvas || qrImg, 216, 648, 418, 418);
    ctx.fillStyle = "#0B2463";
    ctx.font = "bold 18px Arial, sans-serif";
    ctx.fillText("HELEN AND SONS VISA CONSULTANCY", 425, 1117, 720);

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "Helen-and-Sons-Branded-Campaign-QR.png";
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    if (notice) notice.textContent = "Branded QR PNG is ready. If the file did not download, check your browser's Downloads.";
  } catch (error) {
    if (notice) notice.textContent = error.message || "QR download failed. Please try again.";
  }
});

$("#csv-button").addEventListener("click", async () => {
  dom.adminError.textContent = "";
  const button = $("#csv-button");
  button.disabled = true;
  try {
    const blob = await (await api("/api/admin/export.csv")).blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `Helen-and-Sons-Referrals-${config.campaign}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) { showError(dom.adminError, error); }
  finally { button.disabled = false; }
});

// Subtle pointer-driven depth, disabled for reduced-motion users and touch screens.
const depthCard = $("#hero-card");
if (window.matchMedia?.("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) {
  depthCard.addEventListener("pointermove", event => {
    const box = depthCard.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    depthCard.style.setProperty("--rot-x", `${(-y * 3).toFixed(2)}deg`);
    depthCard.style.setProperty("--rot-y", `${(x * 4).toFixed(2)}deg`);
  });
  depthCard.addEventListener("pointerleave", () => {
    depthCard.style.removeProperty("--rot-x");
    depthCard.style.removeProperty("--rot-y");
  });
}


/* Private business-card leads. Uses existing in-memory ADMIN_TOKEN from admin.js.
 * Photos stay on device. Only reviewed contact fields are sent to the Worker.
 */
const leadEls = {
  section: $('#business-cards'), camera: $('#lead-camera-input'), upload: $('#lead-file-input'),
  preview: $('#lead-photo'), placeholder: $('#lead-photo-placeholder'), status: $('#lead-scan-status'),
  raw: $('#lead-raw-text'), form: $('#lead-form'), save: $('#lead-save'),
  saveStatus: $('#lead-save-status'), video: $('#lead-video'), webcam: $('#leads-webcam'),
  search: $('#lead-search'), rows: $('#lead-rows')
};
const leadFields = {
  personName: $('#lead-person'), companyName: $('#lead-company'), email: $('#lead-email'),
  phone: $('#lead-phone'), jobTitle: $('#lead-title'), website: $('#lead-website'),
  eventName: $('#lead-event'), notes: $('#lead-notes')
};
let leadsList = [];
let leadEditingId = null;
let leadImageCanvas = null;
let leadWorker = null;
let leadWorkerLoading = null;
let leadsBusy = false;
let leadsCameraStream = null;
let leadsLoaded = false;

async function leadApi(path, { method = 'GET', data = undefined } = {}) {
  if (!adminToken || dom.dashboard.classList.contains('hidden')) throw new Error('Please sign in as an administrator first.');
  if (!apiOrigin?.startsWith('https://')) throw new Error('API URL is missing.');
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminToken}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
    cache: 'no-store'
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === 'string' ? body.error : `Request failed (HTTP ${response.status}).`);
  }
  return response;
}

function setLeadStatus(message, isError = false) {
  leadEls.status.textContent = message;
  leadEls.status.style.color = isError ? '#9b2835' : '#536b9a';
}
function setLeadSaveStatus(message, isError = false) {
  leadEls.saveStatus.textContent = message;
  leadEls.saveStatus.style.color = isError ? '#9b2835' : '#2b6480';
}

function resetLeadForm() {
  leadEditingId = null;
  leadEls.form.reset();
  leadFields.eventName.value = 'RISE 17 - 2026';
  $('#lead-form-title').textContent = 'Contact details';
  leadEls.save.textContent = '✓ Save business contact';
  setLeadSaveStatus('');
}
$('#lead-clear').addEventListener('click', resetLeadForm);

async function loadTesseractOnce() {
  if (window.Tesseract) return;
  if (!leadWorkerLoading) {
    leadWorkerLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async = true;
      script.onload = () => window.Tesseract ? resolve() : reject(new Error('OCR engine did not load.'));
      script.onerror = () => reject(new Error('OCR library could not be loaded. Check your internet connection.'));
      document.head.append(script);
    }).catch(error => { leadWorkerLoading = null; throw error; });
  }
  return leadWorkerLoading;
}

async function getLeadOcrWorker() {
  if (leadWorker) return leadWorker;
  await loadTesseractOnce();
  setLeadStatus('Loading OCR language model... first scan may take a little longer.');
  leadWorker = await window.Tesseract.createWorker('eng', 1, {
    logger: progress => {
      if (!progress || !progress.status) return;
      const pct = Number.isFinite(progress.progress) ? ` ${Math.round(progress.progress * 100)}%` : '';
      setLeadStatus(`Reading business card: ${progress.status}${pct}`);
    }
  });
  return leadWorker;
}

function tidyOcrLine(raw) {
  return raw.replace(/[|•●]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseBusinessCardText(raw) {
  const lines = raw.split(/\r?\n/).map(tidyOcrLine).filter(Boolean);
  const allText = lines.join('\n');
  const email = (allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || '';
  const phoneMatches = allText.match(/(?:\+?\d[\d\s()./\-]{6,}\d)/g) || [];
  let phone = '';
  for (const candidate of phoneMatches) {
    const cleaned = candidate.trim().replace(/^[^\d+]+|[^\d]+$/g, '');
    const digitCount = cleaned.replace(/\D/g, '').length;
    if (digitCount >= 8 && digitCount <= 15 && !/\b20(?:2[5-9]|3\d)\b/.test(cleaned)) {phone = cleaned; break;}
  }
  const urlMatches = allText.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]+\.(?:com|ae|net|org|co|io|biz|in|uk|info)(?:\/[\w./?&=%-]*)?/ig) || [];
  const website = urlMatches.find(link => !link.includes('@') && !email.includes(link.replace(/^www\./,''))) || '';
  const roleRe = /\b(?:manager|director|founder|ceo|cfo|coo|president|consultant|executive|engineer|sales|marketing|business development|chairman|partner|officer|coordinator|specialist|head of|accountant|administrator|proprietor|owner|advisor|designer)\b/i;
  const companyRe = /\b(?:l\.?l\.?c|fze|fzc|fzc-llc|fz-llc|limited|ltd|inc|corp|corporation|company|group|trading|enterprises|industries|technologies|solutions|consultancy|services|international|business setup|real estate|general trading)\b/i;
  const skipRe = /(@|https?:|www\.|\.com\b|\.ae\b|\b(?:mobile|phone|tel|fax|email|e-mail|website|address|office|street|road|building|p\.?o\.? box|dubai|united arab emirates|uae)\b|\d{3,})/i;
  const companyLine = lines.find(line => companyRe.test(line) && !skipRe.test(line) && line.length <= 160) || '';
  const jobTitle = lines.find(line => roleRe.test(line) && !skipRe.test(line) && !companyRe.test(line) && line.length <= 120) || '';
  const personCandidates = lines.filter(line => {
    if (skipRe.test(line) || roleRe.test(line) || companyRe.test(line)) return false;
    const words = line.split(/\s+/).filter(Boolean);
    return words.length >= 2 && words.length <= 4 && line.length <= 70 && /^[\p{L} .'-]+$/u.test(line) && !/^THE\s/i.test(line);
  });
  const personName = personCandidates.find(line => line !== companyLine) || '';
  let companyName = companyLine;
  // If the company name has no legal suffix, a prominent single uppercase line may be it.
  if (!companyName) {
    companyName = lines.find(line => line !== personName && line !== jobTitle &&
      line.length > 4 && line.length < 70 && !skipRe.test(line) &&
      /^[\p{L} \d.&'-]+$/u.test(line) && (line === line.toUpperCase() || /\b(?:business|global|academy|digital|visa|hospitality)\b/i.test(line))) || '';
  }
  return { personName, companyName, email, phone, jobTitle, website, eventName: 'RISE 17 - 2026', notes: '' };
}

function fillLeadFields(values) {
  for (const [key, input] of Object.entries(leadFields)) {
    input.value = typeof values[key] === 'string' ? values[key] : (key === 'eventName' ? 'RISE 17 - 2026' : '');
  }
}

async function decodeLeadFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a business card photo (JPG, PNG, or supported image format).');
  if (file.size > 15 * 1024 * 1024) throw new Error('This image is too large. Please select a photo under 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not read this image. Please try JPG or PNG.'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('Image has no visible pixels.');
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {URL.revokeObjectURL(url);}
}

async function scanLeadCanvas(canvas) {
  if (leadsBusy) return;
  leadsBusy = true;
  leadImageCanvas = canvas;
  leadEls.preview.src = canvas.toDataURL('image/jpeg', .86);
  leadEls.preview.classList.remove('hidden');
  leadEls.placeholder.classList.add('hidden');
  $('#lead-rescan').disabled = true;
  resetLeadForm();
  setLeadStatus('Preparing the image for OCR...');
  try {
    const worker = await getLeadOcrWorker();
    const {data} = await worker.recognize(canvas);
    const raw = String(data?.text || '').trim();
    leadEls.raw.value = raw;
    const extracted = parseBusinessCardText(raw);
    fillLeadFields(extracted);
    if (!raw) setLeadStatus('No text detected. Try better lighting or enter the details manually.', true);
    else setLeadStatus('Text scanned. Check person/company/email before saving — OCR can make mistakes.');
  } catch (error) {
    setLeadStatus(`OCR failed: ${error.message || 'Unknown issue'}. You can enter details manually.`, true);
  } finally {
    leadsBusy = false;
    $('#lead-rescan').disabled = false;
  }
}

async function scanLeadFile(file) {
  if (!file || leadsBusy) return;
  try { await scanLeadCanvas(await decodeLeadFile(file)); }
  catch (error) { setLeadStatus(error.message || 'Unable to read photo.', true); }
}
leadEls.camera.addEventListener('change', async () => { const file=leadEls.camera.files?.[0];leadEls.camera.value='';await scanLeadFile(file); });
leadEls.upload.addEventListener('change', async () => { const file=leadEls.upload.files?.[0];leadEls.upload.value='';await scanLeadFile(file); });
$('#lead-rescan').addEventListener('click', () => {if (leadImageCanvas) scanLeadCanvas(leadImageCanvas);});

function closeLeadCamera() {
  for (const track of leadsCameraStream?.getTracks() || []) track.stop();
  leadsCameraStream = null;
  leadEls.video.srcObject = null;
  leadEls.webcam.classList.add('hidden');
}
$('#lead-open-webcam').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) { setLeadStatus('Live camera is not available. Use Scan with phone camera instead.', true); return; }
  try {
    closeLeadCamera();
    leadsCameraStream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    leadEls.video.srcObject = leadsCameraStream;
    leadEls.webcam.classList.remove('hidden');
    await leadEls.video.play();
    setLeadStatus('Point the camera at a business card, then tap Capture card.');
  } catch(error) {closeLeadCamera();setLeadStatus('Camera unavailable or permission denied. Use the photo upload button.', true);}
});
$('#lead-close-webcam').addEventListener('click', closeLeadCamera);
$('#lead-take-photo').addEventListener('click', async () => {
  if (!leadEls.video.videoWidth || !leadEls.video.videoHeight) {setLeadStatus('Camera is not ready yet.',true);return;}
  const sourceW=leadEls.video.videoWidth, sourceH=leadEls.video.videoHeight;
  const scale=Math.min(1, 2400/Math.max(sourceW,sourceH));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(sourceW*scale);canvas.height=Math.round(sourceH*scale);
  canvas.getContext('2d').drawImage(leadEls.video,0,0,canvas.width,canvas.height);
  closeLeadCamera();
  await scanLeadCanvas(canvas);
});

function leadFormPayload() {
  return Object.fromEntries(Object.entries(leadFields).map(([key,input]) => [key,input.value.trim()]));
}
leadEls.form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = leadFormPayload();
  if (!payload.personName && !payload.companyName) {setLeadSaveStatus('Enter a person name or company name before saving.', true);return;}
  leadEls.save.disabled=true;
  setLeadSaveStatus('Saving contact to private database...');
  try {
    const editing = !!leadEditingId;
    const path = editing ? `/api/admin/business-cards/${encodeURIComponent(leadEditingId)}` : '/api/admin/business-cards';
    await leadApi(path, {method: editing ? 'PATCH' : 'POST', data:payload});
    resetLeadForm();
    setLeadSaveStatus(editing ? 'Business contact updated successfully.' : 'Business contact saved successfully.');
    await loadBusinessCardLeads();
  } catch (error) {setLeadSaveStatus(error.message || 'Could not save contact.', true);}
  finally {leadEls.save.disabled=false;}
});

function safeLeadLink(value, kind) {
  const a=document.createElement('a');
  a.textContent=value;
  a.href=kind==='email' ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g,'')}`;
  if (kind==='phone' && !/^\+?[\d -]{7,40}$/.test(value)) return document.createTextNode(value);
  return a;
}
function leadCell(value,kind) {
  const td=document.createElement('td');
  const text = String(value||'—');
  if (text!=='—' && kind) td.append(safeLeadLink(text,kind));
  else td.textContent=text;
  return td;
}
function renderBusinessCardLeads() {
  const q=leadEls.search.value.trim().toLowerCase();
  const list=leadsList.filter(lead=> [lead.personName,lead.companyName,lead.email,lead.phone,lead.jobTitle,lead.eventName].some(v=>String(v||'').toLowerCase().includes(q)));
  leadEls.rows.replaceChildren();
  if (!list.length) {
    const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=7;td.textContent=q?'No matching business contacts.':'No saved business cards yet.';tr.append(td);leadEls.rows.append(tr);
  }
  for(const lead of list){
    const tr=document.createElement('tr');
    [['personName',null],['companyName',null],['email','email'],['phone','phone'],['jobTitle',null],['createdAt',null]].forEach(([key,kind])=>tr.append(leadCell(lead[key],kind)));
    const td=document.createElement('td');const controls=document.createElement('div');controls.className='leads-row-actions';
    const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';edit.dataset.action='edit';edit.dataset.id=lead.id;
    const del=document.createElement('button');del.type='button';del.textContent='Delete';del.className='lead-delete-btn';del.dataset.action='delete';del.dataset.id=lead.id;
    controls.append(edit,del);td.append(controls);tr.append(td);leadEls.rows.append(tr);
  }
  $('#lead-display-count').textContent=`${list.length} of ${leadsList.length} recent contacts shown`;
}
leadEls.search.addEventListener('input',renderBusinessCardLeads);

async function loadBusinessCardLeads() {
  if (!adminToken || dom.dashboard.classList.contains('hidden')) return;
  $('#lead-total-label').textContent='Loading saved event contacts...';
  try {
    const data = await (await leadApi('/api/admin/business-cards')).json();
    leadsList = Array.isArray(data.items) ? data.items : [];
    const total=Number(data.total??0);
    leadsLoaded=true;
    $('#lead-total-label').textContent=`${total} total business contacts. Showing latest ${leadsList.length}; export CSV for all contacts.`;
    renderBusinessCardLeads();
  } catch (error) {$('#lead-total-label').textContent=`Could not load business contacts: ${error.message}`;}
}
$('#leads-refresh').addEventListener('click',loadBusinessCardLeads);
$('#business-cards-nav').addEventListener('click', () => {
  if (dom.dashboard.classList.contains('hidden')) {dom.loginPanel.scrollIntoView({behavior:'smooth'});return;}
  loadBusinessCardLeads();
});
leadEls.rows.addEventListener('click',async event => {
  const button=event.target.closest('button[data-action]');
  if (!button) return;
  const lead=leadsList.find(item=>item.id===button.dataset.id);
  if (!lead) return;
  if (button.dataset.action==='edit') {
    leadEditingId=lead.id;
    fillLeadFields(lead);
    $('#lead-form-title').textContent='Edit saved contact';
    leadEls.save.textContent='✓ Update contact';
    setLeadSaveStatus('Review the details and click Update contact.');
    leadEls.form.scrollIntoView({behavior:'smooth',block:'start'});
  } else if (button.dataset.action==='delete') {
    if (!confirm(`Delete business card contact for ${lead.personName || lead.companyName}? This cannot be undone.`)) return;
    button.disabled=true;
    try {await leadApi(`/api/admin/business-cards/${encodeURIComponent(lead.id)}`,{method:'DELETE'});if(leadEditingId===lead.id)resetLeadForm();await loadBusinessCardLeads();}
    catch(error){alert(`Could not delete contact: ${error.message}`);button.disabled=false;}
  }
});
$('#leads-export').addEventListener('click',async()=>{
  const button=$('#leads-export');button.disabled=true;
  try {
    const blob=await(await leadApi('/api/admin/business-cards/export.csv')).blob();
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
    a.download='RISE17-2026-Business-Card-Leads.csv';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert(`Could not export business cards: ${error.message}`);}finally{button.disabled=false;}
});

// Keep contact data out of the UI after logout; the original login mechanism
// and in-memory admin token remain unchanged.
$('#logout-button').addEventListener('click',()=>{
  leadsList=[];leadsLoaded=false;resetLeadForm();closeLeadCamera();
  leadEls.raw.value='';leadImageCanvas=null;leadEls.preview.src='';
  leadEls.preview.classList.add('hidden');leadEls.placeholder.classList.remove('hidden');
  leadEls.rows.replaceChildren();
  $('#lead-total-label').textContent='Sign in to load contacts.';
  $('#lead-display-count').textContent='—';
});
// If a shared dashboard link points directly to the scanner after login,
// load its records once authentication has succeeded.
$('#login-form').addEventListener('submit',()=>{
  setTimeout(()=>{if (!dom.dashboard.classList.contains('hidden')&&location.hash==='#business-cards'&&!leadsLoaded)loadBusinessCardLeads();},500);
});

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
  search: $('#lead-search'), rows: $('#lead-rows'),
  cropBox: $('#lead-crop-box'), imageWrap: $('#lead-image-wrap'), cropRect: $('#lead-crop-rect'),
  rotate: $('#lead-rotate'), crop: $('#lead-crop-mode'), cropApply: $('#lead-crop-apply'),
  deepScan: $('#lead-deep-scan'), apiStatus: $('#lead-api-status')
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
let leadCropMode = false;
let leadCropSelection = null;
let leadPointerStart = null;
let leadScanRuns = 0;
let leadApiReady = null;
let lastLeadApiError = '';


async function leadApi(path, { method = 'GET', data = undefined } = {}) {
  if (!adminToken || dom.dashboard.classList.contains('hidden')) throw new Error('Admin login expired. Sign in again, then save.');
  if (!apiOrigin?.startsWith('https://')) throw new Error('API URL is missing from docs/config.js.');
  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetch(`${apiOrigin}${path}`, {
        method,
        headers: { Authorization: `Bearer ${adminToken}`, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
        cache: 'no-store', signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Connection timed out. Please check your network and try Save again.');
    throw new Error('Unable to contact Cloudflare Worker. Check internet, API URL and Worker CORS configuration.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('Business Card API not installed (404). Deploy the business-card Worker update from the ZIP. GitHub files alone cannot save contacts.');
    if (response.status === 401) throw new Error('Admin token was rejected (401). Sign out and sign in again.');
    if (response.status === 403) throw new Error('Cloudflare blocked this website origin (403). Check Worker allowed origins.');
    if (response.status === 500) throw new Error('Database or Worker error (500). Check qr-referral-api Observability logs / D1 binding.');
    throw new Error(typeof body.error === 'string' ? `${body.error} (HTTP ${response.status})` : `Save request failed (HTTP ${response.status}).`);
  }
  return response;
}

async function checkLeadsApi(showMessage = true) {
  if (!adminToken || dom.dashboard.classList.contains('hidden')) return;
  if (showMessage) leadEls.apiStatus.textContent = 'Checking secure business-card database connection...';
  try {
    // The original GET endpoint also creates the new table if required.
    const data = await (await leadApi('/api/admin/business-cards')).json();
    if (!Array.isArray(data.items)) throw new Error('Unexpected business-card API response. Deploy the updated Worker.');
    leadApiReady = true;
    if (showMessage) leadEls.apiStatus.textContent = '✓ Business card database connected. Saving is available.';
    return data;
  } catch (error) {
    leadApiReady = false;
    lastLeadApiError = error.message || 'Backend unavailable.';
    leadEls.apiStatus.textContent = `⚠ Save connection not ready: ${lastLeadApiError}`;
    return null;
  }
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
  return String(raw || '').replace(/[|•●]/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Privacy-first English business-card parser: NEVER make up missing values.
// Multiple OCR variants are combined, but high-risk fields require recognizable syntax.
function normaliseCardText(value) {
  return String(value || '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[＠]/g, '@').replace(/[。．]/g, '.')
    .replace(/([A-Za-z0-9._%+\-])\s*[©®]\s*(?=[A-Za-z0-9])/g, '$1@')
    .replace(/\b\[at\]\b|\(at\)/gi, '@')
    .replace(/([A-Za-z0-9])\s+@\s+([A-Za-z0-9])/g, '$1@$2')
    .replace(/([A-Za-z0-9])\s+\.\s+([A-Za-z0-9])/g, '$1.$2');
}
function businessCardEmailCandidates(raw) {
  const text=normaliseCardText(raw);
  const lines=text.split(/\r?\n/).map(tidyOcrLine).filter(Boolean);
  const candidates=[];
  const inputs=[...lines, lines.join(' ')];
  for(let i=0;i<inputs.length;i++) {
    const line=inputs[i];
    const reduced=line.replace(/\s*@\s*/g,'@').replace(/\s*\.\s*/g,'.');
    for(const m of reduced.matchAll(/\b([A-Z0-9._%+\-]{1,64})@([A-Z0-9\-]+(?:\.[A-Z0-9\-]+)+)\b/gi)) {
      const e=m[0].replace(/[.,;:]$/,'').toLowerCase();
      const domain=e.split('@')[1] || '';
      if(!/^[^\s@]+@[^\s@]+\.[A-Z]{2,15}$/i.test(e) || /\.\.|--/.test(e) || /^(?:example|test)\./.test(domain))continue;
      candidates.push({value:e,score:(/\b(?:e-?mail|mail)\b\s*[:\-]?/i.test(line)?5:0)+(i<lines.length?2:0)});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  return [...new Set(candidates.map(x=>x.value))];
}
function businessCardPhoneCandidates(raw) {
  const lines=normaliseCardText(raw).split(/\r?\n/).map(tidyOcrLine);
  const found=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/\b(?:fax|f\s*[:.]|p\.?o\.?\s*box|postal|zip|license|licence|trn|tax|registration\s*(?:no|number))\b/i.test(line))continue;
    // Tesseract occasionally substitutes O/I for a zero/one INSIDE a phone number.
    const numeric=line.replace(/(?<=\d)[Oo](?=\d|[\s-])/g,'0').replace(/(?<=\d)[Il|](?=\d)/g,'1').replace(/(?<=\+)[Oo](?=\d)/g,'0');
    const pattern=/(?:\+\s*)?\d(?:[\d\s().\-/]{5,}\d)/g;
    for(const m of numeric.matchAll(pattern)){
      const rawValue=m[0].trim().replace(/[\s.,;\-/]+$/g,'');
      const digits=rawValue.replace(/\D/g,'');
      if(digits.length<8||digits.length>15||/^(\d)\1{7,}$/.test(digits)||/^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(rawValue))continue;
      const score=(/\b(?:mobile|mob|cell|whats\s*app|wa\s*[:.]|m\s*:)/i.test(line)?12:0)
        + (/\b(?:telephone|phone|tel|contact|call|t\s*:)/i.test(line)?5:0)
        + (/^(?:\+\s*971|00971|971|05)/.test(rawValue)?5:0)
        + (rawValue.startsWith('+')?2:0)
        - (/\b(?:office|landline)\b/i.test(line)?3:0);
      const clean=rawValue.replace(/\+\s+/,'+').replace(/\s+/g,' ').trim();
      found.push({value:clean,score});
    }
  }
  found.sort((a,b)=>b.score-a.score);
  return [...new Set(found.map(x=>x.value))];
}
function parseBusinessCardText(raw) {
  const lines=normaliseCardText(raw).split(/\r?\n/).map(tidyOcrLine).filter(line=>line.length>=2);
  const email=businessCardEmailCandidates(raw)[0]||'';
  const phone=businessCardPhoneCandidates(raw)[0]||'';
  const roleRe=/\b(?:chief executive|chief operating|managing director|general manager|project manager|account manager|manager|director|founder|co-founder|ceo|cfo|coo|president|consultant|executive|engineer|sales|marketing|business development|chairman|partner|officer|coordinator|specialist|head of|accountant|administrator|proprietor|owner|advisor|designer|architect|developer|supervisor|agent|representative|relationship manager)\b/i;
  const companyRe=/\b(?:l\.?l\.?c|fze|fzc|fz-llc|limited|ltd|inc|corp|corporation|company|group|trading|enterprises|industries|technologies|solutions|consultancy|services|international|business setup|real estate|general trading|holding|holdings|establishment|consulting|global|ventures|pvt)\b/i;
  const nonNameRe=/\b(?:address|road|street|building|office|floor|suite|tower|block|area|po box|dubai|sharjah|abu dhabi|united arab emirates|uae|www|http|email|e-mail|fax|mobile|phone|tel|whatsapp|contact|instagram|facebook|linkedin|follow|visit|website|connect|quality|since|best|your|professional|welcome|reach|out|call|web|location|branch|opportunities)\b/i;
  const contactLine=line=>/@|https?:|www\.|\.(?:com|ae|net|org|co|io|biz|in)\b/i.test(line) || nonNameRe.test(line) || (line.match(/\d/g)||[]).length>=3;
  const plausibleName=line=>{
    const text=line.replace(/^(?:name\s*[:\-]|mr\.?\s+|mrs\.?\s+|ms\.?\s+|dr\.?\s+)/i,'').trim();
    if(contactLine(text)||companyRe.test(text)||roleRe.test(text)||text.length>65)return false;
    const words=text.split(/\s+/).filter(Boolean);
    if(words.length<2||words.length>4||words.some(w=>!/^\p{L}[\p{L}.'-]*$/u.test(w)))return false;
    if(words.filter(w=>w.replace(/[^\p{L}]/gu,'').length<=2).length>1)return false;
    const alpha=text.replace(/[^\p{L}]/gu,'');
    if(alpha.length<6)return false;
    const vowelCount=(text.match(/[aeiouy]/gi)||[]).length;
    if(vowelCount/Math.max(1,alpha.length)<.16)return false;
    const nonInitial=words.filter(w=>w.length>=3);
    if(nonInitial.some(w=>!/[aeiouy]/i.test(w)))return false;
    return true;
  };
  const entries=lines.map((line,i)=>({line,i}));
  const roles=entries.filter(x=>roleRe.test(x.line)&&!contactLine(x.line)&&x.line.length<=70);
  const role=roles[0];
  const nameCandidates=entries.filter(x=>plausibleName(x.line)).map(x=>{
    const words=x.line.split(/\s+/);
    let score=5+(x.i<Math.ceil(lines.length/2)?2:0)+(words.length===2?2:0)
      +(words.every(w=>/^[A-Z][a-z]/.test(w))?5:0)
      +(/^(?:name\s*[:\-])/i.test(x.line)?15:0);
    if(role){const distance=role.i-x.i;if(distance>0&&distance<=3)score+=9-distance*2;}
    if(x.line===x.line.toUpperCase())score-=2;
    if(words.some(w=>w.length>17))score-=4;
    return {...x,score};
  }).sort((a,b)=>b.score-a.score||a.i-b.i);
  let personName=nameCandidates[0]?.line.replace(/^name\s*[:\-]\s*/i,'')||'';
  // Avoid guessing from OCR gibberish; if low score, leave editable field empty.
  if((nameCandidates[0]?.score||0)<7)personName='';
  const companyCandidates=entries.filter(x=>x.line!==personName&&!contactLine(x.line)&&!roleRe.test(x.line)&&x.line.length<=90).map(x=>{
    const text=x.line.replace(/^(?:company|organization|organisation)\s*[:\-]\s*/i,'').trim();
    const words=text.split(/\s+/);
    const alpha=text.replace(/[^A-Za-z]/g,'');
    const vowels=(alpha.match(/[aeiouy]/gi)||[]).length;
    const strong=companyRe.test(text)||/^(?:company|organization|organisation)\s*[:\-]/i.test(x.line);
    const plausible=alpha.length>=5 && vowels/Math.max(1,alpha.length)>=.16 && words.length<=7 && words.filter(w=>w.length<=2).length<=2;
    if(!plausible&&!strong)return {line:'',score:-100};
    let score=(strong?13:0)+((text===text.toUpperCase()&&words.length>=2)?4:0)+(x.i<4?3:0);
    if(plausibleName(text))score-=10;
    if(text===personName||text===role?.line)score-=30;
    if(/\b(?:name|greetings|thank you|contact us|we are|we offer)\b/i.test(text))score-=10;
    return {line:text,score};
  }).filter(x=>x.score>3).sort((a,b)=>b.score-a.score);
  const companyName=companyCandidates[0]?.line||'';
  const urls=(normaliseCardText(raw).match(/(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|ae|net|org|co|io|biz|in|uk|info|me|edu)\b(?:\/[^\s]*)?/gi)||[])
    .map(x=>x.replace(/[.,;:]$/,''));
  const website=urls.find(x=>!x.includes('@')&&x.toLowerCase()!==(email.split('@')[1]||'')&&!email.includes(x.toLowerCase()))||'';
  return {personName,companyName,email,phone,jobTitle:role?.line||'',website,eventName:'RISE 17 - 2026',notes:''};
}
function lineLooksLikeEmail(text){return String(text).includes('@');}

function leadOcrQuality(data) {
  const raw=String(data?.text||'').trim();
  const parsed=parseBusinessCardText(raw);
  const validWords=(raw.match(/\b[A-Za-z]{3,}\b/g)||[]).length;
  const conf=Number.isFinite(data?.confidence)?data.confidence:0;
  return Math.min(100, Math.max(0,conf)*.42 + Math.min(25, validWords*2) +
    (parsed.email?12:0)+(parsed.phone?9:0)+(parsed.personName?6:0)+(parsed.companyName?6:0));
}

// Two photo variants preserve BOTH original colored printing and high-contrast text.
// Aggressive whitening on v2 destroyed thin email / phone characters on mobile.
function makeLeadOcrCanvas(source, mode='natural') {
  const side=Math.max(source.width,source.height);
  // Native camera resolution is kept up to 2600px to limit mobile RAM usage.
  const scale=Math.min(2600/side,Math.max(1,1900/side));
  const output=document.createElement('canvas');
  output.width=Math.max(1,Math.round(source.width*scale));
  output.height=Math.max(1,Math.round(source.height*scale));
  const ctx=output.getContext('2d',{willReadFrequently:mode!=='natural'});
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,0,0,output.width,output.height);
  if(mode==='natural')return output;
  const img=ctx.getImageData(0,0,output.width,output.height),pixels=img.data;
  const histogram=new Uint32Array(256);
  for(let i=0;i<pixels.length;i+=4){const y=Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2]);histogram[y]++;}
  const total=output.width*output.height;
  let low=0,high=255,acc=0;
  for(let i=0;i<256;i++){acc+=histogram[i];if(acc>=total*.04){low=i;break;}}
  acc=0;for(let i=255;i>=0;i--){acc+=histogram[i];if(acc>=total*.04){high=i;break;}}
  // Moderate contrast stretch: preserve fine colored text and diacritics.
  const span=Math.max(95,high-low);
  for(let i=0;i<pixels.length;i+=4){
    const y=.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2];
    let v=(y-low)*255/span;
    if(mode==='binary')v=v>145?255:0;
    else v=18+v*.89;
    v=Math.min(255,Math.max(0,v));
    pixels[i]=pixels[i+1]=pixels[i+2]=v;
  }
  ctx.putImageData(img,0,0);
  return output;
}
function enhanceLeadCanvas(source){return makeLeadOcrCanvas(source,'contrast');}

function mergeCardOcrResults(readings) {
  const ranked=[...readings].sort((a,b)=>leadOcrQuality(b)-leadOcrQuality(a));
  const best=ranked[0]||{text:''};
  const chosen=parseBusinessCardText(best.text||'');
  // Combine ONLY recognized field candidates; never compose names from unrelated text.
  // Phones with 'Mobile / WhatsApp' labels rank above fax/office numbers.
  const allLines=readings.map(r=>String(r.text||'')).join('\n');
  const emails=businessCardEmailCandidates(allLines);
  const phones=businessCardPhoneCandidates(allLines);
  if(emails.length)chosen.email=emails[0];
  if(phones.length)chosen.phone=phones[0];
  for(const field of ['personName','companyName','jobTitle','website']){
    if(chosen[field])continue;
    for(const r of ranked.slice(1)){
      const candidate=parseBusinessCardText(r.text||'')[field];
      if(candidate){chosen[field]=candidate;break;}
    }
  }
  return {fields:chosen,text:best.text||'',allText:allLines,quality:Math.round(leadOcrQuality(best))};
}
function rotateLeadCanvas(source) {
  const out=document.createElement('canvas');out.width=source.height;out.height=source.width;
  const ctx=out.getContext('2d');ctx.translate(out.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(source,0,0);return out;
}

function fillLeadFields(values) {
  for (const [key, input] of Object.entries(leadFields)) {
    input.value = typeof values[key] === 'string' ? values[key] : (key === 'eventName' ? 'RISE 17 - 2026' : '');
  }
}

async function decodeLeadFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a business card photo (JPG, PNG, or supported image format).');
  if (file.size > 20 * 1024 * 1024) throw new Error('This photo is too large. Please choose an image under 20 MB.');
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Could not read photo. Please try JPG/PNG.'));img.src=url;});
    const max=Math.max(img.naturalWidth,img.naturalHeight);
    if(!max)throw new Error('Empty photo.');
    const scale=Math.min(1,3200/max);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return canvas;
  } finally {URL.revokeObjectURL(url);}
}

function displayLeadCanvas(canvas) {
  leadImageCanvas=canvas;
  leadEls.preview.src=canvas.toDataURL('image/jpeg',.92);
  leadEls.preview.classList.remove('hidden');
  leadEls.placeholder.classList.add('hidden');
  leadEls.deepScan.disabled=false;leadEls.rotate.disabled=false;leadEls.crop.disabled=false;
}

async function scanLeadCanvas(canvas, deep=false) {
  if(leadsBusy)return;
  leadsBusy=true;
  leadScanRuns++;
  displayLeadCanvas(canvas);
  disableLeadCropMode();
  $('#lead-rescan').disabled=true;
  leadEls.deepScan.disabled=true;
  leadEls.save.disabled=true;
  resetLeadForm();
  setLeadStatus('Mobile card scan: reading original high-resolution photo...');
  const worker=await getLeadOcrWorker().catch(error=>{setLeadStatus(error.message||'OCR model failed to load.',true);return null;});
  if(!worker){leadsBusy=false;$('#lead-rescan').disabled=false;leadEls.deepScan.disabled=false;leadEls.save.disabled=false;return;}
  try {
    const readings=[];
    const original=makeLeadOcrCanvas(canvas,'natural');
    await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SPARSE_TEXT,
      tessedit_char_whitelist:'',preserve_interword_spaces:'1',user_defined_dpi:'300'});
    setLeadStatus('Reading printed names, emails and phone numbers (1/3)...');
    readings.push((await worker.recognize(original)).data);
    let first=parseBusinessCardText(readings[0].text||'');
    // Run a second pass if anything important is missing, and always for Deep scan.
    const missing=!first.personName||!first.email||!first.phone||!first.companyName;
    if(deep || missing || leadOcrQuality(readings[0])<75){
      setLeadStatus('Checking small print and card layout (2/3)...');
      const contrasted=makeLeadOcrCanvas(canvas,'contrast');
      await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.AUTO,
        tessedit_char_whitelist:'',preserve_interword_spaces:'1'});
      readings.push((await worker.recognize(contrasted)).data);
    }
    let merged=mergeCardOcrResults(readings);
    // Dedicated numeric/email pass helps phones on busy printed cards.
    if(deep || !merged.fields.phone || !merged.fields.email){
      setLeadStatus('Double-checking mobile numbers and email characters (3/3)...');
      await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SPARSE_TEXT,
        tessedit_char_whitelist:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@.+_-/(): ',
        preserve_interword_spaces:'1'});
      // Use original colors again; binary filters often lose thin @ and digits.
      readings.push((await worker.recognize(original)).data);
      await worker.setParameters({tessedit_char_whitelist:''});
    }
    merged=mergeCardOcrResults(readings);
    fillLeadFields(merged.fields);
    leadEls.raw.value=readings.map((r,i)=>`PASS ${i+1}\n${String(r.text||'').trim()}`).join('\n\n──────────\n\n');
    const missingFields=['personName','email','phone'].filter(f=>!merged.fields[f]);
    if(!merged.allText.trim())setLeadStatus('No readable text found. Take a NEW photo closer to the card, or use Select card area → Crop & scan.',true);
    else if(missingFields.length)setLeadStatus('Scan done. Some fields are unclear ('+missingFields.map(f=>({personName:'name',email:'email',phone:'mobile number'})[f]).join(', ')+'). Crop closely and try Deep scan. Please verify every field.',true);
    else setLeadStatus('Scan done: name, email and phone candidates found. VERIFY them against the card before saving. OCR may misread letters.');
  } catch(error){setLeadStatus(`OCR error: ${error.message||'Unknown error'}. You can fill details manually.`,true);}
  finally {leadsBusy=false;$('#lead-rescan').disabled=false;leadEls.deepScan.disabled=false;leadEls.save.disabled=false;}
}

function disableLeadCropMode(){
  leadCropMode=false;leadEls.imageWrap.classList.remove('cropping');
  leadEls.crop.textContent='✂ Select card area';leadEls.cropApply.disabled=true;
  leadEls.cropRect.classList.add('hidden');leadPointerStart=null;
}
function setLeadCropRect(sel){
  const box=leadEls.cropRect;
  box.style.left=`${sel.x*100}%`;box.style.top=`${sel.y*100}%`;
  box.style.width=`${sel.w*100}%`;box.style.height=`${sel.h*100}%`;
  box.classList.remove('hidden');
}
function cropLeadPoint(event){
  const r=leadEls.preview.getBoundingClientRect();
  return {x:Math.min(1,Math.max(0,(event.clientX-r.left)/r.width)),
    y:Math.min(1,Math.max(0,(event.clientY-r.top)/r.height))};
}
leadEls.crop.addEventListener('click',()=>{
  if(!leadImageCanvas||leadsBusy)return;
  if(leadCropMode){disableLeadCropMode();return;}
  leadCropMode=true;leadCropSelection=null;
  leadEls.crop.textContent='Cancel crop';leadEls.imageWrap.classList.add('cropping');
  leadEls.cropRect.classList.add('hidden');leadEls.cropApply.disabled=true;
  setLeadStatus('Drag your finger across the card photo: top-left to bottom-right. Then tap Crop & scan.');
});
leadEls.preview.addEventListener('pointerdown',event=>{
  if(!leadCropMode)return;
  event.preventDefault();leadPointerStart=cropLeadPoint(event);
  leadEls.preview.setPointerCapture?.(event.pointerId);
});
leadEls.preview.addEventListener('pointermove',event=>{
  if(!leadCropMode||!leadPointerStart)return;
  const e=cropLeadPoint(event),x=Math.min(leadPointerStart.x,e.x),y=Math.min(leadPointerStart.y,e.y);
  const w=Math.abs(e.x-leadPointerStart.x),h=Math.abs(e.y-leadPointerStart.y);
  leadCropSelection={x,y,w,h};setLeadCropRect(leadCropSelection);
  leadEls.cropApply.disabled=(w<.1||h<.1);
});
leadEls.preview.addEventListener('pointerup',event=>{
  if(!leadCropMode||!leadPointerStart)return;
  leadPointerStart=null;
  if(leadCropSelection?.w<.1||leadCropSelection?.h<.1){
    setLeadStatus('Choose a larger card area; drag across at least part of the picture.',true);
    leadEls.cropApply.disabled=true;
  }
});
leadEls.cropApply.addEventListener('click',async()=>{
  const s=leadCropSelection,canvas=leadImageCanvas;
  if(!s||!canvas||leadsBusy||s.w<.1||s.h<.1)return;
  const x=Math.round(s.x*canvas.width),y=Math.round(s.y*canvas.height);
  const w=Math.min(canvas.width-x,Math.round(s.w*canvas.width)),h=Math.min(canvas.height-y,Math.round(s.h*canvas.height));
  if(w<100||h<60){setLeadStatus('Crop too small. Select the complete card.',true);return;}
  const cropped=document.createElement('canvas');cropped.width=w;cropped.height=h;
  cropped.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
  await scanLeadCanvas(cropped,true);
});
leadEls.rotate.addEventListener('click',async()=>{
  if(leadImageCanvas&&!leadsBusy)await scanLeadCanvas(rotateLeadCanvas(leadImageCanvas),true);
});
leadEls.deepScan.addEventListener('click',async()=>{
  if(leadImageCanvas&&!leadsBusy)await scanLeadCanvas(leadImageCanvas,true);
});
$('#lead-rescan').addEventListener('click',()=>{
  if(leadImageCanvas&&!leadsBusy)scanLeadCanvas(leadImageCanvas,false);
});

async function scanLeadFile(file) {
  if (!file || leadsBusy) return;
  try { await scanLeadCanvas(await decodeLeadFile(file)); }
  catch (error) { setLeadStatus(error.message || 'Unable to read photo.', true); }
}
leadEls.camera.addEventListener('change', async () => { const file=leadEls.camera.files?.[0];leadEls.camera.value='';await scanLeadFile(file); });
leadEls.upload.addEventListener('change', async () => { const file=leadEls.upload.files?.[0];leadEls.upload.value='';await scanLeadFile(file); });

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
  if (!leadEls.form.reportValidity()) {setLeadSaveStatus('Please correct the highlighted fields.',true);return;}
  leadEls.save.disabled=true;
  setLeadSaveStatus('Saving contact to private database...');
  try {
    const editing = !!leadEditingId;
    const path = editing ? `/api/admin/business-cards/${encodeURIComponent(leadEditingId)}` : '/api/admin/business-cards';
    await leadApi(path, {method: editing ? 'PATCH' : 'POST', data:payload});
    resetLeadForm();
    setLeadSaveStatus(editing ? '✓ Business contact updated and saved.' : '✓ Business contact saved to Cloudflare D1.');
    leadApiReady=true;
    await loadBusinessCardLeads();
  } catch (error) {setLeadSaveStatus(`NOT SAVED: ${error.message || 'Unknown error'}`, true);leadEls.apiStatus.textContent=`⚠ Save issue: ${error.message||'Unknown error'}`;}
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
    leadsLoaded=true;leadApiReady=true;
    leadEls.apiStatus.textContent='✓ Business card database connected. Saving is available.';
    $('#lead-total-label').textContent=`${total} total business contacts. Showing latest ${leadsList.length}; export CSV for all contacts.`;
    renderBusinessCardLeads();
  } catch (error) {leadApiReady=false;leadEls.apiStatus.textContent=`⚠ Scanner database unavailable: ${error.message}`;$('#lead-total-label').textContent=`Could not load business contacts: ${error.message}`;}
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

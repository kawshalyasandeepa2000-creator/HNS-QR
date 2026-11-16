"use strict";
// Uses the exact same Cloudflare Worker endpoints as your current dashboard.
// Admin token lives only in this tab's memory; it is never saved to disk.
const config = window.CAMPAIGN_CONFIG;
const apiOrigin = config?.apiBaseUrl?.replace(/\/$/, "");
const customerUrl = new URL("./", document.baseURI).href;
const customerUrlForEvent = () => { const url = new URL(customerUrl); url.searchParams.set("event",selectedEventSlug);url.searchParams.set("source","qr");return url.href; };
const $ = selector => document.querySelector(selector);
const dom = {
  dashboard: $("#dashboard"), loginPanel: $("#login-panel"), loginError: $("#login-error"),
  adminError: $("#admin-error"), tokenInput: $("#token-input"), loginButton: $("#sign-in-button"),
  status: $("#connection-status"), records: $("#referral-rows"), search: $("#record-search")
};
let adminToken = "";
let recentRecords = [];
let oldRecords = [];
let selectedEventSlug = "outdoor-2026";
let selectedEventName = "RISE 17 - 2026";
let eventList = [];
let eventsBackendReady = false;
let currentView = "overview";
let eventLoadSerial = 0;
let qrBuilt = false;

function parseExportCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const splitLine = line => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cell); cell = ""; }
      else cell += ch;
    }
    cells.push(cell);
    return cells;
  };
  return { headers: splitLine(lines[0]), rows: lines.slice(1).map(splitLine) };
}

function exportTablePdf({ title, subtitle, headers, rows }) {
  const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = headers.map(h => `<th>${esc(h)}</th>`).join("");
  const body = rows.length
    ? rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">No records</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;margin:24px;color:#0b2463}h1{font-size:20px;margin:0 0 6px}
p{margin:0 0 16px;color:#536b9a;font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px}
th,td{border:1px solid #d4dff0;padding:6px 8px;text-align:left;vertical-align:top;word-break:break-word}
th{background:#0b2463;color:#fff}tr:nth-child(even){background:#f6f9ff}@page{margin:14mm}</style></head><body>
<h1>${esc(title)}</h1><p>${esc(subtitle || "")}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>addEventListener("load",()=>{print();setTimeout(()=>close(),400)})<\/script></body></html>`;
  const popup = window.open("", "_blank", "noopener");
  if (!popup) throw new Error("Allow pop-ups to export PDF, then try again.");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

window.hnsDataExport = { parseExportCsv, exportTablePdf };

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
  $("#display-count").textContent = `${filtered.length} of ${recentRecords.length} QR registrations shown`;
  const olderBody = $("#legacy-referral-rows");
  olderBody.replaceChildren();
  const older = oldRecords.filter(row => [row.fullName,row.mobileNumber,row.email,row.code,row.createdAt]
    .some(value => String(value||"").toLowerCase().includes(query)));
  if (!older.length) { const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="No legacy registrations for this event.";tr.append(td);olderBody.append(tr); }
  else for (const row of older) { const tr=document.createElement("tr");[row.fullName||"—",row.mobileNumber||"—",row.email||"—",row.code||"—",row.createdAt||"—"].forEach((value,i)=>tr.append(makeCell(value,i)));olderBody.append(tr); }
}

function paintStats(data) {
  const list = Array.isArray(data?.recent) ? data.recent : [];
  const isNewApi = Array.isArray(data?.recentQr) && Array.isArray(data?.recentLegacy);
  recentRecords = isNewApi ? data.recentQr : [];
  oldRecords = isNewApi ? data.recentLegacy : list;
  $("#campaign-name").textContent = selectedEventName;
  $("#campaign-name").title = `Database event: ${selectedEventSlug}`;
  const overviewEvent = $("#overview-event-name");
  if (overviewEvent) overviewEvent.textContent = selectedEventName;
  $("#total-count").textContent = Number(data.total || 0).toLocaleString();
  $("#recent-count").textContent = list.length.toLocaleString();
  $("#email-count").textContent = list.filter(item => typeof item.email === "string" && item.email.trim()).length.toLocaleString();
  const overviewStatus = $("#overview-connection");
  if (overviewStatus) overviewStatus.textContent = "● Connected · data refreshed for this event";
  $("#qr-data-status").textContent = isNewApi
    ? `${Number(data.totalQr||0)} QR-tagged registrations in this event · ${Number(data.totalLegacy||0)} other registrations (legacy or direct). Page visits without registration are not counted.`
    : "QR-source tracking is not active on the current Worker. All existing registrations are preserved below as source unknown; none will be falsely labelled as QR scans.";
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
  if(qrFlyer.classList.contains("hidden")) showAdminView("#qr-flyer"); else showAdminView("#overview");
});

function buildQR() {
  $("#qr-url").textContent = customerUrlForEvent();
  if (qrBuilt) return;
  if (typeof QRCode === "undefined") {
    dom.adminError.textContent = "QR code library could not load. Check your internet connection and try Refresh.";
    return;
  }
  const target = $("#qr-container");
  target.replaceChildren();
  new QRCode(target, {
    text: customerUrlForEvent(),
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
  const generation = ++eventLoadSerial;
  const event = selectedEventSlug;
  const data = await (await api(`/api/admin/stats?event=${encodeURIComponent(event)}`)).json();
  if (generation !== eventLoadSerial || event !== selectedEventSlug) return data;
  paintStats(data);
  if (currentView === "qr-flyer") buildQR();
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
    await loadEvents();
    dom.tokenInput.value = "";
    dom.loginPanel.classList.add("hidden");
    dom.dashboard.classList.remove("hidden");
    document.body.classList.add("is-signed-in");
    $("#event-switcher").classList.remove("hidden");
    showAdminView(location.hash || "#overview");
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
  oldRecords = [];
  ++eventLoadSerial;
  dom.records.replaceChildren();
  dom.dashboard.classList.add("hidden");
  setQRVisible(false);
  dom.loginPanel.classList.remove("hidden");
  dom.status.textContent = "Secure admin access";
  dom.status.classList.remove("connected");
  document.body.classList.remove("is-signed-in");
  $("#event-switcher").classList.add("hidden");
  $("#event-create-form").classList.add("hidden");
  showAdminView("#overview");
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
    const blob = await (await api(`/api/admin/export.csv?event=${encodeURIComponent(selectedEventSlug)}`)).blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `Helen-and-Sons-Referrals-${selectedEventSlug}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) { showError(dom.adminError, error); }
  finally { button.disabled = false; }
});

$("#qr-export-pdf").addEventListener("click", async () => {
  const button = $("#qr-export-pdf");
  button.disabled = true;
  dom.adminError.textContent = "";
  try {
    const csv = await (await api(`/api/admin/export.csv?event=${encodeURIComponent(selectedEventSlug)}`)).text();
    const { headers, rows } = parseExportCsv(csv);
    exportTablePdf({
      title: "QR Referral Scan",
      subtitle: `${selectedEventName} (${selectedEventSlug}) · Choose Save as PDF in the print dialog`,
      headers: headers.length ? headers : ["Customer name", "Mobile number", "Email address", "Referral code", "Created (UTC)"],
      rows
    });
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
  const scopedUrl=new URL(`${apiOrigin}${path}`);
  scopedUrl.searchParams.set('event',selectedEventSlug);
  if(data!==undefined)data={...data,eventSlug:selectedEventSlug,eventName:selectedEventName};
  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetch(scopedUrl.toString(), {
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

function updateLeadReadout(show) {
  const readout = $('#lead-readout');
  if (!readout) return;
  const items = [
    ['personName', 'Name', leadFields.personName],
    ['phone', 'Mobile', leadFields.phone],
    ['email', 'Email', leadFields.email]
  ];
  for (const [key, label, input] of items) {
    const ok = input.value.trim().length > 0;
    input.classList.toggle('lead-filled', ok);
    input.classList.toggle('lead-empty', !ok);
    const chip = readout.querySelector(`[data-field="${key}"]`);
    if (!chip) continue;
    chip.className = ok ? 'is-found' : 'is-missing';
    chip.textContent = ok ? `${label} read` : `${label} not read`;
  }
  readout.hidden = !show;
}
function resetLeadForm(options = {}) {
  leadEditingId = null;
  leadEls.form.reset();
  leadFields.eventName.value = selectedEventName;
  $('#lead-form-title').textContent = 'Contact details';
  leadEls.save.textContent = '✓ Save business contact';
  setLeadSaveStatus('');
  if (options.clearVoice) {
    const note = $('#lead-voice-note');
    if (note) note.value = '';
    setLeadShareStatus('');
  }
  for (const input of [leadFields.personName, leadFields.phone, leadFields.email]) {
    input.classList.remove('lead-filled', 'lead-empty');
  }
  const readout = $('#lead-readout');
  if (readout) readout.hidden = true;
}
$('#lead-clear').addEventListener('click', () => resetLeadForm({clearVoice:true}));
for (const input of [leadFields.personName, leadFields.phone, leadFields.email]) {
  input.addEventListener('input', () => {
    if (!$('#lead-readout')?.hidden) updateLeadReadout(true);
  });
}

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
        + (/^(?:\+\s*94|0094|07)/.test(rawValue.replace(/\s/g,''))?4:0)
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
  return {personName,companyName,email,phone,jobTitle:role?.line||'',website,eventName:selectedEventName,notes:''};
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
    input.value = typeof values[key] === 'string' ? values[key] : (key === 'eventName' ? selectedEventName : '');
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
    else setLeadStatus('Scan done. Name, mobile and email are filled below. Check them against the card, then save.');
    updateLeadReadout(true);
    leadEls.form.scrollIntoView({behavior:'smooth',block:'nearest'});
  } catch(error){setLeadStatus(`OCR error: ${error.message||'Unknown error'}. You can fill details manually.`,true);updateLeadReadout(true);}
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
  if (!navigator.mediaDevices?.getUserMedia) { setLeadStatus('Live camera is not available in this browser. Use Take a photo instead.', true); return; }
  try {
    closeLeadCamera();
    leadsCameraStream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    leadEls.video.srcObject = leadsCameraStream;
    leadEls.webcam.classList.remove('hidden');
    await leadEls.video.play();
    leadEls.webcam.scrollIntoView({behavior:'smooth',block:'center'});
    setLeadStatus('Fit the whole card inside the yellow frame, hold steady, then tap Scan this card.');
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

function setLeadShareStatus(message, isError = false) {
  const el = $('#lead-share-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#9b2835' : '#2b6480';
}

let leadRecognizer = null;
let leadListening = false;
let leadVoiceCommitted = '';

$('#lead-mic').addEventListener('click', () => {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = $('#lead-mic');
  const note = $('#lead-voice-note');
  if (!Ctor || !button || !note) {
    setLeadShareStatus('This browser cannot transcribe the microphone. Type the note, or use Chrome or Edge.', true);
    return;
  }
  if (leadListening) {
    try { leadRecognizer?.stop(); } catch {}
    return;
  }
  leadVoiceCommitted = note.value.trim();
  const rec = new Ctor();
  leadRecognizer = rec;
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  rec.onstart = () => {
    leadListening = true;
    button.classList.add('is-listening');
    button.setAttribute('aria-pressed', 'true');
    button.textContent = '⏹ Stop mic';
    setLeadShareStatus('Listening… speak now. The words will appear in the box.');
  };
  rec.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        const spoken = piece.trim();
        if (spoken) leadVoiceCommitted = `${leadVoiceCommitted} ${spoken}`.trim();
      } else interim += piece;
    }
    note.value = `${leadVoiceCommitted}${interim ? ` ${interim}` : ''}`.trim();
  };
  rec.onerror = event => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    const messages = {
      'not-allowed': 'Microphone permission was blocked. Allow the mic for this site, then tap Mic again.',
      'audio-capture': 'No microphone was found.',
      network: 'Voice transcription needs an internet connection. Type the note instead.'
    };
    setLeadShareStatus(messages[event.error] || 'Could not transcribe that. You can type the note.', true);
  };
  rec.onend = () => {
    leadListening = false;
    button.classList.remove('is-listening');
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '🎤 Mic';
    if (note.value.trim()) setLeadShareStatus('Voice note ready. Send it on WhatsApp or email.');
  };
  try { rec.start(); }
  catch { setLeadShareStatus('Microphone is already in use. Stop it, then try again.', true); }
});

function leadShareText() {
  const payload = leadFormPayload();
  const note = ($('#lead-voice-note')?.value || '').trim();
  const lines = ['Helen and Sons business card'];
  if (payload.personName) lines.push(`Name: ${payload.personName}`);
  if (payload.companyName) lines.push(`Company: ${payload.companyName}`);
  if (payload.phone) lines.push(`Mobile: ${payload.phone}`);
  if (payload.email) lines.push(`Email: ${payload.email}`);
  if (payload.jobTitle) lines.push(`Title: ${payload.jobTitle}`);
  if (payload.website) lines.push(`Website: ${payload.website}`);
  if (payload.eventName) lines.push(`Event: ${payload.eventName}`);
  if ((!payload.personName || !payload.phone || !payload.email) && leadImageCanvas) {
    lines.push('', 'Some card details were not read. The card photo is included.');
  }
  if (note) lines.push('', note);
  return {
    text: lines.join('\n'),
    phone: payload.phone.replace(/\D/g, ''),
    email: payload.email,
    note
  };
}

function downloadLeadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function leadCardFile() {
  if (!leadImageCanvas) return null;
  const blob = await new Promise(resolve => leadImageCanvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return null;
  const safe = (leadFields.personName.value.trim() || 'business-card').replace(/[^\w.-]+/g, '-').slice(0, 40);
  return new File([blob], `${safe}.jpg`, { type: 'image/jpeg' });
}

async function sendLeadCard(channel) {
  const share = leadShareText();
  const hasSomething = share.note || share.phone || share.email || leadFields.personName.value.trim() || leadFields.companyName.value.trim() || leadImageCanvas;
  if (!hasSomething) {
    setLeadShareStatus('Scan a card or speak a note before sending.', true);
    return;
  }
  const file = await leadCardFile();
  if (channel === 'whatsapp' && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: share.text, title: 'Business card' });
      setLeadShareStatus('Shared. Choose WhatsApp to send the card photo and the words.');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  if (channel === 'whatsapp') {
    const target = share.phone.length >= 8 && share.phone.length <= 15 ? share.phone : '';
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(share.text)}`, '_blank', 'noopener,noreferrer');
    if (file) {
      downloadLeadFile(file);
      setLeadShareStatus('WhatsApp opened. The card photo downloaded — attach that image in the chat.');
    } else setLeadShareStatus('WhatsApp opened with the note.');
    return;
  }
  const mail = document.createElement('a');
  mail.href = `mailto:${share.email}?subject=${encodeURIComponent('Business card')}&body=${encodeURIComponent(share.text)}`;
  mail.click();
  if (file) {
    downloadLeadFile(file);
    setLeadShareStatus('Email opened. The card photo downloaded — attach that image. Email cannot attach the photo by itself.');
  } else setLeadShareStatus('Email opened with the note.');
}

$('#lead-send-whatsapp').addEventListener('click', () => { sendLeadCard('whatsapp'); });
$('#lead-send-email').addEventListener('click', () => { sendLeadCard('email'); });

function leadFormPayload() {
  return Object.fromEntries(Object.entries(leadFields).map(([key,input]) => [key,input.value.trim()]));
}
leadEls.form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = leadFormPayload();
  const voice = ($('#lead-voice-note')?.value || '').trim();
  if (voice && !payload.notes.includes(voice)) payload.notes = [payload.notes, voice].filter(Boolean).join('\n').slice(0, 500);
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
  const expectedEvent=selectedEventSlug;
  try {
    const data = await (await leadApi('/api/admin/business-cards')).json();
    if(expectedEvent!==selectedEventSlug)return;
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
    a.download=`Helen-and-Sons-Scan-Card-${selectedEventSlug}.csv`;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert(`Could not export business cards: ${error.message}`);}finally{button.disabled=false;}
});
async function exportScanCardPdf(button) {
  if (button) button.disabled = true;
  try {
    const csv = await (await leadApi('/api/admin/business-cards/export.csv')).text();
    const { headers, rows } = parseExportCsv(csv);
    exportTablePdf({
      title: 'Scan Card contacts',
      subtitle: `${selectedEventName} · saved scanner contacts · Save as PDF in print dialog`,
      headers: headers.length ? headers : ['Person', 'Company', 'Email', 'Phone', 'Job title', 'Added (UTC)'],
      rows
    });
  } catch (error) {
    alert(`Could not export PDF: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}
function bindClick(id, handler) {
  const el = $(id);
  if (el) el.addEventListener('click', handler);
}
bindClick('#leads-import-open-toolbar', () => $('#leads-import-open')?.click());
bindClick('#leads-export-toolbar-csv', () => $('#leads-export')?.click());
bindClick('#leads-export-toolbar-pdf', event => exportScanCardPdf(event.currentTarget));
bindClick('#leads-export-pdf', event => exportScanCardPdf(event.currentTarget));

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


// Each event is a real, server-authorized D1 event; this never saves contact data to localStorage.
const adminSections = ["overview-panel","customers","csv-references","business-cards","qr-flyer"];
const adminViewKeys = ["overview","customers","csv-references","business-cards","qr-flyer"];
function applyAdminShell(next) {
  const signedIn = !dom.dashboard.classList.contains("hidden");
  const hero = $("#hero-card");
  if (hero) hero.classList.add("hidden");
  if (signedIn && next !== "overview") $("#event-create-form")?.classList.add("hidden");
  for (const key of adminViewKeys) document.body.classList.toggle(`admin-view-${key}`, signedIn && key === next);
  qrToggle?.classList.toggle("active", next === "qr-flyer");
}
function showAdminView(target) {
  const hash = String(target||"#overview").replace(/^#/, "");
  const map = {overview:"overview-panel",customers:"customers","csv-references":"csv-references","business-cards":"business-cards","qr-flyer":"qr-flyer"};
  const next = map[hash] ? hash : "overview";
  currentView = next;
  const panelId = map[next];
  for (const id of adminSections) {
    const section = $("#"+id);
    if (section) section.classList.toggle("hidden", id !== panelId);
  }
  applyAdminShell(next);
  if(next==="qr-flyer") {qrBuilt=false;buildQR();}
  qrToggle.setAttribute("aria-expanded",String(next==="qr-flyer"));
  qrToggle.querySelector(".qr-toggle-label").textContent=next==="qr-flyer"?"Hide QR flyer":"Show QR flyer";
  document.querySelectorAll('.side-nav a[href^="#"]').forEach(a=>a.classList.toggle("active", a.getAttribute("href") === "#"+next));
  if(next==="overview") document.querySelector('.side-nav a[href="#overview"]')?.classList.add("active");
  if(!dom.dashboard.classList.contains("hidden")) {
    if(next==="business-cards" && typeof loadBusinessCardLeads==="function") loadBusinessCardLeads();
    if(next==="csv-references") window.dispatchEvent(new Event("hns:event-references-view"));
    if(next==="overview") fetchDashboard().catch(error=>showError(dom.adminError,error));
  }
}
for (const anchor of document.querySelectorAll('.side-nav a[href^="#"]')) anchor.addEventListener('click',event=>{
  event.preventDefault();
  if(dom.dashboard.classList.contains("hidden")){dom.loginPanel.scrollIntoView({behavior:"smooth"});return;}
  history.replaceState(null,"",anchor.getAttribute("href"));
  showAdminView(anchor.getAttribute("href"));
  window.scrollTo({top:0,behavior:"smooth"});
});
window.addEventListener("hashchange",()=>{if(!dom.dashboard.classList.contains("hidden"))showAdminView(location.hash);});

async function loadEvents() {
  const picker=$("#event-select");
  try {
    const data = await (await api("/api/admin/events")).json();
    if(!Array.isArray(data.items)||!data.items.length) throw new Error("Events API not installed.");
    eventList=data.items;
    eventsBackendReady=true;
    picker.disabled=false;$("#event-new-button").disabled=false;
  } catch(error) {
    // IMPORTANT: Never lock admins out of the existing single-event dashboard
    // when the front-end reaches GitHub before the new Worker/migration is ready.
    eventsBackendReady=false;
    eventList=[{slug:"outdoor-2026",name:"RISE 17 - 2026"}];
    selectedEventSlug="outdoor-2026";
    picker.disabled=true;$("#event-new-button").disabled=true;
    dom.status.textContent="Single-event mode · Worker events update pending";
  }
  picker.replaceChildren();
  for (const item of eventList) picker.append(new Option(item.name,item.slug));
  if(!eventList.some(item=>item.slug===selectedEventSlug))selectedEventSlug="outdoor-2026";
  picker.value=selectedEventSlug;
  selectedEventName=eventList.find(item=>item.slug===selectedEventSlug)?.name||"RISE 17 - 2026";
  updateEventLinks();
}
function updateEventLinks(){
  const url=new URL(customerUrl);url.searchParams.set("event",selectedEventSlug);
  $("#live-website-link").href=url.href;
  $("#sidebar-site-link").href=url.href;
  $("#lead-event").value=selectedEventName;
  const overviewEvent=$("#overview-event-name");
  if(overviewEvent)overviewEvent.textContent=selectedEventName;
  if(qrBuilt){qrBuilt=false;$("#qr-container").replaceChildren();}
  $("#qr-url").textContent=customerUrlForEvent();
}
function switchEvent(slug){
  const target=eventList.find(item=>item.slug===slug);
  if(!target||!eventsBackendReady)return;
  if(leadEditingId)resetLeadForm();
  selectedEventSlug=target.slug;selectedEventName=target.name;
  $("#event-select").value=slug;
  updateEventLinks();
  recentRecords=[];oldRecords=[];renderRecords();
  leadsList=[];renderBusinessCardLeads();
  window.dispatchEvent(new CustomEvent("hns:event-changed",{detail:{slug,name:target.name}}));
  dom.status.textContent="Loading event…";
  fetchDashboard().catch(error=>showError(dom.adminError,error));
  if(currentView==="qr-flyer")buildQR();
  if(currentView==="business-cards")loadBusinessCardLeads();
  if(currentView==="csv-references")window.dispatchEvent(new Event("hns:event-references-view"));
}
$("#event-select").addEventListener("change",e=>switchEvent(e.target.value));
$("#event-new-button").addEventListener("click",()=>{
  if(!eventsBackendReady){
    $("#event-create-status").textContent="New Event needs the updated Cloudflare Worker and D1 events table. RISE 17 data stays safe until that deploy is done.";
    showAdminView("#overview");
    $("#event-create-form").classList.remove("hidden");
    $("#event-create-form").scrollIntoView({behavior:"smooth",block:"nearest"});
    return;
  }
  showAdminView("#overview");
  $("#event-create-form").classList.remove("hidden");
  $("#event-new-name").focus();
});
$("#event-create-cancel").addEventListener("click",()=>{$("#event-create-form").classList.add("hidden");$("#event-create-status").textContent="";});
$("#event-create-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const name=$("#event-new-name").value.trim();
  if(name.length<3)return;
  const button=$("#event-create-save");button.disabled=true;
  try {
    const response=await fetch(`${apiOrigin}/api/admin/events`,{method:"POST",headers:{Authorization:`Bearer ${adminToken}`,"Content-Type":"application/json"},body:JSON.stringify({name})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Event creation failed (HTTP ${response.status})`);
    await loadEvents();switchEvent(data.slug);
    $("#event-new-name").value="";$("#event-create-status").textContent="";
    $("#event-create-form").classList.add("hidden");
    history.replaceState(null,"","#overview");showAdminView("#overview");
  }catch(error){$("#event-create-status").textContent=error.message;}
  finally{button.disabled=false;}
});

showAdminView(location.hash || "#overview");
for (const tile of document.querySelectorAll("[data-admin-view]")) {
  tile.addEventListener("click", () => {
    if (dom.dashboard.classList.contains("hidden")) {
      dom.loginPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const target = tile.getAttribute("data-admin-view");
    history.replaceState(null, "", target);
    showAdminView(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

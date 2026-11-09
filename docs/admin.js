"use strict";
// Uses the exact same Cloudflare Worker endpoints as your current dashboard.
// Admin token lives only in this tab's memory; it is never saved to disk.
const config = window.CAMPAIGN_CONFIG;
const apiOrigin = config?.apiBaseUrl?.replace(/\/$/, "");
const customerUrl = new URL("./", window.location.href).href;
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
  $("#campaign-name").textContent = data.campaign || config?.campaign || "—";
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
    colorDark: "#00005C",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
  qrBuilt = true;
}

async function fetchDashboard() {
  dom.adminError.textContent = "";
  const data = await (await api("/api/admin/stats")).json();
  paintStats(data);
  buildQR();
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
    ctx.fillStyle = "#00005C";
    ctx.fillRect(0, 0, 850, 1180);
    ctx.fillStyle = "#F5C400";
    ctx.fillRect(24, 24, 802, 1132);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(42, 42, 766, 1096);
    ctx.fillStyle = "#00005C";
    ctx.fillRect(42, 42, 766, 20);

    const brandImg = $(".poster-logo img");
    if (brandImg && brandImg.complete && brandImg.naturalWidth) {
      ctx.fillStyle = "#00005C";
      ctx.fillRect(318, 95, 214, 225);
      ctx.drawImage(brandImg, 332, 103, 188, 220);
    } else {
      ctx.textAlign = "center";
      ctx.fillStyle = "#00005C";
      ctx.font = "bold 35px Arial, sans-serif";
      ctx.fillText("HELEN AND SONS", 425, 237);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#00005C";
    ctx.font = "bold 27px Arial, sans-serif";
    ctx.fillText("OFFICIAL REFERRAL PROGRAMME", 425, 373, 720);
    ctx.font = "bold 49px Arial, sans-serif";
    ctx.fillText("SCAN & GET YOUR", 425, 458, 730);
    ctx.fillStyle = "#ad8b00";
    ctx.fillText("REFERRAL CODE", 425, 521, 730);
    ctx.fillStyle = "#00005C";
    ctx.font = "24px Arial, sans-serif";
    ctx.fillText("Name and mobile required. Email optional.", 425, 574, 730);

    ctx.fillStyle = "#00005C";
    ctx.fillRect(190, 622, 470, 470);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(201, 633, 448, 448);
    ctx.drawImage(qrCanvas || qrImg, 216, 648, 418, 418);
    ctx.fillStyle = "#00005C";
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

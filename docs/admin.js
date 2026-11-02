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
    colorDark: "#0b294c",
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
  const canvas = $("#qr-container canvas");
  const image = $("#qr-container img");
  if (!canvas && !image) {
    dom.adminError.textContent = "QR image is not ready.";
    return;
  }
  const a = document.createElement("a");
  a.href = canvas ? canvas.toDataURL("image/png") : image.src;
  a.download = "Helen-and-Sons-Campaign-QR.png";
  document.body.append(a);
  a.click();
  a.remove();
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

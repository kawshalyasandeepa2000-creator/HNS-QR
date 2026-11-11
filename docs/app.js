"use strict";
const cfg = window.CAMPAIGN_CONFIG;
const codeElement = document.querySelector("#referral-code");
const statusElement = document.querySelector("#status");
const createdAtElement = document.querySelector("#created-at");
const downloadButton = document.querySelector("#download-button");
const copyButton = document.querySelector("#copy-button");
const referralForm = document.querySelector("#referral-form");
const claimButton = document.querySelector("#claim-button");
const passDetails = document.querySelector("#pass-details");
const referralActions = document.querySelector("#referral-actions");
const issuedTo = document.querySelector("#issued-to");
let referral = null;

function getVisitorId(campaign) {
  const key = `qr-referral-visitor:${campaign}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
  } catch {}
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(key, id); } catch {}
  return id;
}

function apiUrl(path) {
  if (!cfg || !/^https:\/\//.test(cfg.apiBaseUrl) || cfg.apiBaseUrl.includes("YOUR-")) {
    throw new Error("Website not configured yet. Ask the organizer to set the Cloudflare API URL.");
  }
  return `${cfg.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

async function submitReferral(event) {
  event.preventDefault();
  if (!referralForm.reportValidity()) return;

  const fullName = document.querySelector("#full-name").value.trim();
  const mobileNumber = document.querySelector("#mobile-number").value.trim();
  const email = document.querySelector("#email-address").value.trim();
  const consent = document.querySelector("#contact-consent").checked;
  if (!email || !document.querySelector("#email-address").checkValidity()) {
    statusElement.textContent = "Please enter a valid email address to receive your referral code.";
    document.querySelector("#email-address").focus();
    return;
  }
  if (!consent) return;

  statusElement.textContent = "Saving your details and creating your referral pass...";
  claimButton.disabled = true;
  downloadButton.disabled = true;
  copyButton.disabled = true;

  try {
    const response = await fetch(apiUrl("/api/referrals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign: cfg.campaign,
        visitorId: getVisitorId(cfg.campaign),
        fullName,
        mobileNumber,
        email,
        consent
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not issue your code.");

    referral = data;
    codeElement.textContent = data.code;
    issuedTo.textContent = `Issued to: ${data.fullName || fullName}`;
    codeElement.classList.remove("loading");
    statusElement.textContent = data.reused ? "Welcome back! Here is your saved code." : "Success! Your referral pass is ready.";
    createdAtElement.textContent = `Issued: ${new Date(data.createdAt).toLocaleString()}`;
    passDetails.classList.remove("hidden");
    referralActions.classList.remove("hidden");
    referralForm.classList.add("hidden");
    downloadButton.disabled = false;
    copyButton.disabled = false;
    // Refresh anonymous campaign activity after a successful registration.
    if (typeof loadActivity === "function") loadActivity();
  } catch (error) {
    referral = null;
    statusElement.textContent = error.message || "Could not connect. Please check your details and try again.";
  } finally {
    claimButton.disabled = false;
  }
}

function showSaveImageFallback(imageData, fileName) {
  let help = document.querySelector("#hns-save-image-help");
  if (!help) {
    help = document.createElement("section");
    help.id = "hns-save-image-help";
    help.setAttribute("aria-label", "Save your referral pass image");
    help.style.cssText = "margin-top:18px;padding:16px;border:1px solid #C89116;border-radius:14px;background:#fff;color:#0B2463;text-align:center;max-width:100%;";

    const description = document.createElement("p");
    description.style.cssText = "margin:0 0 12px;font-size:14px;line-height:1.55;";
    description.textContent = "If the image did not download automatically, tap Save PNG below. On an iPhone, you can also touch and hold the image to save it to Photos.";

    const saveLink = document.createElement("a");
    saveLink.id = "hns-manual-png-link";
    saveLink.textContent = "⬇ Save referral image (PNG)";
    saveLink.style.cssText = "display:inline-block;padding:12px 16px;background:linear-gradient(135deg,#0B2463,#0D286A);color:#F5E77E;border-radius:9px;font-weight:700;text-decoration:none;margin-bottom:12px;";

    const preview = document.createElement("img");
    preview.id = "hns-pass-image-preview";
    preview.alt = "Your Helen and Sons referral pass: touch and hold to save the image";
    preview.style.cssText = "display:block;width:100%;max-width:460px;height:auto;margin:0 auto;border-radius:10px;border:1px solid #C89116;";

    help.append(description, saveLink, preview);
    (referralActions || passDetails || document.body).insertAdjacentElement("afterend", help);
  }
  const saveLink = help.querySelector("#hns-manual-png-link");
  const preview = help.querySelector("#hns-pass-image-preview");
  saveLink.href = imageData;
  saveLink.download = fileName;
  preview.src = imageData;
  help.hidden = false;
}

// Keep this function synchronous: iPhone/Safari can block downloads triggered
// after awaiting toBlob(), because they are no longer within the original tap.
function downloadCard(event) {
  if (event) event.preventDefault();
  if (!referral || !referral.code) {
    statusElement.textContent = "Please create your referral code before downloading the pass.";
    return;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image creation is unavailable in this browser.");

    // Official Helen and Sons brand colours and the customer-provided logo.
    const NAVY = "#0B2463";
    const ROYAL = "#0D286A";
    const SKY = "#163B89";
    const GOLD = "#C89116";
    const SOFT_GOLD = "#F5E77E";
    const WHITE = "#FFFFFF";
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, 1200, 630);
    const glow = ctx.createRadialGradient(1010, 450, 50, 1010, 450, 580);
    glow.addColorStop(0, "rgba(245,231,126,.30)");
    glow.addColorStop(1, "rgba(245,231,126,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1200, 630);

    ctx.lineWidth = 4;
    ctx.strokeStyle = GOLD;
    roundRect(ctx, 38, 35, 1124, 560, 32, false, true);
    ctx.fillStyle = WHITE;
    roundRect(ctx, 62, 60, 1076, 511, 25, true, false);
    const bannerGrad = ctx.createLinearGradient(81,78,1119,241);
    bannerGrad.addColorStop(0, NAVY);
    bannerGrad.addColorStop(.72, ROYAL);
    bannerGrad.addColorStop(1, SKY);
    ctx.fillStyle = bannerGrad;
    roundRect(ctx, 81, 78, 1038, 163, 19, true, false);
    ctx.fillStyle = SOFT_GOLD;
    ctx.fillRect(81, 233, 1038, 5);

    // The official image is already displayed on the page; no async fetch
    // is needed here, preserving the click-triggered mobile PNG download.
    const logo = document.querySelector("#hns-official-logo");
    if (logo && logo.complete && logo.naturalWidth) {
      const logoW = 450;
      const logoH = logoW * logo.naturalHeight / logo.naturalWidth;
      ctx.drawImage(logo, 106, 89, logoW, logoH);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.font = "bold 36px Arial, sans-serif";
    ctx.fillText("OFFICIAL REFERRAL PASS", 595, 162, 492);
    ctx.fillStyle = "#F5E77E";
    ctx.font = "bold 20px Arial, sans-serif";
    ctx.fillText("VISA CONSULTANCY", 595, 198);

    ctx.fillStyle = NAVY;
    ctx.font = "bold 20px Arial, sans-serif";
    ctx.fillText("YOUR UNIQUE REFERRAL CODE", 117, 306);
    ctx.fillStyle = "rgba(245,231,126,.32)";
    roundRect(ctx, 113, 325, 971, 87, 12, true, false);
    ctx.fillStyle = NAVY;
    ctx.font = "bold 55px Consolas, Arial, sans-serif";
    ctx.fillText(String(referral.code).slice(0, 30), 137, 384, 923);

    ctx.fillStyle = NAVY;
    ctx.font = "bold 23px Arial, sans-serif";
    ctx.fillText(`Issued to: ${String(referral.fullName || "").slice(0, 65)}`, 120, 455, 960);
    ctx.font = "20px Arial, sans-serif";
    ctx.fillText(`Mobile: ${String(referral.mobileNumber || "").slice(0, 30)}`, 120, 490);
    const issuedDate = new Date(referral.createdAt);
    const issuedDateText = Number.isNaN(issuedDate.getTime()) ? "Not available" : issuedDate.toLocaleString();
    ctx.fillText(`Issued: ${issuedDateText}`, 120, 526);
    ctx.fillStyle = "#4C6697";
    ctx.font = "17px Arial, sans-serif";
    ctx.fillText("Keep your code ready when referring someone. Contact details are not shared publicly.", 120, 556, 960);

    // Synchronous PNG generation preserves the browser's original user action.
    const imageData = canvas.toDataURL("image/png");
    if (!imageData.startsWith("data:image/png;base64,")) throw new Error("Unable to create the PNG image.");
    const safeCode = String(referral.code).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
    const fileName = `Helen-and-Sons-Referral-${safeCode}.png`;

    const link = document.createElement("a");
    link.href = imageData;
    link.download = fileName;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();

    // Always offer an alternative for iPhones and browser download restrictions.
    showSaveImageFallback(imageData, fileName);
    statusElement.textContent = "Your PNG is ready. If it didn't download, use Save referral image below or touch and hold the preview.";
  } catch (error) {
    statusElement.textContent = `Image download could not start: ${error.message || "Please try another browser."} You can still copy your referral code.`;
    console.error("Helen & Sons referral image error:", error);
  }
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  if (typeof radius === "number") {
    radius = { tl: radius, tr: radius, br: radius, bl: radius };
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

async function copyCode() {
  if (!referral) return;
  try {
    await navigator.clipboard.writeText(referral.code);
    copyButton.textContent = "Copied!";
    setTimeout(() => { copyButton.textContent = "Copy referral code"; }, 1500);
  } catch {
    statusElement.textContent = "Select and manually copy the code above.";
  }
}

downloadButton.addEventListener("click", downloadCard);
copyButton.addEventListener("click", copyCode);
referralForm.addEventListener("submit", submitReferral);

// Public activity displays only issue dates and aggregated totals.
// Never display names, phone numbers, emails or unmasked referral codes.
const activityFeed = document.querySelector("#activity-feed");
const activityTotal = document.querySelector("#activity-total");
let activityRequest = null;
async function loadActivity() {
  if (!activityFeed || !activityTotal) return;
  if (activityRequest) return activityRequest;
  activityRequest = (async () => {
    try {
      const response = await fetch(apiUrl("/api/public/activity"), { cache: "no-store" });
      if (!response.ok) throw new Error("Activity unavailable");
      const data = await response.json();
      if (!Array.isArray(data.recent) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("Invalid activity data");
      activityTotal.textContent = data.total.toLocaleString();
      activityFeed.replaceChildren();
      if (!data.recent.length) {
        const empty = document.createElement("p");
        empty.className = "activity-placeholder";
        empty.textContent = "No referral passes have been issued yet. Be the first!";
        activityFeed.append(empty);
        return;
      }
      for (const item of data.recent.slice(0, 6)) {
        const dt = new Date(item.issuedAt);
        if (Number.isNaN(dt.getTime())) continue;
        const row = document.createElement("article");
        row.className = "activity-entry";
        const symbol = document.createElement("span");
        symbol.className = "activity-icon";
        symbol.textContent = "✓";
        symbol.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "activity-entry-label";
        label.textContent = "Referral pass issued";
        const when = document.createElement("time");
        when.dateTime = dt.toISOString();
        when.textContent = dt.toLocaleString(undefined, { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
        row.append(symbol, label, when);
        activityFeed.append(row);
      }
    } catch {
      activityFeed.replaceChildren();
      const notice = document.createElement("p");
      notice.className = "activity-placeholder";
      notice.textContent = "Live activity is not available yet. The Cloudflare Worker activity update may still need to be deployed.";
      activityFeed.append(notice);
      activityTotal.textContent = "—";
    }
  })();
  try { await activityRequest; } finally { activityRequest = null; }
}
if (activityFeed) {
  loadActivity();
  document.querySelector("#activity-refresh")?.addEventListener("click", loadActivity);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadActivity(); });
  setInterval(() => { if (!document.hidden) loadActivity(); }, 60000);
}

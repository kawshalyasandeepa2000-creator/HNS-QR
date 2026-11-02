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
  } catch (error) {
    referral = null;
    statusElement.textContent = error.message || "Could not connect. Please check your details and try again.";
  } finally {
    claimButton.disabled = false;
  }
}

async function downloadCard() {
  if (!referral) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const bg = ctx.createLinearGradient(0, 0, 1200, 630);
  bg.addColorStop(0, "#e6f4ff");
  bg.addColorStop(0.45, "#f9fdff");
  bg.addColorStop(1, "#e9f0ff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.fillStyle = "rgba(13,99,168,0.08)";
  ctx.beginPath();
  ctx.arc(160, 110, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(1040, 520, 140, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 70, 60, 1060, 510, 34, true, false);
  ctx.strokeStyle = "rgba(10, 42, 82, 0.12)";
  ctx.lineWidth = 2;
  roundRect(ctx, 70, 60, 1060, 510, 34, false, true);

  const banner = ctx.createLinearGradient(0, 0, 1060, 0);
  banner.addColorStop(0, "#06264a");
  banner.addColorStop(1, "#1171bc");
  ctx.fillStyle = banner;
  roundRect(ctx, 90, 82, 1020, 145, 26, true, false);

  ctx.fillStyle = "#f8d46c";
  ctx.fillRect(90, 214, 1020, 4);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.fillText("HELEN & SONS VISA CONSULTANCY", 130, 135);
  ctx.font = "bold 46px Arial, sans-serif";
  ctx.fillText("REFERRAL PASS", 130, 190);

  ctx.fillStyle = "#5e7690";
  ctx.font = "bold 19px Arial, sans-serif";
  ctx.fillText("YOUR UNIQUE REFERRAL CODE", 130, 302);
  ctx.fillStyle = "#082b52";
  ctx.font = "bold 60px Consolas, monospace";
  ctx.fillText(referral.code, 130, 385);

  ctx.fillStyle = "#264866";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.fillText(`Issued to: ${(referral.fullName || "").slice(0, 60)}`, 130, 445);
  ctx.font = "21px Arial, sans-serif";
  ctx.fillText(`Mobile: ${(referral.mobileNumber || "").slice(0, 30)}`, 130, 480);
  ctx.fillText(`Issued: ${new Date(referral.createdAt).toLocaleString()}`, 130, 515);
  ctx.font = "20px Arial, sans-serif";
  ctx.fillStyle = "#5b7088";
  ctx.fillText("Keep this pass for Helen & Sons referrals. Email is optional and is not printed on the pass.", 130, 555);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    statusElement.textContent = "Image download unavailable. Please copy the code instead.";
    return;
  }
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `Helen-and-Sons-Referral-${referral.code}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
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

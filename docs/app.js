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

// Prepare the image *after* a referral is issued so tapping Download / Share is instant.
// Keep all personal data in this browser tab; do not expose public activity records.
let preparedPass = null;
let submitting = false;
const isAppleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setBusy(busy) {
  claimButton.disabled = busy;
  claimButton.textContent = busy ? "Creating your code…" : "Get my referral code →";
}

async function submitReferral(event) {
  event.preventDefault();
  if (submitting || !referralForm.reportValidity()) return;

  const fullName = document.querySelector("#full-name").value.trim();
  const mobileNumber = document.querySelector("#mobile-number").value.trim();
  const emailInput = document.querySelector("#email-address");
  const email = emailInput.value.trim();
  const consent = document.querySelector("#contact-consent").checked;
  if (!email || !emailInput.checkValidity()) {
    statusElement.textContent = "Please enter a valid email address to receive your referral code.";
    emailInput.focus();
    return;
  }
  if (!consent) return;

  submitting = true;
  setBusy(true);
  statusElement.textContent = "Connecting securely to the referral system…";
  // Keep the request single: double-tapping would otherwise create unnecessary calls.
  const controller = new AbortController();
  const slowNotice = setTimeout(() => {
    if (submitting) statusElement.textContent = "The network is taking longer than usual. Please keep this page open — do not submit twice.";
  }, 6000);
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    // The same stable visitor ID allows an interrupted request to recover its code.
    const response = await fetch(apiUrl("/api/referrals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign: cfg.campaign,
        visitorId: getVisitorId(cfg.campaign),
        fullName, mobileNumber, email, consent
      }),
      cache: "no-store",
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not issue your code.");
    if (!data.code) throw new Error("The server did not return a referral code.");

    referral = data;
    codeElement.textContent = data.code;
    issuedTo.textContent = `Issued to: ${data.fullName || fullName}`;
    codeElement.classList.remove("loading");
    const date = new Date(data.createdAt);
    createdAtElement.textContent = `Issued: ${Number.isNaN(date.getTime()) ? "Today" : date.toLocaleString()}`;
    // Show the code instantly; PNG generation is a separate background UI task.
    passDetails.classList.remove("hidden");
    referralActions.classList.remove("hidden");
    referralForm.classList.add("hidden");
    downloadButton.disabled = false;
    copyButton.disabled = false;
    downloadButton.textContent = isAppleMobile ? "Share / Save PNG on iPhone" : "↓ Download PNG pass";
    statusElement.textContent = `Your referral code is ready: ${data.code}. You can now save your PNG pass.`;

    // Pre-render a single PNG while the visitor reads the code. This avoids
    // blocking the iPhone Share button while its tap permission is active.
    setTimeout(() => {
      if (referral?.code !== data.code) return;
      try { preparePassImage(); }
      catch (error) { console.warn("PNG preparation delayed:", error); }
    }, 0);
  } catch (error) {
    statusElement.textContent = error?.name === "AbortError"
      ? "Connection timed out. Please try again using the same browser; if the code was already issued, it will be returned to you."
      : (error.message || "Could not connect. Check your connection and try again.");
  } finally {
    clearTimeout(slowNotice);
    clearTimeout(timeout);
    submitting = false;
    setBusy(false);
  }
}

function createPassCanvas() {
  if (!referral?.code) throw new Error("Please generate a referral code first.");
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

    // Draw the same official uploaded logo, already present in the page.
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


    return canvas;
}

function preparePassImage() {
  if (!referral?.code) throw new Error("Create a referral code first.");
  if (preparedPass?.code === referral.code) return preparedPass;
  const canvas = createPassCanvas();
  const imageData = canvas.toDataURL("image/png");
  if (!imageData.startsWith("data:image/png;base64,")) throw new Error("Cannot prepare the PNG in this browser.");
  const safeCode = String(referral.code).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  const fileName = `Helen-and-Sons-Referral-${safeCode}.png`;
  // Convert the PNG into a real File. iOS Safari handles file-sharing more
  // reliably than a synthetic <a download> pointing to a data: URI.
  const binary = atob(imageData.substring(imageData.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], fileName, { type: "image/png" });
  if (preparedPass?.url) URL.revokeObjectURL(preparedPass.url);
  preparedPass = { code: referral.code, url: URL.createObjectURL(file), file, fileName };
  return preparedPass;
}

function showSaveImageFallback(pass) {
  let help = document.querySelector("#hns-save-image-help");
  if (!help) {
    help = document.createElement("section");
    help.id = "hns-save-image-help";
    help.setAttribute("aria-label", "Save your personal referral pass image");
    help.className = "pass-save-help";
    const description = document.createElement("p");
    description.className = "pass-save-instructions";
    description.textContent = isAppleMobile
      ? "On iPhone, tap Share / Save PNG and choose Save Image in the share sheet. Or tap Open full-size PNG, then touch and hold the image and choose Save to Photos."
      : "Your PNG is ready. If the download is blocked, tap Open full-size PNG to save the image manually.";
    const links = document.createElement("div");
    links.className = "pass-save-links";
    const saveLink = document.createElement("a");
    saveLink.id = "hns-manual-png-link";
    saveLink.className = "button button-gold";
    saveLink.textContent = "↓ Download PNG";
    const openLink = document.createElement("a");
    openLink.id = "hns-open-png-link";
    openLink.className = "button button-white";
    openLink.textContent = "Open full-size PNG ↗";
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    const preview = document.createElement("img");
    preview.id = "hns-pass-image-preview";
    preview.alt = "Your personal Helen and Sons referral PNG. On iPhone, touch and hold to save to Photos.";
    preview.loading = "eager";
    links.append(saveLink, openLink);
    help.append(description, links, preview);
    (referralActions || passDetails || document.body).insertAdjacentElement("afterend", help);
  }
  const saveLink = help.querySelector("#hns-manual-png-link");
  const openLink = help.querySelector("#hns-open-png-link");
  const preview = help.querySelector("#hns-pass-image-preview");
  saveLink.href = pass.url;
  saveLink.download = pass.fileName;
  openLink.href = pass.url;
  preview.src = pass.url;
  help.hidden = false;
  if (isAppleMobile) saveLink.textContent = "↓ Save to Files";
}

// The Share call MUST occur directly inside the button-tap callback. Avoid
// await or toBlob() before navigator.share(), which can lose user activation.
function downloadCard(event) {
  if (event) event.preventDefault();
  if (!referral?.code) {
    statusElement.textContent = "Generate your referral code first.";
    return;
  }
  try {
    const pass = preparePassImage();
    let canShareFile = false;
    if (isAppleMobile && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
      try { canShareFile = navigator.canShare({ files: [pass.file] }); }
      catch { canShareFile = false; }
    }
    if (canShareFile) {
      // Native iOS share sheet allows Save Image, AirDrop, WhatsApp and Files.
      // An unexpected Safari exception must not hide the manual-save fallback.
      try {
        const shareAttempt = navigator.share({ files: [pass.file], title: "Helen & Sons referral pass" });
        Promise.resolve(shareAttempt).then(() => {
          statusElement.textContent = `Your code ${referral.code} is ready. The image was shared; choose Save Image to keep it in Photos.`;
        }).catch(error => {
          if (error?.name !== "AbortError") {
            statusElement.textContent = "Share was not available. Use Open full-size PNG below, then touch and hold the image to save it.";
          }
        });
        showSaveImageFallback(pass);
        return;
      } catch (error) {
        console.warn("Share unavailable; manual image save enabled.", error);
      }
    }

    if (!isAppleMobile) {
      const link = document.createElement("a");
      link.href = pass.url;
      link.download = pass.fileName;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      statusElement.textContent = `PNG download started. Your referral code: ${referral.code}`;
    } else {
      statusElement.textContent = `Your code is ${referral.code}. Tap Open full-size PNG below, then touch and hold it and select Save to Photos.`;
    }
    showSaveImageFallback(pass);
  } catch (error) {
    statusElement.textContent = `Image could not be prepared: ${error.message || "Please try again."} Your referral code is still shown above.`;
    console.error("Referral PNG error:", error);
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

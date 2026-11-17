# CARD TO DEAL — Your Manual Code + Ollama Vision Combined

## Active files

- `docs/admin.js` = latest Ollama Vision + your manually edited mobile OCR / camera code.
- `docs/admin.html` = latest CARD TO DEAL UI + your torch control and phone scanning guidance.
- **Deploy these two files to GitHub `docs/`**. The ZIP itself is not a file to upload into `docs/`.

## Manual changes integrated (active)

1. `isMobileLeadDevice()` detection using narrow screens and coarse pointers.
2. `autoTrimCardCanvas()` card foreground detection and `prepareLeadScanCanvas()` for mobile.
3. Mobile higher-resolution image loading at up to 4,000px; 3,400px OCR preparation and 2,800px minimum upscale target as in the manual code.
4. Natural, contrast, numeric/email and mobile sharpening OCR, with four reads on mobile.
5. Original `mergeCardOcrResults()` phone/email ranking and editable contact-field auto-fill retained from your manual code.
6. Higher-quality mobile live-camera capture (ideal 4032x3024), plus a fallback for devices rejecting camera constraints.
7. Torch / Light on-off control when the mobile camera supports it.
8. Original phone photography instructions accessible in the compact mobile page.

## Newer features preserved (not replaced with the older login/source)

- Username + password login, signed session (not a public browser ADMIN_TOKEN form).
- CARD TO DEAL mobile dashboard, per-event navigation, three data tabs.
- QR, Card Details and Scan Card per-person statuses and status filtering/export.
- Business Card Scanner open / hide toggle; edit reopens scanner automatically.
- Camera/photo upload, Crop & scan, Rotate, Deep scan, Tesseract OCR.
- Opt-in Ollama Vision card recognition, review & apply selected fields.
- Client Note (mic or manual typing), Ollama service reply, client WhatsApp/email, image share fallback.
- CSV/Excel/PDF import/export and pre-existing Cloudflare Worker / D1 routes.

## Why the manual files were merged, not blindly pasted

The two supplied files represent an older full dashboard copy with `ADMIN_TOKEN` form and older WhatsApp/email flow. Copying them wholesale over the latest pages would remove username/password login, statuses, Client Note, scanner toggle, and Ollama Vision. We retained the user-authored features missing from the latest source, and preserved the complete supplied originals under `USER_MANUAL_CODE_ORIGINALS/` in this full project ZIP. Those originals are for reference only and **must not be uploaded to GitHub**.

## Deployment

1. Download GitHub update ZIP and **extract** it.
2. Replace the matching `docs/admin.html` and `docs/admin.js` files in your GitHub repository and commit.
3. The existing Ollama Vision Worker does **not** require a new deploy for these HTML/JS-only changes. If Ollama Vision Worker has not been deployed yet, follow the existing `OLLAMA_VISION_SETUP.md` in the full project before trying AI scan.
4. Wait for GitHub Pages publish, hard refresh / open in private tab; check `CARD TO DEAL`, username/password login, open scanner, light, OCR, Vision and statuses.
5. Do not delete Cloudflare D1 data. Do not store `OLLAMA_API_KEY` in GitHub.

## Tests performed

- Node JavaScript syntax: PASS.
- Chromium mocked frontend at 390px mobile width: login, scanner open/close, torch, four OCR passes, contact field fill, Ollama Vision button availability, status controls, no horizontal overflow: PASS.
- HTML structure and ZIP integrity: PASS.
- **NOT** tested: actual phone hardware camera, real Ollama account/model access, production Cloudflare or live GitHub Pages.

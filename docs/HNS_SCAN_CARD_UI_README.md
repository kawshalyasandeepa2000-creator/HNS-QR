# HNS QR — Scan Card UI update (HTML-only)

Source: user's HNS-QR-main (2).zip, with prior Overview fixes and Cloudflare-connected frontend preserved.

## Quick GitHub update

Replace ONLY `docs/admin.html` in the GitHub repository with the included `docs/admin.html`. Keep the name `admin.html`; do not upload the ZIP directly to GitHub Pages. The existing `admin.js`, `hns-admin-official.css`, `hns-events.css`, `config.js`, Cloudflare Worker, and Cloudflare D1 continue as before. Refresh with Ctrl+Shift+R.

## Changes

- Refreshed the Scan Card panel (capture buttons, photo preview, image tools, voice notes, contact form, responsive layout).
- Added a visible 'Upload / attach image' path that reuses the existing OCR photo picker.
- Added 'Send image' (native mobile sharing when supported, otherwise downloads the card photo for manual attachment) and 'Save photo'.
- Kept camera, crop, OCR, WhatsApp/email, D1 contact saves, and import/export IDs unchanged.
- Image is NOT uploaded to Cloudflare or stored with the D1 contact; permanent storage requires private Cloudflare R2 and Worker integration.

## Important

The `admin.html` file depends on the rest of your existing GitHub Pages `docs/` project, such as external CSS, JavaScript, and images. It is NOT a self-contained offline admin application. This change does not modify Cloudflare D1 or credentials.

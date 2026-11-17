# CARD TO DEAL — Mobile UI & Client Note update

## What changed (2026-11-17)
- Admin header now reads **CARD TO DEAL** (removed official campaign portal / referral dashboard).
- Voice Note renamed **Client Note**. Both Speak note and Type note use the same field.
- Existing **Generate AI reply** sends the reviewed note (typed OR transcribed) to the same protected Cloudflare Ollama draft endpoint, using the existing consent checkbox. It does not send card images, phone numbers or email addresses to AI.
- Cleaner mobile UI: compact scan controls, single-column fields, collapsible OCR image rescue and AI help, reduced repeated helper text, and accessible tap targets.
- Client WhatsApp and email remain auto-filled from the scanned/edited Contact Details fields, and both open unsent drafts for review.
- Existing D1, Cloudflare Worker, Ollama Secret, knowledge base, business-card save/scan and other APIs are NOT changed.

## GitHub deployment
1. Download `HNS_CARD_TO_DEAL_GITHUB_UPDATE.zip` and extract.
2. In your GitHub Pages repo's existing `docs/` folder, replace **admin.html** and **admin.js** only.
3. Commit and ensure GitHub Pages deployment completes, then hard refresh the admin page.
4. Test: open Scan Card; type a 10+ char Client Note; tick consent; Generate AI reply; verify editable draft; verify client recipient before sending.
5. If needed, restore both previous files together from repository history.

## Notes
- The newly added Type note button focuses the existing editable Client Note; no new data storage or backend changes are needed.
- AI generation requires the previously deployed Ollama-compatible Cloudflare Worker and a valid Secret/model; a visible button is not proof that the external API is working.
- Browser speech-to-text support varies; manual typing always remains available.
- WhatsApp/email opens an unsent draft in the app/account currently active on the device; sending is manual.
- No customer data, passwords or API keys included.

# CARD TO DEAL — CONTACT STATUS UPDATE (17 November 2026)

## What's new
QR Referral Scan, Card Details (CSV References), and Scan Card (saved business-card leads) now each have a status dropdown on EVERY visible record:
- Follow up started
- QTN Send
- Won
- Lost

A blank "Set status" is used for older records until a staff member assigns a real status. Each tab has an All statuses / Not set / four status filters. Search still works. Filtered CSV exports (and the matching PDF / Excel export buttons) include the Status column. The full CSV/Excel includes all contacts of that selected event (not only the latest rows displayed on-screen).

## Why Cloudflare Worker update is required
Statuses are stored in an ADDITIVE D1 table named hns_contact_statuses; this does NOT alter, truncate, or delete data in referrals, csv_reference_contacts or business_card_leads. The admin-only API creates the status table on first request. No separate SQL migration is required for this release. It uses your existing DB binding and ADMIN_TOKEN; do not add a new database, reset existing tables, or change your Ollama / SMTP secrets.

## Safe deployment order (important)
1. Open Cloudflare D1 qr-referral-d1 and check Time Travel recovery is available; keep the recovery bookmark. A Time Travel bookmark is not an offline backup.
2. Cloudflare Workers & Pages → qr-referral-api → Edit Code. Save a private copy of the EXISTING live Worker source before touching it. If your live Worker has changes newer than the source that was shared in the chat, STOP and merge them before replacing it.
3. Paste CLOUDFLARE_WORKER_PASTE_THIS.js, then Deploy. Existing DB binding, ADMIN_TOKEN, SMTP, OLLAMA_API_KEY and HNS_KNOWLEDGE_BASE settings remain unchanged.
4. Check Worker /api/health, then sign in to CARD TO DEAL. The status section should say "Status saves to Cloudflare D1 when changed". If not, DO NOT try to save statuses yet.
5. Only after Worker is correct, upload the SIX files in GITHUB_STATUS_UPDATE_FILES.zip to the existing GitHub Pages docs/ folder, replacing existing matching files. Do NOT upload the nested ZIP itself and do NOT create docs/docs/.
6. After GitHub Pages deploy, refresh hard, open each tab and test one status; refresh and ensure it stays. Filter by "Won" or another status. Test CSV export with and without a filter.

## What changed / preserved
- ADDED: docs/hns-contact-status.js, docs/hns-contact-status.css.
- UPDATED: docs/admin.html, docs/admin.js, docs/hns-references.js, docs/hns-leads-import.js.
- UPDATED: Cloudflare Worker (same full source at CLOUDFLARE_WORKER_PASTE_THIS.js, cloudflare-worker/worker.js, worker/src/index.js).
- UNCHANGED: QR registration code generation, existing D1 contacts, SMTP email code, Ollama AI endpoint, scanner OCR, Client Note, WhatsApp/email draft flow, and original page branding.

## Additional notes
Statuses are separate for each contact AND each event. Only a logged-in admin can read/save them. A wrong-event contact ID is rejected server-side. Clearing the dropdown back to Set status removes only its status record, never the contact itself. The frontend intentionally disables status dropdowns if the Worker status endpoint is not available. No status is guessed from other fields.

## Testing performed
- JS syntax checks (Node 22) on modified frontend and Worker sources: passed.
- Worker admin-only status API unit simulation: allowed values, auth guard, existing-ID check, wrong-event rejection, save/read/clear: passed.
- SQLite in-memory tests of new status table and filtered export LEFT JOIN queries: passed.
- Production Cloudflare/D1/WhatsApp/Ollama: NOT directly accessed or verified. Full Chromium page navigation was restricted in this environment; screenshots are NOT evidence of live UI success.

## Security
Previously a screenshot exposed SMTP_PASSWORD as plaintext. Rotate that mailbox password and use Cloudflare Secret, not plaintext Variable. Never share SMTP, Ollama, or ADMIN_TOKEN credentials.

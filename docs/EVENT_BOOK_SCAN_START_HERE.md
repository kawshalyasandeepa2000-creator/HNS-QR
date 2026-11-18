# CARD TO DEAL — Event Book Scan Update

Base: the user's uploaded `HNS-QR-main(1).zip` (November 18, 2026). Original files are retained; this update is additive and the scanner interface is shared, not copied or replaced.

## New feature
- Fourth dashboard shortcut and sidebar: **Event Book Scan** (`#event-book`).
- When selected, the original Scan Card workspace runs in **Event Book mode**. All original camera, photo upload, crop, rotate, torch, local multi-pass OCR, optional Ollama Vision scan, Client Note, WhatsApp/email draft, save/edit/delete, status dropdown/filter, Excel/CSV import, Excel/CSV export and browser Print/Save-as-PDF export controls remain present.
- Book contacts are **not stored in Scan Card**: separate admin-only `/api/admin/event-book` endpoint and new D1 table `hns_event_book_contacts`. Separate `hns_event_book_statuses` table avoids changing existing `hns_contact_statuses` CHECK constraints.
- Event selection still scopes both record sets. Book count appears independently on overview; the existing three counts are unchanged.
- One contact/entry at a time: crop one row from the event-book page. Ollama Vision prompt for Event Book extracts only one legible entry at a time and requires explicit image consent. It does NOT batch-import a multi-person photo or a PDF document.

## IMPORTANT — deployment order
1. Back up your current Cloudflare Worker code. Leave your live D1 database untouched; optionally export a D1 backup / use D1 Time Travel.
2. Cloudflare > Workers & Pages > `qr-referral-api` > Edit Code. Replace the deployed Worker JavaScript with `cloudflare-worker/worker.js` from the FULL project, or the separate `HNS_CARD_TO_DEAL_EVENT_BOOK_WORKER.js` provided alongside this ZIP. Deploy. Both `CLOUDFLARE_WORKER_PASTE_THIS.js` copies inside this project match the same updated Worker code.
3. Existing Worker bindings/secrets stay as they are: `DB`, `ADMIN_TOKEN`, `ADMIN_LOGIN_USERNAME`, `ADMIN_LOGIN_PASSWORD`, `OLLAMA_API_KEY`, `SITE_ORIGIN`, `CAMPAIGN_SLUG`, and any SMTP secrets. No new API key required.
4. Back up your GitHub repository. Under the **existing `docs/` directory** in GitHub, replace exactly these five files from the GitHub update ZIP: `admin.html`, `admin.js`, `hns-contact-status.js`, `hns-leads-import.js`, `hns-events.css`. If using the root `admin.html` entry, update that root file too; it redirects to `docs/admin.html` to avoid loading the obsolete UI.
5. Commit to GitHub. If the site uses GitHub Pages from `/docs`, do not upload the *ZIP archive as a file*: extract it and preserve folders. Reload in a private tab to avoid old cached JS/CSS.
6. Log in with your existing username/password. Confirm FOUR dashboard cards: Scan Card, Event Book Scan, Card Details, QR Referral Scan. New Event Book contacts start at 0.
7. Open Event Book Scan, open scanner, take a photo or select an image, crop **one registration entry**, review and save. Check that the new contact appears in Event Book but NOT Scan Card. Test status, search, CSV/Excel export, browser Print to PDF, and import.

## Storage / safety
- Worker automatically creates `hns_event_book_contacts` and `hns_event_book_statuses` on the first authorized access. No manual SQL or destructive migrations.
- Existing `referrals`, `csv_reference_contacts`, `business_card_leads`, and `hns_contact_statuses` are NOT altered by this update. Old records remain as they were.
- Default local OCR processes photos in the browser. If you give consent and click Ollama Vision, the selected image is sent to Ollama Cloud; no card photo is stored in D1. The AI card/book suggestion needs manual approval.
- No passwords or API keys are included in the ZIP.
- The existing Scan Card import covers `.csv`, `.xlsx`, `.xls` spreadsheets, and image upload covers mobile photos. The existing PDF feature is **export via browser print/Save as PDF**, not import of a PDF document. This update preserves the existing behavior.

## Testing scope
- JavaScript syntax checks and static file/ZIP integrity checks.
- Local authenticated Worker mock with SQLite: Event Book create, list, edit, delete; no writes to original Scan Card; wrong event rejected; unauthenticated rejected; own status saves and filtered CSV export; invalid status ID blocked.
- Desktop and mobile viewport browser mock at 1440/390/320 px: login, all FOUR overview cards, mode navigation, distinct saved lists, edit auto-open, presence of original scanner/Ollama/import/export/status tools, no page-level overflow or JavaScript errors. The browser test stubs external network/API responses.
- **Not** tested against your live Cloudflare Worker, real D1, actual Ollama account, or a physical phone camera. Verify after deploying.

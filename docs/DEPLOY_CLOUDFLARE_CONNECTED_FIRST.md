# HNS QR — Cloudflare D1 compatibility package (RISE 17 only)

Based on `HNS-QR-main (2).zip` plus the subsequent Overview CSS/reference fixes. **No New Event feature** is enabled. Live Cloudflare D1 is NOT included, accessed or modified by generating this ZIP.

## Existing connections
- `docs/config.js`: `https://qr-referral-api.kawshalyasandeepa2000.workers.dev`, campaign `outdoor-2026`
- `referrals`: visitor registrations / issued codes
- `csv_reference_contacts`: Card Details imported references
- `business_card_leads`: Scan Cards contact records
- Browser requests must send the admin token; never store it in the repo.

## What was changed
- Restored the verified Overview CSS and References script from the latest UI fix; unchanged.
- Updated `cloudflare-worker/worker.js`, `worker/src/index.js` and the root `CLOUDFLARE_WORKER_PASTE_THIS.js` to the same compatibility Worker based on the actual Worker code the owner shared.
- Event management remains **off**: existing RISE 17 campaign only; the Worker does not depend on the `events` D1 table.
- Existing company SMTP functions retained. This does **not** solve the separate Cloudflare SMTP connectivity issue.
- QR submissions use `registration_source='qr'` *when that column exists*. Older rows are never automatically relabelled QR. If the column is not present, the Worker supports legacy inserts and displays older rows as source-unverified.
- Dashboard's QR CSV and PDF export now request `source=qr` and do not export legacy rows as QR registrations. Full history export remains available at the Worker API without this flag (admin-authenticated).

## SAFE ORDER — no CLI or Wrangler required
1. Save current Cloudflare Worker code in a local `.js` backup, record D1 Time Travel Bookmark ID and preferably export a separate full database backup when available. **Do not click Restore Database.**
2. Cloudflare `qr-referral-d1` > Console: execute the READ-ONLY statements in `D1_SAFE_CHECKS.sql` separately. Check database tables/columns and note counts; do not share customer rows or access tokens.
3. (Optional, for QR classification) If `PRAGMA table_info(referrals)` does NOT show `registration_source`, run this command ONCE: `ALTER TABLE referrals ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'legacy';`. If present, SKIP. Old customers remain `legacy`, not proof of actual QR scans.
4. Cloudflare > Workers & Pages > existing `qr-referral-api` Worker > Edit Code. Back up editor code. Paste **the entire** `CLOUDFLARE_WORKER_PASTE_THIS.js`, check the `DB` binding, `CAMPAIGN_SLUG=outdoor-2026`, `SITE_ORIGIN`, `ADMIN_TOKEN`, `VISITOR_SECRET`, and existing SMTP environment secrets **without changing them**, then Deploy. The code has not been live-deployed or live-tested.
5. GitHub Pages site: update `docs/admin.html` and `docs/admin.js` from the ZIP. Other `docs` files remain as in the last UI fix. Refresh with Ctrl+Shift+R.
6. Sign in and test RISE 17 counts, References/Card Details, Scanner/Scan Cards save + refresh, QR source-tagging using a new test registration (be mindful of real customer data), QR-only export, public activity, original customer referral code flow. Avoid deleting real customer rows while testing.

## Critical checks
- The correct Cloudflare Worker must already have D1 binding named `DB` to the live `qr-referral-d1` database. GitHub upload alone does NOT deploy the Worker.
- Restoring an older D1 snapshot overwrites newer data; a Time Travel bookmark is not an independent data backup.
- If the Worker errors after deployment, rollback to the saved previous Worker code; don't run schema resets or destructive SQL.
- QR link source is a client-supplied attribution tag, **not cryptographic proof** that a real physical QR code was scanned.
- Never upload `.env`, personal contacts, SMTP password, ADMIN_TOKEN or VISITOR_SECRET into GitHub.

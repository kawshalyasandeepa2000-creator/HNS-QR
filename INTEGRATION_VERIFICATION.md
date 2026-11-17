# Integration verification (local only)

- Tested patched Worker in a Node.js in-memory SQLite D1 adapter against existing `referrals`, `csv_reference_contacts` and `business_card_leads` tables.
- 4/4 integration checks passed: existing records (with/without registration_source column), creation of QR referral, QR-only export excludes legacy and full export retains all, only default RIZE 17 campaign permitted.
- JavaScript syntax check passed for six frontend/Worker source files. ZIP integrity check passed.
- Existing repository test scripts requiring unavailable Cloudflare module/test setup were not run successfully in plain Node; this does not validate actual Cloudflare deployment.
- No live Cloudflare API, production D1 database, SMTP or website browser session accessed for these tests.
- 2026-11-16.

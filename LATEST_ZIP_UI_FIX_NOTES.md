# UI fix — source: HNS-QR-main (2).zip

## Changes in this revision
- Replaced corrupt `docs/hns-events.css` (which incorrectly contained a copy of `admin.js`) with real responsive CSS and improved the Overview shortcut cards.
- Restored `docs/hns-references.js` from the previously checked standalone reference module because the uploaded version duplicated `admin.js`. Existing reference import/export handlers are retained.
- Preserved the uploaded newest `docs/admin.js` file, including scanner, voice input, event-scoped URLs and data counters.
- Temporarily hid New Event creation and its event switcher, by request; displays static RISE 17 current-event badge. No new event support added/changed.
- No Cloudflare Worker, D1 SQL, SMTP settings, secrets or data were changed.

## To upload to existing GitHub Pages docs folder
Upload the files from `GITHUB_DOCS_UI_FIX_ONLY.zip` (or from this project's `docs/`) to the repo's existing `docs/` directory.
Only 3 site files were changed: `admin.html`, `hns-events.css`, `hns-references.js`.
Do not create `docs/docs/`. Refresh website with Ctrl+Shift+R after deployment.

## Caution
The full source ZIP includes older Worker sample files supplied by the user. This revision does not update or validate live Cloudflare Worker code. Do not replace the deployed Worker with these older copies. Actual production D1 data is not inside this project ZIP.

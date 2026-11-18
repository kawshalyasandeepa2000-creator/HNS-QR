# CARD TO DEAL — MULTI-EVENT DASHBOARD (18 November 2026)

## What is new
- **+ New Event**: admins can create SUMMIT 18, EXPO 19, etc.
- **Event dropdown**: switch between previous and new event dashboards at any time.
- **Event-specific data**: QR registrations, Card Details, Scan Card, Event Book Scan and pipeline statuses use the selected event slug.
- **Event-specific names**: dashboard header badge, event label, scanner form, reference import prefix, QR flyer, customer referral page, QR download and customer pass label update appropriately.
- **Persistence**: event names and slugs are kept in the existing Cloudflare D1 database in the new `hns_campaign_events` table. Existing `referrals`, `csv_reference_contacts`, `business_card_leads`, `hns_event_book_contacts` and status records are NOT migrated, overwritten or deleted.
- **Legacy event**: original `outdoor-2026` always remains `RISE 17 - 2026` and can be selected again.
- All previous camera/OCR/torch/Ollama Vision/Client Note/username-password login/Excel/CSV/PDF/status features are preserved.

## IMPORTANT: Deployment order (no database reset)
1. **BACK UP** your live Cloudflare Worker code. Enable/check **D1 Time Travel** and make a database backup before changing production code.
2. **CLOUDFLARE FIRST**: Workers & Pages -> `qr-referral-api` -> Edit Code. Replace the existing Worker JS with `HNS_CARD_TO_DEAL_MULTI_EVENT_WORKER.js` (or `CLOUDFLARE_WORKER_PASTE_THIS.js` inside the full project). Deploy.
   - Keep existing Worker settings: `CAMPAIGN_SLUG=outdoor-2026`, SITE_ORIGIN, D1 `DB` binding, ADMIN_TOKEN, ADMIN_LOGIN_USERNAME, ADMIN_LOGIN_PASSWORD, VISITOR_SECRET and OLLAMA_API_KEY. Do not delete or change those secrets.
   - Existing D1 tables are untouched. First GET/POST of `/api/admin/events` automatically creates and populates `hns_campaign_events` with the original event.
3. **GITHUB SECOND**: Extract `HNS_CARD_TO_DEAL_MULTI_EVENT_GITHUB_UPDATE.zip` and commit its files into the matching repository paths (`docs/admin.html`, `docs/admin.js`, `docs/hns-events.css`, `docs/hns-leads-import.js`, `docs/index.html`, `docs/app.js`, and root `admin.html`). Keep other existing files.
   - If GitHub Pages publishing source is `docs/`, don't upload everything into another nested `docs/docs` folder.
4. Allow GitHub Pages to publish. Hard refresh the dashboard (Ctrl+Shift+R; on phone use a private browser tab if cached). Sign in with the EXISTING username/password.
5. From top bar select **+ New Event**, enter e.g. `SUMMIT 18`, then **Create event**. It becomes the selected event, with an empty dashboard.
6. From top **Event** dropdown select `RISE 17 - 2026` to see old contacts; select `SUMMIT 18` again to see only SUMMIT 18 contacts.
7. In the selected event, open Show QR flyer or View live website. Its event-specific URL is like `...?event=summit-18&source=qr`. DO NOT reuse the old event QR for the new event.

## What gets stored / event separation
- New table `hns_campaign_events`: slug, event display name, creation time.
- QR contacts remain in `referrals` and are filtered by `campaign_slug`.
- Card Details remain in `csv_reference_contacts` and are filtered by `campaign_slug`.
- Scan Card remains in `business_card_leads`, filtered by `campaign_slug`.
- Event Book Scan remains in `hns_event_book_contacts`, filtered by `campaign_slug`.
- Pipeline statuses are already event-scoped in the existing status tables.
- New events start EMPTY; **existing RISE 17 records are never copied into new events**. Existing records always remain under `outdoor-2026`.

## Optional read-only Cloudflare D1 verification
```sql
SELECT slug, name, created_at FROM hns_campaign_events ORDER BY created_at;
SELECT campaign_slug, COUNT(*) AS total FROM referrals GROUP BY campaign_slug;
SELECT campaign_slug, COUNT(*) AS total FROM business_card_leads GROUP BY campaign_slug;
SELECT campaign_slug, COUNT(*) AS total FROM csv_reference_contacts GROUP BY campaign_slug;
SELECT campaign_slug, COUNT(*) AS total FROM hns_event_book_contacts GROUP BY campaign_slug;
```
(The final query requires Event Book table to have been initialized.)

## Troubleshooting
- `+ New Event` shows 'Deploy the updated Worker': the Cloudflare Worker was not updated, or `/api/admin/events` is returning an error. Deploy Worker before GitHub.
- Wrong event name/header: upload BOTH `admin.js` and `admin.html` plus `hns-events.css`; hard refresh.
- New event has 0 contacts: this is correct. Import or scan contacts while SUMMIT 18 is selected. Old contacts stay in RISE 17.
- Login failures: check Cloudflare ADMIN_LOGIN_USERNAME and ADMIN_LOGIN_PASSWORD Secrets. Do NOT share passwords or tokens in chat or screenshots.
- New QR isn't registering: open the new event's specific QR link and verify the Worker was deployed. Unknown events fail closed instead of writing into old RISE 17 data.
- The original site root `admin.html` redirects to `docs/admin.html` so the old dashboard cannot accidentally appear.

## Test scope
- A local Node.js SQLite-backed Worker harness passed: admin session, event create/list, event duplicates, legacy preserved, public event lookup and QR registration, event-scoped stats, Event Book and Scan Card separation, per-event statuses, unknown-event rejection.
- Real browser UI tests ran with mocked API using 1440px desktop, 390px phone and 320px phone: new event form, create/switch, header name, counts, QR flyer, scanner event field, and no horizontal overflow or JS errors (test harness uses inlined local assets because external navigation is restricted).
- **Live Cloudflare deployment / actual D1 / mobile camera / Ollama Cloud were NOT tested.**

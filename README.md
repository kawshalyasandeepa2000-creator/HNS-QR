# Outdoor QR Referral Campaign — Complete JavaScript Website

One printed QR code, many visitors, unique downloadable referral codes, and an admin SQL/CSV export.

## What happens

1. The organizer prints the QR from `/admin` onto all campaign flyers.
2. A customer scans with their phone camera, opening `https://yourdomain.com/c/outdoor-2026`.
3. The browser calls `POST /api/referrals` automatically; no form or signup needed.
4. The server generates a cryptographically random code such as `REF-A08DF93C5E27B426` and saves it in a **SQLite SQL database**.
5. The visitor can **Download code as PNG** or **Copy code**.
6. The organizer logs into `/admin` to see the latest 100 codes or export **all** codes to a CSV file that opens in Excel/Google Sheets.

**Important:** The QR is **the same for everyone**. The code is unique per *browser cookie*, not a verified human identity. Reopening the page from the same browser yields the same code; different phones/browser profiles get different codes. Clearing cookies, private browsing, or another browser may issue a new code. A strict one-per-person policy requires customer signup plus verified phone OTP/account login (not included). Generating a code does not authenticate the customer or prove their identity.

## Requirements

- Node.js 22+ (Node 24 LTS is also suitable)
- npm
- A computer for local setup
- For printing a campaign QR usable by everyone: a publicly reachable HTTPS domain and Node.js hosting with **persistent disk** storage for `data/referrals.sqlite`

## Step-by-step local installation

```bash
# 1. Unzip the project and enter its directory.
cd qr-referral-campaign

# 2. Install Node dependencies.
npm install

# 3. Create .env, random admin password, and cookie signing secret.
npm run setup

# 4. Start the server.
npm start
```

Open **http://localhost:3000/c/outdoor-2026** to see the customer page.
Open **http://localhost:3000/admin** to see the admin dashboard. When the browser asks for credentials, use username `admin` and the password printed by `npm run setup`. If you forgot it, inspect `ADMIN_PASSWORD` inside your local `.env` file; **do not share it**.

Starting the server creates `data/referrals.sqlite` automatically. Scan from a different browser/profile to see another code. Localhost can only be reached from the same computer, so do **not** print its QR for customers.

## Step-by-step public launch

1. Get a domain, e.g. `campaign.example.com`.
2. Deploy this Node.js application to a VPS or hosting service that runs persistent Node processes and provides persistent storage. Examples: a VPS with Nginx + Node, or a platform offering a persistent volume. **Do not deploy SQLite to an ephemeral filesystem or deploy multiple independent replicas writing different SQLite files.** For multi-server scale, migrate to a hosted SQL service (PostgreSQL/MySQL) with centralized credentials/identity.
3. Set environment variables from `.env` on the server, especially:

   ```env
   NODE_ENV=production
   APP_BASE_URL=https://campaign.example.com
   CAMPAIGN_SLUG=outdoor-2026
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a-strong-random-password>
   COOKIE_SECRET=<at-least-32-random-characters>
   DB_PATH=./data/referrals.sqlite
   ```

4. Make your domain point to the server, configure HTTPS, forward traffic to Node on `PORT=3000` through your reverse proxy, and ensure the SQLite `data/` directory is writable and permanently stored. Do not expose that directory over the web. Do not commit `.env` to Git.
5. Restart your server after setting `APP_BASE_URL`, then visit `https://campaign.example.com/admin`.
6. Print the flyer via **Print flyer**, or choose **Download QR PNG** if you want to place it in your own leaflet design. Confirm the QR contains your **HTTPS live domain**, not `localhost`.
7. Test with **two different phones**. Both should receive different codes. On refreshing the same phone/browser, its code should stay the same.
8. Download the **Export all codes (CSV)** file and check the records in Excel.

**If you change `APP_BASE_URL` or `CAMPAIGN_SLUG` after printing, old printed QR links will not update.** Finalize the live URL before printing. Keep the same campaign and domain accessible for the campaign duration.

## URLs and functionality

| URL | Action | Access |
|---|---|---|
| `/c/outdoor-2026` | QR destination / customer referral page | Public |
| `/api/referrals` | Creates/returns code, JSON POST | Public, same-origin |
| `/admin` | Dashboard with flyer, print and download | Admin password |
| `/admin/qr.png` | High-resolution print QR | Admin password |
| `/api/admin/stats` | Count and latest 100 codes | Admin password |
| `/api/admin/export.csv` | Complete CSV list | Admin password |

### SQL data

SQLite is a real SQL database, **not a spreadsheet**. The generated file is at `data/referrals.sqlite`. It includes a `referrals` table with these columns:

| Column | Description |
|---|---|
| `id` | Sequential internal record ID |
| `campaign_slug` | Campaign whose QR was scanned |
| `code` | Unique referral code |
| `visitor_hash` | Pseudonymous hash, not personal name or phone |
| `created_at` | ISO UTC timestamp when code was created |

You can inspect the database using DB Browser for SQLite or command-line SQLite:

```sql
SELECT id, code, campaign_slug, created_at
FROM referrals
ORDER BY id DESC;
```

Export **all** codes via the dashboard to CSV (compatible with Excel). Use the CSV download instead of granting the public direct access to the SQL database.

## Test the project

```bash
npm test
```

The test automatically launches a disposable server and database; it checks different visitors get different codes, returning visitors get the same code, admin authentication, QR image format, and CSV export.

## Structure

```text
qr-referral-campaign/
  .env.example         # editable configuration template (no secrets)
  .gitignore           # excludes secrets and DB
  package.json         # dependencies, scripts
  server.js            # Express API, SQLite, QR image generation, admin access
  public/
    index.html         # customer referral page
    app.js             # auto-claim, copy and PNG download
    admin.js           # admin stats table
    style.css          # responsive customer/admin/print styles
  private/
    admin.html          # password-protected admin page
  scripts/
    setup.js           # generate secure local credentials
  sql/
    schema.sql         # SQLite database table
  data/
    .gitkeep           # runtime DB lives here (excluded from zip)
  tests/
    app.test.js         # integration checks
```

## Deployment/security notes

- Run your public site on **HTTPS** so visitor cookies and admin Basic authentication are encrypted in transit.
- Change `ADMIN_PASSWORD` to a unique strong password. Protect `/admin` behind a VPN/SSO if you have large-scale campaigns; Basic authentication is a small-project starter, not an enterprise admin system.
- The per-IP limiter is deliberately high for venues where many people share one Wi-Fi IP; it is **not** fraud prevention.
- Use a persistent disk and back up the database, including WAL/SHM files via SQLite's backup API or during a coordinated stop. Running against a non-persistent disk loses referrals on restarts.
- The QR image simply contains a website URL; the unique referral code is allocated by the backend **when the page loads**, not embedded in the printed QR image.
- A camera QR preview, antivirus link check, or manually opened URL is not necessarily a confirmed customer. The app does not collect names or verify referrals, purchases, or payouts. Add a redemption/attribution system before paying referral commissions.
- The frontend automatically calls the API once when opened. If cookies are disabled, a returning visitor might get a new code. Users must keep the code they've downloaded.
- A single SQLite database is appropriate for small/medium events on one Node server; for very high volumes or multiple replicas, migrate to a managed SQL database.

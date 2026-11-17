# QR Referral Website — FREE-TIER Deployment on Windows 11

**Uses your EXISTING GitHub repository. No domain purchase is required for testing.**

## What this version does

- `docs/`: static customer website + admin dashboard, ready for GitHub Pages or Cloudflare Pages.
- `worker/`: Cloudflare Worker API that issues referral codes, saves them to the **D1 SQL database**, protects the admin endpoints with a secret, and exports CSV.
- A single printed QR URL opens the same customer website. Each new browser gets an individual server-generated code.
- The same browser normally gets the same code, even after refreshing. A different browser or cleared storage can get another code. **This is NOT verified one-code-per-person security.**
- The local Windows `data/referrals.sqlite` is separate and **will not automatically migrate** to Cloudflare D1.

## IMPORTANT: Testing vs real business use

GitHub Pages is free for suitable project sites, but GitHub's official policy says it is **not for using as a free web host to run an online business or a site primarily facilitating commercial transactions**. This project is configured for GitHub Pages **as a test**. For the actual referral-fee/outdoor campaign, **Cloudflare Pages (free tier)** is a better place for the same `docs/` static site. The Worker and D1 stay the same and the GitHub repository can remain your source code.

Useful references:
- GitHub Pages official restrictions: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Pages publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Cloudflare D1 commands: https://developers.cloudflare.com/d1/wrangler-commands/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Pages GitHub integration: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/

## Phase A — Add the new files to your current GitHub repository

1. Download `qr-referral-github-cloudflare.zip` and right-click **Extract All**.
2. Open your **existing** GitHub repository. Do NOT create a new repository.
3. Choose **Add file > Upload files**. In Windows File Explorer, drag the complete **`docs` folder** and **`worker` folder** from the extracted ZIP to GitHub's upload area. Also upload `DEPLOY_STEP_BY_STEP.md` if desired. GitHub will preserve the file paths.
4. Before clicking **Commit changes**, check that new paths show `docs/index.html`, `docs/app.js`, `docs/admin.html`, `docs/config.js`, `worker/src/index.js`, `worker/wrangler.toml`, and `worker/sql/schema.sql`.
5. **NEVER commit** `.env`, `.dev.vars`, `node_modules`, `.wrangler`, `data/referrals.sqlite`, `data/referrals.sqlite-wal`, or `data/referrals.sqlite-shm`. If passwords or database files were previously committed, do not rely on just deleting them from the newest version; rotate your old secrets and review Git history before making a repository public.
6. Click **Commit changes**. Your old `server.js` can remain for your local Windows version, but GitHub Pages will publish only `docs/`.

For GitHub Free, your repository needs to be public to use GitHub Pages. Make it public **only after verifying no secret files or old database data are exposed in its history**. To switch repository visibility: GitHub repository > Settings > General > Danger Zone > Change repository visibility.

## Phase B — Set up Cloudflare (still using free-tier services)

1. Open https://dash.cloudflare.com/sign-up and create/sign in to a Cloudflare account. You will use the free Workers and D1 tiers, not a paid Render server.
2. Learn your GitHub username from your profile address. Example: if GitHub is `github.com/johnsmith`, your Pages site origin is `https://johnsmith.github.io` (no repository path).
3. On your **Windows computer**, open the EXTRACTED ZIP's `worker` folder (it contains `wrangler.toml`). Right-click `wrangler.toml` and open in Notepad. Replace `YOUR-GITHUB-USERNAME` with your real GitHub username. For example:

   ```toml
   SITE_ORIGIN = "https://johnsmith.github.io"
   ```

   Only include the origin, **not** `/qr-referral-website/`. Save the file.
4. In File Explorer, while inside the `worker` folder, click the address bar, type `cmd`, press Enter. Run these commands one at a time:

   ```cmd
   npm install
   npx wrangler login
   ```

   A browser will open. Approve Cloudflare authorization and return to CMD.
5. Create a persistent D1 SQL database and tell Wrangler to automatically add it to its config:

   ```cmd
   npx wrangler d1 create qr-referral-d1 --binding DB --update-config
   ```

   Check `wrangler.toml`: it should now contain a `[[d1_databases]]` block with `binding = "DB"`, `database_name = "qr-referral-d1"`, and a real UUID `database_id`.

   **If the command does not modify the file:** Copy the `[[d1_databases]]` snippet printed by Cloudflare into the bottom of `wrangler.toml`, ensure `binding = "DB"`, and save it.
6. Create the SQL tables **on the remote D1 database**:

   ```cmd
   npx wrangler d1 execute qr-referral-d1 --remote --file=./sql/schema.sql
   ```

   Be sure `--remote` appears, so you do not only initialize a local test database.
7. Deploy the Worker:

   ```cmd
   npx wrangler deploy
   ```

   On the first deploy, Cloudflare may ask you to create a `workers.dev` account subdomain. Follow the prompts. Save the exact address, which will look like:

   `https://qr-referral-api.YOUR-CLOUDFLARE-SUBDOMAIN.workers.dev`

   This is an EXAMPLE, not your real URL.
8. Add **two strong private secrets**. Generate one value in CMD with:

   ```cmd
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the output somewhere private. Run:

   ```cmd
   npx wrangler secret put ADMIN_TOKEN
   ```

   Paste the 64-character random value when prompted and press Enter. This is your **NEW admin login token**, not your old local password.

   Generate a **different** random value using the same `node -e` command again, then run:

   ```cmd
   npx wrangler secret put VISITOR_SECRET
   ```

   Paste that second random value when prompted. **Never put either secret in `docs/config.js`, `wrangler.toml`, or GitHub.** Secret commands update the deployed Worker.
9. Test your backend by opening in Chrome:

   `https://YOUR-ACTUAL-WORKER-URL/api/health`

   It should show something like `{"ok":true,"service":"qr-referral-api"}`.

## Phase C — Connect the GitHub Pages website to the Worker

1. Back in GitHub, open your existing repository > `docs` > `config.js` > pencil **Edit**. Replace the example `apiBaseUrl` with the exact `workers.dev` URL from Phase B (keep `https://`, no trailing slash). It should look like:

   ```js
   window.CAMPAIGN_CONFIG = Object.freeze({
     apiBaseUrl: 'https://qr-referral-api.YOUR-CLOUDFLARE-SUBDOMAIN.workers.dev',
     campaign: 'outdoor-2026'
   });
   ```

   Commit the edit. This URL is public and safe to put in GitHub; it is **not** a password.
2. Open your repository > **Settings > Pages**. Choose **Deploy from a branch**. Select branch `main` and folder `/docs`; click **Save**. GitHub Pages officially supports branch `/docs` publishing.
3. GitHub will show an HTTPS website link. Example only:

   `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY-NAME/`

4. Open the site. It should generate a code like `REF-12A34B56C78D90EF` and show a **Download code as PNG** button.
5. Open your admin dashboard by appending `admin.html` to the SAME website address, e.g.:

   `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY-NAME/admin.html`

   Enter the **ADMIN_TOKEN** secret from Phase B, not the old local `.env` password. You'll see counts, the latest 100 codes, **Export CSV**, and QR controls.
6. The admin page creates the flyer QR using an external QR JavaScript library hosted on cdnjs. If its script is blocked, the website and SQL API still work but QR rendering in the dashboard needs internet access to cdnjs.

## Phase D — Verify and print

1. Use your phone on mobile data to open the public GitHub Pages URL.
2. Save/download the generated code. Refresh the same browser: it should show the same code.
3. Open the page in a different browser/private mode to test a second code.
4. Open `admin.html`, sign in, and check both records. Export CSV and open it in Excel.
5. For direct D1 SQL inspection, in the worker CMD folder run:

   ```cmd
   npx wrangler d1 execute qr-referral-d1 --remote --command="SELECT id, code, campaign_slug, created_at FROM referrals ORDER BY id DESC LIMIT 20;"
   ```

6. Only print QR flyers once the final hosting URL is stable, the code flow works on real phones, and you have tested data persistence and CSV exports.

## Moving the same site to Cloudflare Pages for real business use (recommended)

1. Keep the **same existing GitHub repository** with the `docs/` folder. Do not create a new website project.
2. In the Cloudflare dashboard choose **Workers & Pages > Create > Pages > Connect to Git** (the UI labels may vary), authorize GitHub and select the existing repo.
3. Framework preset: **None**. Root directory: repo root; Build command: leave blank; **Build output directory: `docs`**.
4. Deploy and copy your new free `.pages.dev` website URL, e.g. `https://qr-referral-campaign.pages.dev`.
5. Update **local `worker/wrangler.toml`** `SITE_ORIGIN = "https://qr-referral-campaign.pages.dev"` (use the actual origin) and run `npx wrangler deploy` again. (Existing secrets should persist.)
6. This automatically allows the new Pages site to call the API, and the QR should point to the new `.pages.dev` customer URL.
7. **Do not print the old GitHub Pages QR** after switching: its URL differs. Use the new Cloudflare Pages admin dashboard for flyer QR generation.

## Troubleshooting

- **“Origin not allowed” / browser CORS error:** `SITE_ORIGIN` in `worker/wrangler.toml` must exactly equal the public site origin, e.g. `https://johnsmith.github.io` (no repository segment). Run `npx wrangler deploy` after editing it.
- **Customer shows “Website not configured yet”:** Update `docs/config.js` in GitHub with your real Worker URL; commit and allow GitHub Pages to publish the change.
- **404 on GitHub Pages:** Select `main` / `/docs` under repository `Settings > Pages`, not root.
- **D1 database missing / SQL error:** Confirm the config contains `[[d1_databases]]` with binding `DB`, and run the remote `d1 execute` schema command.
- **Admin says “Invalid admin token”:** Use the `ADMIN_TOKEN` secret you set via Wrangler, not your old Windows `.env` admin password.
- **Need to change the secret:** Run `npx wrangler secret put ADMIN_TOKEN` again with a new random secret. Keep it private.
- **Codes not the same after refreshing:** Browser private mode, blocked localStorage, a different browser, or cleared website storage can produce another code. This is not guaranteed one-code-per-person attribution.
- **Codes from your Windows SQLite are not in D1:** These are two independent databases. This bundle does not include a migration tool.

## Security and campaign limitations

- There is **no verified identity** and no customer phone/email authentication. A determined visitor can use several browsers/IDs to mint several codes. Do **not** use this as the sole source for paying referral commissions.
- This project does not handle payment, redemption status, commission approval, or referral conversions. Those require further functionality.
- Cloudflare's free tiers have request/CPU/rows/storage limits. If you hit free limits, your website may receive errors until limits reset or you upgrade.
- The admin token lives only in memory in the browser tab and is passed over HTTPS in the Authorization header; it is not stored in the GitHub repository.
- For real marketing campaigns, use **Cloudflare Pages rather than GitHub Pages** to respect GitHub's hosting terms.

# QR Referral Website — GitHub + Cloudflare D1 Edition

This is an ADD-ON to your existing `qr-referral-website` GitHub repository, not a replacement for your working local Windows Node.js server.

## Start here

**READ `DEPLOY_STEP_BY_STEP.md`** — it contains all Windows 11 commands, GitHub upload instructions, Cloudflare D1 setup, security notes, and testing steps.

### What's inside

- `docs/index.html` — customer referral website, QR scan landing page
- `docs/app.js` — calls Worker API and downloads code as PNG
- `docs/admin.html`, `docs/admin.js` — password-token gated admin operations; SQL counts, CSV export, QR flyer
- `docs/config.js` — **public** Worker URL placeholder; update after Worker deployment
- `docs/style.css` — responsive website styling
- `worker/src/index.js` — Cloudflare Worker API, CORS, D1 persistence, admin authorization
- `worker/sql/schema.sql` — SQL schema for D1
- `worker/wrangler.toml` — Worker settings; update `SITE_ORIGIN` and add generated D1 binding
- `worker/test/api.test.mjs` — tests using Node's built-in SQLite

### Web entry points

- Customer URL: `https://YOURNAME.github.io/YOUR-REPO/`
- Admin URL: `https://YOURNAME.github.io/YOUR-REPO/admin.html`
- Worker health URL: `https://YOUR-WORKER.workers.dev/api/health`

### Tests

Inside `worker` (Node.js 24 recommended):

```cmd
npm test
```

### Security

Never upload `.env`, `.dev.vars`, database files, admin secrets, or `node_modules` to GitHub. `docs/config.js` only contains a public API endpoint; no secret should ever go there.

GitHub Pages has restrictions against hosting an online business. For a public referral-fee campaign, host `docs/` on free-tier Cloudflare Pages instead, using the SAME GitHub repo as the code source. See Phase D / business-use section of the deployment guide.

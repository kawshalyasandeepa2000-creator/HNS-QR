# CARD TO DEAL — Username + Password administrator login

This release replaces the administrator **token input box** with a Username / Password form. The Worker continues using the existing `ADMIN_TOKEN` **internally** to sign short-lived sessions and as a legacy API fallback. Do not delete or expose it.

## FIRST: Cloudflare settings (required before updating GitHub frontend)

Go to Cloudflare → Workers & Pages → `qr-referral-api` → Settings → Variables and Secrets. Add:

- `ADMIN_LOGIN_USERNAME`: **Text** (or Secret). Example: your own non-sensitive login username, e.g. `hns-admin`.
- `ADMIN_LOGIN_PASSWORD`: **Secret**. Choose a unique, strong password of at least 12 characters (recommend 16+). Do not reuse your mailbox password or your existing ADMIN_TOKEN. Do not send this value to ChatGPT or commit it to GitHub.

Keep `ADMIN_TOKEN`, `DB` binding, `VISITOR_SECRET`, `OLLAMA_API_KEY`, `HNS_KNOWLEDGE_BASE`, SMTP and all current settings unchanged. Do not copy any passwords into `admin.html`, `admin.js`, GitHub or screenshots.

## Deployment order

1. Backup your currently deployed Cloudflare Worker code.
2. In the Cloudflare Worker Edit Code window, paste **`CLOUDFLARE_WORKER_PASTE_THIS.js`** from this package, then Deploy. This version includes the existing QR, Business Cards, References, Ollama, statuses, and SMTP functions. Confirm `GET /api/health` returns OK.
3. In GitHub, update **`docs/admin.html`** and **`docs/admin.js`** only, preserving those paths. Commit and wait for GitHub Pages deployment. The root `admin.html` in this full project redirects to `docs/admin.html`.
4. Open your actual GitHub Pages admin URL, hard refresh, and sign in with your configured username/password.
5. Verify QR Referral Scan, Card Details, Scan Card, status dropdown/filter, Client Note/Ollama, and save/edit all still work.

## Security and behavior

- The password is verified **only in the Cloudflare Worker**; it is never stored in the public site source.
- The Worker issues an HMAC-signed **1-hour** admin session token (NOT the original `ADMIN_TOKEN`) after successful login. Session is held only in the current browser tab's JavaScript memory, not localStorage/cookies; reload requires sign-in again. Closing the tab also drops the session. A signed token cannot be instantly revoked before expiry without rotating `ADMIN_TOKEN`.
- D1 creates `hns_admin_login_attempts` automatically on first login, limiting failures to 5 per 15 minutes per username/IP fingerprint. No existing customer tables are altered.
- This is login for a single administrator. For multiple staff with separate accounts/roles, Cloudflare Access or a full user management system is recommended.
- Wrong credentials will display `Invalid username or password`; a missing new Worker or secrets will cause a 404/503 respectively. If Worker is not yet deployed, DO NOT publish new GitHub admin login UI.
- Existing data is in Cloudflare D1 and is not in the ZIP. Never run DROP/DELETE migrations to install this release.

## Recovery

If new login fails, revert the last GitHub deployment to regain old admin screen (or roll back the Worker with its backed-up code). Do not delete `ADMIN_TOKEN` while rolling back.

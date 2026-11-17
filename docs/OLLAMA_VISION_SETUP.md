# CARD TO DEAL — Ollama Vision mobile card scanning

This version replaces OpenAI Vision card OCR with Ollama Cloud Vision. **Do not upload the ZIP file itself to GitHub.**

## Cloudflare setup

1. Back up the live Cloudflare Worker code and D1 data before replacing any production code.
2. The existing `OLLAMA_API_KEY` Worker **Secret** is reused for both Client Note AI drafts and business-card vision. **Never put it in GitHub/HTML/JavaScript.**
3. Optional Worker text variable: `OLLAMA_VISION_MODEL` = `qwen3-vl:235b-cloud`. The code uses that model by default.
4. Deploy `CLOUDFLARE_WORKER_PASTE_THIS.js` by replacing the Worker **only after comparing with the currently deployed Worker**. This ZIP is based on the latest previously shared OpenAI Vision project; production Worker may have subsequent changes.
5. Leave all existing DB, SMTP, ADMIN_TOKEN, ADMIN_LOGIN_USERNAME, ADMIN_LOGIN_PASSWORD, OLLAMA_MODEL, HNS_KNOWLEDGE_BASE and other secrets/bindings unchanged.

## GitHub pages setup

1. Upload `docs/admin.html` and `docs/admin.js` to your GitHub repository's existing `docs/` directory (these paths exactly).
2. Commit and refresh with Ctrl+Shift+R after Pages deploy.
3. Login, open **Scan Card**, take a photo, approve checkbox, click **Scan with Ollama Vision**, review fields and **Apply selected to form**. Save after visual verification.

## Guarantees and limitations

- Ollama Vision uses `POST https://ollama.com/api/chat`, `qwen3-vl:235b-cloud`, and an image encoded in REST API's base64 `messages[].images` array.
- Cloudflare D1 is **not changed** by the image scan; contact fields are written only when an admin presses Save.
- Local OCR/Deep scan/Camera/Crop, client-note Ollama AI draft, WhatsApp/Email and status management remain in source.
- Ollama API model access, limits and pricing depend on your account. No unlimited free use is implied.
- This package passed code syntax + mock API tests only; it has **not** used your private API key or tested production Cloudflare.
- Business card image and identifiers are sent to Ollama Cloud only after explicit admin opt-in. Confirm you may process these details with your provider.
- If scanning fails, use manual input or local OCR; never assume extracted phone numbers are correct.

# HNS QR — Ollama Cloud AI Integration

This is based on the latest **Point 4 client-recipient version**; all previous UI and D1 integrations are preserved.

## 1. Cloudflare Secret

You already added `OLLAMA_API_KEY` as a **Secret** to the **same existing** `qr-referral-api` Worker. Never paste it into HTML, GitHub, chat, or plaintext source files.

## 2. Optional configuration

- `OLLAMA_MODEL` (plain-text variable) = `gemma4:31b` (the example from Ollama cloud docs; check https://ollama.com/api/tags and your plan if unavailable).
- `HNS_KNOWLEDGE_BASE` (plain-text variable) = approved, current company facts from `HNS_KNOWLEDGE_BASE_EDIT_ME.txt` after editing; maximum 10,000 characters forwarded to Ollama.

The default built-in knowledge base is deliberately minimal. It does **not** claim exact prices, locations, packages or services that were not supplied and approved.

## 3. Deploy worker (REQUIRED; adding the key by itself is not enough)

1. Download/back up the currently deployed Worker source and record its version. Compare it to the ZIP's Worker. Avoid replacing newer production changes without merging.
2. In Cloudflare → Workers & Pages → your existing QR Worker → Edit Code, paste `CLOUDFLARE_WORKER_PASTE_THIS.js`, then deploy.
3. Keep existing DB binding, campaign variables, admin token, visitor secret, SMTP secrets unchanged. No D1 changes are required.
4. There is a new admin-only `POST /api/admin/ai/draft` endpoint. Request JSON: `{"inquiry":"UAE mainland company setup enquiry","confirmed":true}` with Authorization Bearer admin token. Do not put admin token in query strings. A browser cross-origin CORS check applies to known sites.

## 4. Deploy GitHub files

Upload only `docs/admin.html` and `docs/admin.js` from `HNS_QR_AI_GITHUB_ONLY.zip` to the corresponding existing `docs/` directory. Do not create `docs/docs/`. Hard-refresh dashboard.

## 5. Use

Log in as Admin, Scan Card, correct OCR data, speak/type inquiry, review it, tick the Ollama consent checkbox, click **Generate AI reply**. The AI draft appears in the editable reply box. Click **WhatsApp client** or **Email client** to open an unsent draft to the card recipient. Sending account depends on the WhatsApp/email app you are signed into; the website cannot force that account. Click Send manually.

## Privacy and caveats

For client AI draft generation, only the inquiry transcript (with best-effort phone/email redaction) and approved company knowledge are sent to Ollama Cloud. **Separately**, choosing Scan with Ollama Vision after explicit consent sends a resized business-card photo to Ollama Cloud. It is not persisted by the application. Avoid putting names, identifiers or other confidential details in the inquiry. Ollama is an external cloud AI processor, so follow your consent/privacy practices. Cloud models may need a qualifying plan/credits; the example model may change. Model responses must be reviewed for accuracy before sending.

The integration is locally code-tested with mock Ollama responses; this package is **NOT live-deployed or verified with your secret**, and does not automatically send WhatsApp or email messages.

## Troubleshooting

- 401: wrong admin token, or Cloudflare key rejected upstream (returned as AI error).
- 404: old Worker still deployed or unsupported model.
- 503: missing Cloudflare `OLLAMA_API_KEY` secret.
- 402/429 upstream: account usage/plan limit; try an available model or review usage.
- 502: upstream network/model error.
- WhatsApp/email app opens the draft, not guaranteed sends.

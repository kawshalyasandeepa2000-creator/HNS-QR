# HNS-QR — Point 4 Client Recipient Auto-Fill Fix

## What changed

- **Client WhatsApp** uses the phone number extracted from the business card (`lead-phone`).
- **Client email** uses the extracted email (`lead-email`).
- Both destination fields automatically update when OCR fills the form, when a saved contact is edited, and when the administrator corrects the fields manually.
- WhatsApp draft opens using `wa.me/<client phone>`. It uses the account already logged into WhatsApp, **not an account the website can select or impersonate**.
- Email draft opens using `mailto:<client email>`. The default mail app / configured account is responsible for the **From** address.
- Business card details, OCR text and raw microphone transcript are **not put into the outbound message**. The outgoing reply is a separate editable field. A conservative *offline template* can be prepared from Mainland/Free Zone keywords, clearly labelled **not AI**.
- After saving, the client's details remain in the form to allow sharing. Repeat Save updates an existing contact when the server returns its ID; select **Clear form** to start a new contact.
- Existing Cloudflare/D1 schemas, Worker, SMTP and image sharing are untouched.

## Limitations & next steps

- An HTML-only website cannot guarantee which WhatsApp account or email address sends. Sign into the **company WhatsApp account** and set up the **company mailbox in the default email app** before using the buttons. Review recipients and click **Send** yourself.
- This release fixes the *routing* (point 4) and removes card personal data from message text. **It is not an AI/Ollama integration**: the basic template is a temporary human-reviewed draft. A real knowledge-base AI assistant requires a configured secure backend/host and the company's approved content. Do not put API keys into HTML/JavaScript or GitHub.
- Phone must be a valid international number; local UAE 05xxxxxxxx numbers are normalized to 9715xxxxxxxx. Emails are validated.

## GitHub deployment

1. Back up the current repository (or work on a branch).
2. Upload both `docs/admin.html` and `docs/admin.js` from the `GITHUB_ONLY.zip` package into the existing `docs/` directory.
3. Commit; wait for GitHub Pages; hard-refresh `admin.html`.
4. Scan a **test** contact, verify recipients auto-fill, prepare the reply and test opening an unsent WhatsApp/email draft. Check the company account before sending.
5. Verify Save contact still works; refresh and open the saved contact for editing.

No D1 SQL or Cloudflare Worker deployment is required **for point 4**.

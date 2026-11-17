# Helen & Sons — Voice transcript + card details sharing

## What this changes

- The Scan Card panel now has two separate **outbound recipient** inputs:
  - **Send to WhatsApp number** — your/company number (optional).
  - **Send to email address** — your/company email (optional).
- Your scanned card's phone/email remain **part of the message only**. They are never automatically chosen as the destination.
- The message preview contains reviewed contact fields, meeting notes and the complete typed/speech-recognized voice transcript.
- **Open WhatsApp draft** opens a chat with a prefilled message, but does not send automatically.
- **Open email draft** opens an unsent email in the default mail app, but does not send automatically.
- **Copy full message** provides a fallback if the app or browser cannot open the draft.
- Photo sharing remains a separate workflow. Attach an image manually or use the existing **Send image** control. The card photo does **not** upload to Cloudflare D1.

## GitHub upload

1. Back up the current repository or create a new branch.
2. Open your repo's **docs/** directory.
3. Replace **both** `docs/admin.html` and `docs/admin.js` with the new versions, preserving the names.
4. Commit the changes, wait for GitHub Pages publication and hard refresh the admin page (Ctrl + Shift + R).
5. Open **Scan Card**, complete some test fields (not real customer data), type a note, enter **your own WhatsApp number/email** and check the generated message before sending.

## No Cloudflare changes needed for this feature

This is a frontend-only update. Existing D1 tables, Worker, SMTP settings, other website pages, and customer records are untouched.

## Important limitations

- Voice recognition uses the browser's built-in SpeechRecognition / webkitSpeechRecognition support, where available; use Chrome/Edge or type the note if mic transcription is unavailable.
- WhatsApp/email composing requires an appropriate installed app or browser session. The recipient must **review and click Send**; opening a draft is not proof of delivery.
- Image attachments cannot be added through `mailto:` automatically, and WhatsApp's web draft link contains **text only**. Use the photo sharing button or manually attach the image.
- Use only contact information you are authorized to share, and check that the recipient is correct.
- The full shared voice text is limited by the UI to 2,000 characters. The existing Cloudflare contact `notes` field has a separate length limit and is not modified here.

## Checks completed

- `node --check docs/admin.js`: passed.
- HTML parser: no duplicated element IDs.
- Local function tests: shared text contains contact fields, manually entered notes and voice transcript; destination numbers/emails are separate from the scanned contact; invalid WhatsApp numbers are rejected; empty recipients open chooser/draft.
- Full browser deployment and actual WhatsApp/email delivery could not be verified in this environment; no live customer data was used.

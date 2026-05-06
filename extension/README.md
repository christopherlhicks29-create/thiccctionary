# Thiccctionary browser extension

A thin shim that adds two paths into thiccctionary.com:

1. **Right-click any image on the web** → "Rate with Thiccctionary" → opens the rate page with that image URL pre-filled, and auto-rates.
2. **Click the extension icon** → opens the rate page.

No popup, no separate UI. The extension is a minimal Chrome Web Store presence; the `/rate/` page does the actual work.

## Load locally (for testing / before publish)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. The Thiccctionary icon appears in your toolbar. Right-click any image to test the context menu.

## Publish to the Chrome Web Store

1. Pay the one-time $5 developer registration fee at <https://chrome.google.com/webstore/devconsole/>.
2. Zip the contents of this folder (NOT the folder itself):
   ```
   cd extension && zip -r ../thiccctionary-extension.zip ./*
   ```
3. Upload the zip in the Chrome Web Store dev console → "Add new item".
4. Fill in:
   - Description: copied from `manifest.json`'s description field
   - Screenshots: at least one 1280×800 or 640×400 of the rate page after a verdict
   - Category: Productivity
   - Privacy practices: this extension stores nothing locally; the only network call is to thiccctionary.com (governed by our privacy policy)
5. Submit for review (~3 business days typical).

## Files

- `manifest.json` — MV3 manifest, declares context menu + icons + service worker
- `background.js` — service worker, handles context menu + icon clicks
- `icons/` — 16/32/48/128 PNG icons in the brand cream + oxblood "T"

No content scripts, no popup, no host permissions beyond what Chrome implicitly grants for opening tabs.

# Salesforce Capture for Provisioning Studio

## Install and connect

1. Start (or restart) the project with `npm start`. Refresh an already-open dashboard.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select `D:\provision-automation\chrome-extension`.
4. Pin **Provisioning Studio · Salesforce Capture** from Chrome's Extensions menu.
5. Open the extension and copy its extension ID.
6. In the dashboard, choose **Tools & connection → Extension settings**, paste the ID, and generate a connection key.
7. Paste that key into the extension and choose **Connect to Studio**. The default address is `http://localhost:3000`; change it if your dashboard uses another port.

## Capture and sync

Open a Salesforce Lightning BE Integration record at `/lightning/r/<object>/<record ID>/view`. Open **Details** and expand **General Information**, **Integration and Live Information**, and **Mockup Information**. Click the extension, then **Capture current record**.

The preview is editable. It uses:

| Studio field | Salesforce field |
|---|---|
| Account name | BE Integration Name, including its suffix |
| BE login | BE Login from Account level |
| Org ID | Integration Account Numbers |
| Website | Page URL for Mockup, exclusively |
| CMS hints | CMS/Language plus CMS/Language Details |

Click **Sync to Studio**. New accounts are added; repeated captures update the same Salesforce record. If existing values differ, select the replacements you want and confirm. Empty incoming fields never clear saved values. SDK choice, integration choice, provisioning status, and folder paths are preserved.

In an already-open dashboard, click **Review incoming changes**, merge, and save. Unsaved edits remain available, with explicit choices for conflicting values. Choose the integration and SDK and complete any missing values before running provisioning. Sync itself never provisions an account or edits Salesforce.

## Offline and recovery

- **Pending:** stored in Chrome's local extension storage. While Chrome is running, it retries about once per minute. You can also use **Retry pending**.
- **Needs attention:** open **Review** on the capture to fix the connection/data or review changed values. Authentication errors need a new connection key.
- **Synced:** the local server saved the account. Open Studio to use it.
- Closing the popup preserves your draft. Removing the extension or clearing its storage removes drafts and pending captures.
- Each queue item is processed serially. A retry after a lost response uses the Salesforce record identity, avoiding duplicate accounts.
- Only one extension installation is paired at a time. Generating another key invalidates the previous key. The server stores only its hash in `data/extension-pairing.json`.
- If Studio says the queue changed, review incoming changes before saving. Full-list saves require the revision returned by `GET /api/accounts`.

## Scope and verification

This version captures the current record on your click; it does not crawl list pages or continuously monitor Salesforce. It reads visible field containers and open shadow roots, ignores hidden records, and flags ambiguous or unloaded fields. It does not read Salesforce passwords, cookies, or session tokens. Host permissions are limited to local HTTP servers; Salesforce access uses `activeTab` on your click.

Extraction is tested with Lightning-style fixtures, including hidden duplicate records, open shadow roots, missing mockup URLs, and conflicting labels. The supplied Salesforce HTML was a loading shell, so validate the first capture against the actual loaded record. Closed shadow roots or a different Salesforce layout may require a selector adjustment. Missing fields can be entered in the preview.

Tests: `npm test`. Targeted checks: `node --test test/extension-sync.test.js test/extension-ui.test.js`.

The open dashboard checks for incoming account changes every four seconds and on returning to its tab. Clean queues update automatically without a refresh. Unsaved edits, open account dialogs, and active provisioning are protected; use the incoming-change review when edits need merging.

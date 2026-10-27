# Provision Automation

Node.js + Playwright automation for the BrightEdge provisioning workflow.

## What It Covers

1. Loads accounts from JSON/CSV or Salesforce REST.
2. Detects integration type from CMS/tech hints.
3. Logs into BrightEdge and enables `Enable Site Agent: (LR):` (formerly `Enable Autopilot for SEO (LEM)`).
4. Logs into Command Console and provisions IXF with the right org/domain/type.
5. Enables JavaScript-specific SDK flags when the account needs JavaScript.
6. Creates the client SDK folder from the configured template.
7. Returns provisioning status and the local SDK folder path; the dashboard saves these to its account file. Salesforce writes are currently disabled.
8. Writes JSONL logs under `logs/`.

## Web Dashboard (Recommended)

The everyday toolbar contains **Add Account**, **Import**, and **Save accounts**. Select rows and use **Run selected**; the header checkbox selects the whole queue. **Retry failed** appears only when failed accounts exist. **Tools & connection** contains extension settings, pairing status, and **Dry check queue**. Each row's **Details** button opens a full-width editor for long names, CMS notes, and all required inputs. Completed accounts are excluded from the ready-to-provision count. Deleting the final row can be saved as an empty queue.

### Chrome extension: Salesforce Capture

The `chrome-extension/` folder contains an unpacked Manifest V3 extension with editable capture previews, authenticated local sync, duplicate detection, change review, and a persistent offline queue. It uses **BE Integration Name** and **Page URL for Mockup** exclusively for the name and website fields. Follow [the extension installation guide](chrome-extension/README.md) to load it in Chrome and pair it from the dashboard’s **Tools & connection → Extension settings** control. Restart the dashboard after updating, then refresh its page.

Incoming changes are announced in the dashboard; review and merge them without losing unsaved edits. Full account saves now require the revision from `GET /api/accounts`. The import endpoint is separate from full-list saves and preserves existing provisioning results and SDK choices.

To launch the interactive **Provisioning Studio UI**:

```powershell
npm start
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

- Enter and manage accounts in a clean data grid with real-time pre-flight validation.
- Auto-detects integration types (`JavaScript`, `PHP`, `Liquid`, `AEM`, etc.) as you type.
- Bulk paste rows directly from Excel, Google Sheets, or CSV.
- Save directly to `data/accounts.json`.
- Execute **Dry Checks** or **Live Provisioning** with live step cards.

## CLI Commands

```powershell
npm run dry-run
npm run scrape:salesforce
npm run run
npm run dry-run:salesforce
npm run run:salesforce
```

Dry-run mode previews every step without opening browsers, creating SDK folders, or changing account statuses. Execution logs are still written.

## Configure

Create `.env` from `.env.example` and fill in:

```text
BE_UNIVERSAL_PASSWORD=
COMMAND_CONSOLE_EMAIL=
COMMAND_CONSOLE_PASSWORD=
SALESFORCE_BASE_URL=
SALESFORCE_ACCESS_TOKEN=
SDK_BASE_PATH=
SDK_TEMPLATE_PATH=
BROWSER_HEADLESS=false
BROWSER_CHANNEL=chrome
```

Command Console uses its own employee login from `COMMAND_CONSOLE_EMAIL` and `COMMAND_CONSOLE_PASSWORD`. BrightEdge uses each account's `beLogin` and `BE_UNIVERSAL_PASSWORD`. Restart the dashboard after changing `.env`.

`BROWSER_CHANNEL=chrome` launches your locally installed Google Chrome. If Chrome is installed somewhere unusual, leave `BROWSER_CHANNEL` blank and set:

```text
BROWSER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

To reuse a dedicated Chrome automation profile between runs, set `BROWSER_USER_DATA_DIR` to an empty folder path. Avoid pointing it at your everyday Chrome profile while Chrome is already open.

## Reusing the Same Chrome Browser (CDP)

To use your existing Chrome browser and avoid having to sign in or pass 2FA/Passkeys on every run:

1. Launch Chrome with remote debugging:
   ```powershell
   npm run chrome:open
   ```
2. In that Chrome window, log in to Salesforce (complete Microsoft SSO / Passkey verification).
3. Run the scrape command:
   ```powershell
   npm run scrape:salesforce
   ```
The scraper will automatically detect and connect to your open Chrome browser via CDP (port 9222), reuse your active tab/session, and keep the browser open when done!

You can also pass `--cdp` or set `CDP_URL=http://localhost:9222` explicitly.

## Salesforce Scrape First

For the first small step, set `SALESFORCE_SCRAPE_URL` to the Salesforce dashboard/list URL you want to scrape, then run:

```powershell
npm run scrape:salesforce
```

Chrome opens or attaches via CDP. If Microsoft SSO or passkey verification appears, complete sign-in; the script waits up to 3 minutes for Salesforce to be ready and writes visible rows to `data/salesforce-scrape.json`.

The internal BrightEdge, Command Console, and Salesforce pages may need exact selectors. Put overrides in `AUTOMATION_SELECTORS` as JSON:

```json
{
  "brightedge": {
    "email": ["input[name=\"email\"]"],
    "password": ["input[name=\"password\"]"],
    "siteAgentCheckbox": ["input[name=\"enable_site_agent_lr\"]", "input[name=\"enable_autopilot_lem\"]"]
  },
  "commandConsole": {
    "orgId": ["input[name=\"orgId\"]"],
    "domain": ["input[name=\"domain\"]"],
    "provision": ["button:has-text(\"Provision\")"]
  },
  "salesforce": {
    "dropbox": ["input[name=\"Dropbox_Link__c\"]"],
    "status": ["input[name=\"Provisioning_Status__c\"]"]
  }
}
```

## Account Input

Use `data/accounts.json` or a simple CSV with fields like:

```json
[
  {
    "accountName": "Example Customer",
    "beLogin": "customer@example.com",
    "integrationAccountNumber": "123456789",
    "cmsDetails": "React site with custom CMS",
    "url": "https://www.example.com"
  }
]
```

## Safety Notes

Start with `npm run dry-run`. Live mode uses the browser UI and will attempt to save changes in BrightEdge, Command Console, create folders, and save dashboard results locally.

## Reliability and local access

The dashboard binds to `127.0.0.1` and rejects foreign Host/Origin headers and cross-site requests. POST requests must use JSON. Only one provisioning run can execute at a time. This is a local tool; it does not provide multi-user authentication.

Live runs require confirmation from Command Console and verify the saved BrightEdge setting. Existing shortened client folders (for example, `parkholidays`) are reused before creating a new domain folder. A missing SDK template fails the step rather than creating an empty folder. The displayed folder path is a local path, not a Dropbox sharing URL.

Run `npm test` for regression tests and `npm run check` for the sample dry run. These checks do not contact live provisioning services.

Command Console provisioning targets the named fields in `#provisioning` and the `#save_org` control. Saving must redirect to a numeric record ID; JavaScript accounts then require a successful `/activate_custom_js_sdk/` response. Integration mapping supports JavaScript, PHP (including WordPress and version-specific Drupal hints), and Sitecore. Other integration types fail with an explicit mapping error; set `commandConsole.integrationTypeValue` in `AUTOMATION_SELECTORS` only after choosing the correct numeric option for those accounts.

## Retrying failed runs

Custom JS SDK activation waits up to **3 minutes** for its response (previously 30 seconds), proceeding as soon as the server confirms success. Set `COMMAND_CONSOLE_JS_ACTIVATION_TIMEOUT_MS` in `.env` to override this activation-only timeout, then restart Studio. The existing saved-record checkpoint is retained when activation fails, so retries do not repeat the save. An activation timeout does not prove the remote job stopped; check its state before retrying.

Live runs save successful steps immediately under `data/checkpoints/`. Running again skips completed Site Agent, Command Console, and folder steps, even after a dashboard restart. If Command Console saves successfully but JS activation fails, retry opens the saved record and retries activation without submitting another save. Failed results retain completed steps in the dashboard.

Changes to domain, integration type, CMS details, or Command Console settings invalidate the affected Command Console checkpoint. Folder path settings invalidate the folder checkpoint. Dry checks never create checkpoints. For accounts run before checkpoint support, Site Agent is inspected once; an already-enabled setting is left unchanged.

Before starting a new live provisioning workflow, Command Console is checked using `?org_id=f` followed by the integration account number padded to 14 digits (15 characters including `f`). An HTTP-success provisioning form means the account already exists, so only Command Console provisioning is skipped. Site Agent, SDK folder creation, and the UI status/folder-link update still run, respecting their saved checkpoints. HTTP 500 is treated as not provisioned, per the service's lookup behavior; other HTTP errors and login redirects stop the run. An interrupted run with a saved Command Console checkpoint continues its pending steps instead of treating its own partial record as complete.


`SDK_TEMPLATE_PATH` points to the `1-Template` root. The selected SDK folder is copied intact inside the client folder, including nested files (for example, `parkholidays/JavaScript/`). Existing files are preserved. Confirmed mappings cover JavaScript, Java, PHP General, PHP WordPress, and PHP Drupal 7; other integration variants require a matching `SDK_TEMPLATE_MAP` entry rather than guessing. The folder checkpoint includes integration type and layout version so older flat copies do not suppress the corrected copy.

## Account ID and SDK selection

The account grid shows a read-only generated ID (`f` plus the Org ID padded to 14 digits) with a Copy button. Each row also has an independent SDK Folder dropdown with the 22 supported template folder names. Select a folder before starting a live run. The selected directory is copied intact from `SDK_TEMPLATE_PATH` into the client directory, regardless of the Command Console Integration selection. The choice is saved as `sdkFolder` in JSON; bulk CSV/TSV can supply it as the ninth column after the existing status and Dropbox columns. Dry checks show source and destination paths. Changing only `sdkFolder` reruns the folder step without repeating completed Command Console or Site Agent work.


The queue separates provisioning status from input readiness. Select rows for **Run selected**, use **Retry failed** to target failed accounts, or select the header checkbox and use **Run selected** for the entire queue. Live confirmation lists the targeted count and validates only those rows. Account identity and actions remain pinned during horizontal scrolling. Results distinguish completed, previously completed/skipped, failed, and not-started steps.

After copying, **Update SDK Account ID** replaces only the account setting in the selected SDK's specified sample/configuration files. It updates both PHP samples, searches nested folders for named targets, preserves file encoding and line endings, and never modifies `1-Template`. SDKs marked as not requiring an ID update are skipped. Missing required files/settings fail this step before marking the account Provisioned. A separate checkpoint allows retrying this step without repeating copying or remote provisioning. Dry checks preview the generated ID without editing files.

The open dashboard checks for incoming account changes every four seconds and on returning to its tab. Clean queues update automatically without a refresh. Unsaved edits, open account dialogs, and active provisioning are protected; use the incoming-change review when edits need merging.

### Shared clients with multiple domains

In the Dropbox column, select **Domain subfolder** for each related account, then
click **Preview destination**. For example, `canon.de` with the JavaScript SDK
uses `Client SDK Folders/canon/canon.de/JavaScript`. The complete SDK directory is
copied, and its sample receives that account's generated ID. The Dropbox result
links to the domain directory. The default **Client folder** option keeps the
existing folder lookup behavior.

Run Dry Check before a live run to review paths. Accounts sharing an SDK path
are rejected before browser automation. Ownership records are stored internally in `data/sdk-owners`, outside client SDK folders. Existing sample IDs belonging to another account are rejected rather than replaced.
Changing the layout reruns folder copying and SDK personalization, while successful
platform and Command Console checkpoints remain reusable. Existing shared folders
are not moved or deleted.

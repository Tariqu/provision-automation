const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('@playwright/test');

test('background persists offline work, retries it, and stops for new conflicts', async () => {
  const stored = { settings: { baseUrl: 'http://localhost:3000', token: 'test-token' } };
  let listener, offline = true, existing = false, commits = 0;
  const noop = () => {};
  const context = vm.createContext({
    URL, AbortSignal, crypto: require('node:crypto').webcrypto,
    chrome: {
      runtime: { id: 'a'.repeat(32), onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener: noop }, onStartup: { addListener: noop } },
      storage: { local: { async get() { return structuredClone(stored); }, async set(value) { Object.assign(stored, structuredClone(value)); }, setAccessLevel: noop } },
      action: { setBadgeText: noop, setBadgeBackgroundColor: noop }, alarms: { async get() { return true; }, onAlarm: { addListener: noop } }
    },
    fetch: async (url, options) => {
      if (offline) throw new Error('offline');
      const body = JSON.parse(options.body);
      if (body.preview) return { ok: true, json: async () => ({ revision: 'v1', changes: existing ? [{ field: 'accountName', before: 'Operator name', after: 'Captured name' }] : [] }) };
      commits++; return { ok: true, json: async () => ({ action: 'added' }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chrome-extension/background.js'), 'utf8'), context);
  const send = message => new Promise(resolve => listener(message, { id: 'a'.repeat(32) }, resolve));
  await send({ type: 'queue', capture: { accountName: 'Captured name' } });
  assert.equal(stored.queue[0].status, 'pending');
  offline = false;
  await send({ type: 'retry' });
  assert.equal(stored.queue[0].status, 'synced');
  assert.equal(commits, 1);
  await send({ type: 'retry' });
  assert.equal(commits, 1);
  existing = true;
  await send({ type: 'queue', capture: { accountName: 'Captured name' } });
  assert.equal(stored.queue[1].status, 'attention');
  assert.equal(commits, 1);
  await send({ type: 'queue', jobId: stored.queue[1].id, capture: { accountName: 'Captured name' }, approved: [{ field: 'accountName', before: 'Operator name', after: 'Captured name' }], chosenFields: ['accountName'] });
  assert.equal(commits, 2);
});

test('capture panel reviews differences and retains replacement choices', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 440, height: 950 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const stored = { settings: { baseUrl: 'http://localhost:3000', token: 'test' }, draft: { accountName: 'C&S Wholesale Grocers, LLC - AP SCP', beLogin: 'customer@example.com', integrationAccountNumber: '333043', url: 'https://www.shopdwfreshmarket.com', cmsDetails: 'WordPress — migration to Contentstack Headless CMS', sourceUrl: 'https://fixture.lightning.force.com/lightning/r/BE_Integration__c/a00123456789012AAA/view', salesforceRecordId: 'a00123456789012AAA', warnings: ['CMS notes mention a migration or headless build. Confirm the current integration and SDK in the dashboard.'] } };
      window.chrome = {
        runtime: { id: 'a'.repeat(32), async sendMessage(message) {
          if (message.type === 'preview') return { ok: true, changes: [{ field: 'accountName', before: 'Old name', after: stored.draft.accountName }] };
          if (message.type === 'queue') { window.queued = message; stored.queue = [{ ...message, status: 'synced', message: 'Account updated in Studio' }]; }
          return { ok: true };
        } },
        storage: { local: { async get() { return structuredClone(stored); }, async set(data) { Object.assign(stored, data); }, async remove(keys) { keys.forEach(key => delete stored[key]); } }, onChanged: { addListener() {} } }
      };
    });
    await page.route('https://fixture.example/**', route => {
      const file = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
      return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../chrome-extension', file)), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('https://fixture.example/');
    await page.locator('#review').waitFor();
    await page.locator('#sync').click();
    await page.locator('#changes input').check();
    assert.equal(await page.locator('#changes').isVisible(), true);
    await page.screenshot({ path: path.join(__dirname, '../extension-preview.png'), fullPage: true });
    await page.locator('#sync').click();
    await page.waitForFunction(() => window.queued);
    assert.deepEqual(await page.evaluate(() => window.queued.chosenFields), ['accountName']);
    assert.equal(await page.locator('#review').isVisible(), false);
    assert.equal(await page.locator('.status').textContent(), 'Synced');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('dashboard merges incoming records without losing dirty edits or source metadata', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    let revision = 'one';
    let accounts = [{ id: 'one', accountName: 'Original', beLogin: 'a@example.com', integrationAccountNumber: '333043', url: 'https://example.com', cmsDetails: 'WordPress', sdkFolder: 'PHP-WordPress_Plugin', provisioningStatus: 'Provisioned', sourceOrg: 'fixture.lightning.force.com', salesforceRecordId: 'a00123456789012AAA' }];
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fixture.example/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/extension/status') return route.fulfill({ json: { paired: true } });
      if (pathname === '/api/accounts') {
        if (route.request().method() === 'POST') { accounts = route.request().postDataJSON().accounts; revision = 'three'; }
        return route.fulfill({ json: { accounts, revision, ok: true } });
      }
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../public', file)), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('https://fixture.example/');
    assert.equal(await page.locator('#btnLoadSample, #btnClearAll, #btnRunLive, [data-action="duplicate"]').count(), 0);
    assert.equal(await page.locator('#btnRetryFailed').isVisible(), false);
    await page.locator('[data-action="details"]').click();
    await page.screenshot({ path: path.join(__dirname, '../account-details-preview.png'), fullPage: true });
    await page.locator('.account-dialog [name="beLogin"]').fill('invalid');
    assert.match(await page.locator('.account-dialog [role="status"]').textContent(), /Valid BE Login Email/);
    await page.locator('.account-dialog [name="url"]').fill('javascript:alert(1)');
    assert.match(await page.locator('.account-dialog [role="status"]').textContent(), /Valid Website URL/);
    await page.locator('.account-dialog [name="beLogin"]').fill('a@example.com');
    await page.locator('.account-dialog [name="url"]').fill('https://example.com');
    await page.locator('.account-dialog button[type="submit"]').click();
    assert.equal(await page.locator('.readiness').textContent(), 'Completed');
    assert.equal(await page.locator('#readyCount').textContent(), '0');
    await page.locator('.tools-menu summary').click();
    assert.equal(await page.locator('#btnRunDry').isVisible(), true);
    assert.equal(await page.locator('#extensionStatus').textContent(), 'Extension paired with this Studio');
    await page.locator('.tools-menu summary').click();
    await page.locator('[data-field="accountName"]').fill('My unsaved edit');
    accounts = [{ ...accounts[0], beLogin: 'incoming@example.com' }, { id: 'two', accountName: 'Captured account', integrationAccountNumber: '55', url: 'https://second.example.com' }]; revision = 'two';
    await page.evaluate(() => checkIncoming());
    await page.locator('#reviewIncoming').click();
    await page.locator('#syncApply').click();
    assert.equal(await page.locator('[data-field="accountName"]').first().inputValue(), 'My unsaved edit');
    assert.equal(await page.locator('[data-field="beLogin"]').first().inputValue(), 'incoming@example.com');
    assert.equal(await page.locator('#accountTableBody tr').count(), 2);
    await page.locator('#btnSaveAccounts').click();
    await page.waitForFunction(() => document.getElementById('saveStatus').textContent === 'All changes saved');
    assert.equal(accounts[0].salesforceRecordId, 'a00123456789012AAA');
    assert.equal(accounts[0].sdkFolder, 'PHP-WordPress_Plugin');
    assert.equal(accounts[0].provisioningStatus, 'Provisioned');
    // Clean dashboards receive records through the timer without reloading.
    accounts = [...accounts, { id: 'three', accountName: 'Automatically synced', beLogin: 'new@example.com', integrationAccountNumber: '66', url: 'https://new.example.com' }];
    revision = 'four';
    await page.waitForFunction(() => document.querySelectorAll('#accountTableBody tr').length === 3, null, { timeout: 10000 });
    assert.equal(await page.locator('#syncBanner').isVisible(), false);
    assert.equal(await page.locator('#saveStatus').textContent(), 'All changes saved');
    // A details draft is not part of state.isDirty yet; it must also block replacement.
    await page.locator('[data-action="details"]').first().click();
    await page.locator('.account-dialog [name="accountName"]').fill('Protected details draft');
    accounts = accounts.map((account, index) => index ? account : { ...account, beLogin: 'latest@example.com' });
    revision = 'five';
    await page.evaluate(() => checkIncoming());
    assert.equal(await page.locator('.account-dialog [name="accountName"]').inputValue(), 'Protected details draft');
    await page.locator('.account-dialog button[type="submit"]').click();
    await page.locator('#reviewIncoming').click();
    await page.locator('#syncApply').click();
    assert.equal(await page.locator('[data-field="accountName"]').first().inputValue(), 'Protected details draft');
    assert.equal(await page.locator('[data-field="beLogin"]').first().inputValue(), 'latest@example.com');
    await page.screenshot({ path: path.join(__dirname, '../extension-dashboard-preview.png'), fullPage: true });
    while (await page.locator('[data-action="delete"]').count()) await page.locator('[data-action="delete"]').first().click();
    await page.locator('#btnSaveAccounts').click();
    await page.waitForFunction(() => document.getElementById('saveStatus').textContent === 'All changes saved');
    assert.equal(accounts.length, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

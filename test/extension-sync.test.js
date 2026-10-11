const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { cleanCapture, planImport, applyImport } = require('../src/lib/extension-sync');
const { mergeAccounts } = require('../public/sync-merge');
const { extractSalesforceRecord } = require('../chrome-extension/extractor');
const record = 'a00123456789012AAA';
const capture = {
  accountName: 'C&S Wholesale Grocers, LLC - AP SCP', beLogin: 'customer@example.com', integrationAccountNumber: '333043',
  url: 'https://www.shopdwfreshmarket.com', cmsDetails: 'WordPress — migrating to Contentstack Headless CMS',
  cmsLanguage: 'WordPress', cmsLanguageDetails: 'Migrating to Contentstack Headless CMS',
  salesforceRecordId: record, sourceUrl: `https://fixture.lightning.force.com/lightning/r/BE_Integration__c/${record}/view`
};

test('imports preserve provisioning data and require explicit replacement of existing values', () => {
  const data = cleanCapture(capture);
  const first = applyImport([], data);
  const existing = { ...first.account, sdkFolder: 'PHP-WordPress_Plugin', integrationType: 'PHP', provisioningStatus: 'Provisioned', dropboxLink: 'saved-folder', beLogin: 'operator@example.com' };
  const second = applyImport([existing], { ...data, url: '', accountName: 'Changed name' });
  assert.equal(second.accounts.length, 1);
  assert.equal(second.account.accountName, existing.accountName);
  assert.equal(second.account.url, existing.url);
  assert.equal(second.account.beLogin, existing.beLogin);
  assert.equal(second.account.sdkFolder, existing.sdkFolder);
  assert.equal(second.account.provisioningStatus, 'Provisioned');
  assert.equal(second.account.dropboxLink, 'saved-folder');
  assert.equal(applyImport([existing], data, ['beLogin']).account.beLogin, capture.beLogin);
  assert.throws(() => planImport([existing, existing], data), /Multiple matching/);
  assert.throws(() => planImport([{ integrationAccountNumber: '333043', url: 'https://different.example.com' }], data), /different or missing domain/);
  assert.equal(applyImport([{ id: 'legacy', integrationAccountNumber: '333043', url: capture.url, accountName: capture.accountName }], data).account.id, 'legacy');
  assert.throws(() => cleanCapture({ ...capture, sourceUrl: 'https://evil.example.com' }), /Salesforce/);
  assert.throws(() => cleanCapture({ ...capture, url: 'javascript:alert(1)' }), /Mockup URL/);
  assert.throws(() => cleanCapture({ ...capture, integrationAccountNumber: '333043, 444' }), /1–14 digits/);
});

test('three-way merge preserves local edits and incoming rows; conflicts and deletions are explicit', () => {
  const base = [{ id: 'one', accountName: 'Original', beLogin: 'first@example.com', sdkFolder: 'PHP' }];
  const local = [{ ...base[0], accountName: 'My name', sdkFolder: 'JavaScript' }];
  const remote = [{ ...base[0], accountName: 'Captured name', beLogin: 'second@example.com' }, { id: 'two', accountName: 'New account' }];
  const merged = mergeAccounts(base, local, remote);
  assert.equal(merged.accounts.length, 2);
  assert.equal(merged.accounts[0].sdkFolder, 'JavaScript');
  assert.equal(merged.accounts[0].beLogin, 'second@example.com');
  assert.equal(merged.accounts[0].accountName, 'My name');
  assert.equal(merged.conflicts.length, 1);
  assert.equal(mergeAccounts(base, local, remote, { 'one:accountName': 'remote' }).accounts[0].accountName, 'Captured name');
  assert.equal(mergeAccounts(base, [], base).accounts.length, 0);
  assert.equal(mergeAccounts(base, [], remote).conflicts[0].field, 'Account row');
});

test('extension API authenticates, previews, upserts, and rejects stale dashboard saves', async () => {
  const config = require('../src/config');
  const original = config.dataDir;
  config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-api-'));
  const { server } = require('../src/server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const json = { 'Content-Type': 'application/json' };
  const post = (route, body, headers = json) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const before = await (await fetch(base + '/api/accounts')).json();
    assert.equal((await post('/api/accounts', { accounts: [] })).status, 428);
    assert.equal((await post('/api/extension/pair', { extensionId }, { ...json, Origin: 'https://evil.example' })).status, 403);
    const pairing = await (await post('/api/extension/pair', { extensionId })).json();
    const headers = { ...json, Origin: `chrome-extension://${extensionId}`, 'X-Extension-Id': extensionId, Authorization: `Bearer ${pairing.token}` };
    assert.equal((await post('/api/extension/health', {}, { ...headers, Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post('/api/extension/health', {}, { ...headers, Origin: 'chrome-extension://pppppppppppppppppppppppppppppppp' })).status, 403);
    const preview = await (await post('/api/extension/import', { capture, preview: true }, headers)).json();
    assert.equal(preview.action, 'add');
    assert.equal((await post('/api/extension/import', { capture, revision: preview.revision }, headers)).status, 200);
    const saved = await (await fetch(base + '/api/accounts')).json();
    assert.equal(saved.accounts.length, 1);
    assert.equal(saved.accounts[0].accountName, capture.accountName);
    assert.equal((await post('/api/accounts', { accounts: [], revision: before.revision })).status, 409);
    assert.equal((await post('/api/provision', { dryRun: false, accounts: saved.accounts, revision: before.revision })).status, 409);
    assert.equal((await post('/api/extension/import', { capture, revision: before.revision }, headers)).status, 409);
    assert.equal((await post('/api/extension/import', { capture, revision: saved.revision }, headers)).status, 200);
    const refreshed = await (await fetch(base + '/api/accounts')).json();
    assert.equal(refreshed.accounts.length, 1);
    assert.equal((await post('/api/accounts', { accounts: refreshed.accounts, revision: refreshed.revision })).status, 200);
    const final = await (await fetch(base + '/api/accounts')).json();
    assert.equal((await post('/api/accounts', { accounts: final.accounts, revision: final.revision })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(config.dataDir, { recursive: true, force: true }); config.dataDir = original;
  }
});

test('capture uses integration name and mockup URL only, ignores hidden records, and reads open shadow roots', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const field = (label, value) => `<div class="slds-form-element"><span class="test-id__field-label">${label}</span><div class="test-id__field-value">${value}<button>Edit</button></div></div>`;
  try {
    const page = await browser.newPage();
    await page.route('https://fixture.lightning.force.com/**', route => route.fulfill({ contentType: 'text/html', body: `<div style="display:none">${field('BE Integration Name', 'Wrong hidden record')}</div>${field('BE Integration Name', capture.accountName)}${field('Account', 'Wrong account name')}${field('BE Login from Account level', capture.beLogin)}${field('Integration Account Numbers', '333043')}${field('Link Block Live URL (LEM)', 'https://wrong.example.com')}${field('Page URL for Mockup', `<a href="${capture.url}">Website</a>`)}${field('CMS/Language', 'WordPress')}<div id="shadow"></div><script>document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(field('CMS/Language Details', 'Migrating to Contentstack Headless CMS'))};</script>` }));
    await page.goto(capture.sourceUrl);
    let result = await page.evaluate(extractSalesforceRecord);
    assert.equal(result.accountName, capture.accountName);
    assert.equal(result.url, capture.url + '/');
    assert.equal(result.integrationAccountNumber, '333043');
    assert.ok(result.cmsDetails.includes('Headless'));
    assert.ok(result.warnings.some(warning => warning.includes('migration')));
    await page.getByText('Page URL for Mockup', { exact: true }).evaluate(node => node.parentElement.remove());
    result = await page.evaluate(extractSalesforceRecord);
    assert.equal(result.url, '');
    await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), field('BE Integration Name', 'Conflicting visible record'));
    result = await page.evaluate(extractSalesforceRecord);
    assert.equal(result.accountName, '');
    assert.ok(result.warnings.some(warning => warning.includes('Multiple values')));
  } finally { await browser.close(); }
});

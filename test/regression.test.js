const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeAccount, validateAccount, parseAccounts } = require('../src/lib/accounts');
const { resolveFolderPath, createSdkFolder } = require('../src/lib/folders');
const { runProvisioning } = require('../src/orchestrator');
const { provisionAccount } = require('../src/automation/commandConsole');
test('field filling skips hidden, disabled and readonly matches and uses later selectors', async () => {
  const { chromium } = require('@playwright/test');
  const { fillFirst } = require('../src/lib/browser');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.setContent('<input type="hidden" id="org_art_id" name="org_art_id"><input name="org_disabled" disabled><input name="org_readonly" readonly><input name="org_id" id="visible-org"><input placeholder="Domain" id="domain">');
    await fillFirst(page, ['input[name*="org"]'], '335004', 'Org ID');
    assert.equal(await page.locator('#org_art_id').inputValue(), '');
    assert.equal(await page.locator('#visible-org').inputValue(), '335004');
    await fillFirst(page, ['#org_art_id', 'input[placeholder="Domain"]'], 'example.com', 'domain');
    assert.equal(await page.locator('#domain').inputValue(), 'example.com');
    await assert.rejects(fillFirst(page, ['#org_art_id'], '335004', 'Org ID'), /visible, enabled, editable/);
  } finally { await browser.close(); }
});
test('Command Console fills the observed nameless login field after delayed rendering', async () => {
  const { chromium } = require('@playwright/test');
  const { loginCommandConsole } = require('../src/automation/commandConsole');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: `<input id="atc-nav-search"><input type="hidden" id="username"><div id="form"></div><script>setTimeout(() => { document.getElementById('form').innerHTML = '<input id="login"><input type="password" id="password"><button type="button" onclick="document.body.dataset.submitted=1">Log In</button>'; }, 800);</script>` }));
    await loginCommandConsole(page, { beLogin: 'customer@example.com' }, { selectors: {}, commandConsoleLoginUrl: 'https://fixture.example/', commandConsoleEmail: 'employee@example.com', commandConsolePassword: 'test-password' });
    assert.equal(await page.locator('#login').inputValue(), 'employee@example.com');
    assert.equal(await page.locator('#password').inputValue(), 'test-password');
    assert.equal(await page.locator('#atc-nav-search').inputValue(), '');
    assert.equal(await page.locator('body').getAttribute('data-submitted'), '1');
  } finally { await browser.close(); }
});
const sample = { id: 'one', cmsDetails: 'React', accountName: 'Example', beLogin: 'a@example.com', integrationAccountNumber: '12345', url: 'https://example.com', provisioningStatus: 'Pending' };

test('invalid and missing domains, email and org ID fail validation', () => {
  for (const changes of [{ url: '' }, { url: 'example customer' }, { beLogin: 'x' }, { integrationAccountNumber: 'a' }]) {
    assert.ok(validateAccount(normalizeAccount({ ...sample, ...changes })).length);
  }
  assert.deepEqual(validateAccount(normalizeAccount(sample)), []);
});

test('CSV preserves quoted commas, escaped quotes and newlines', () => {
  const [account] = parseAccounts('accountName,beLogin,orgId,cmsDetails,url\r\nExample,a@example.com,12345,"React, ""custom""\nCMS",https://example.com');
  assert.equal(account.cmsDetails, 'React, "custom"\nCMS');
  assert.equal(account.domain, 'example.com');
  assert.throws(() => parseAccounts('name,url\n"unfinished'), /Unterminated/);
});

test('SDK domains do not collide and missing templates fail without creating folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-test-'));
  try {
    assert.notEqual(resolveFolderPath({ domain: 'example.com' }, root), resolveFolderPath({ domain: 'example.org' }, root));
    assert.throws(() => createSdkFolder(normalizeAccount(sample), { sdkBasePath: root, sdkTemplatePath: path.join(root, 'missing') }), /template/);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('dry runs preserve account status and folder link', async () => {
  const input = { ...sample, dropboxLink: 'existing' };
  const results = await runProvisioning([input], { sdkBasePath: 'unused', sdkTemplatePath: 'templates' }, { dryRun: true }, { info() {}, warn() {}, error() {} });
  assert.equal(results[0].ok, true);
  assert.equal(results[0].account.provisioningStatus, 'Pending');
  assert.equal(results[0].account.dropboxLink, 'existing');
  assert.equal(results[0].account.id, 'one');
});

test('Command Console throws when success is not confirmed', async () => {
  const filled = [];
  const locator = { async evaluateAll() { return false; }, first() { return this; }, nth() { return this; }, async evaluate() { return { text: 'Save', disabled: false }; }, async isVisible() { return true; }, async isEnabled() { return true; }, async isEditable() { return true; }, async count() { return 1; }, async fill(value) { filled.push(value); }, async click() {}, async selectOption() {}, async waitFor(options) { if (options.state !== 'visible') throw new Error('timeout'); } };
  const page = { on() {}, off() {}, async goto() {}, async waitForLoadState() {}, async waitForURL() { throw new Error('timeout'); }, async waitForResponse() { return { ok: () => true, json: async () => ({ status: 0 }) }; }, locator() { return locator; }, url() { return 'http://test'; } };
  await assert.rejects(provisionAccount(page, { ...sample, integrationType: 'PHP' }, { selectors: {}, universalPassword: 'customer-password', commandConsoleEmail: 'employee@example.com', commandConsolePassword: 'employee-password', commandConsoleLoginUrl: 'https://fixture.example/login', commandConsoleProvisioningUrl: 'https://fixture.example/content/ixf/provisioning/' }), /did not confirm/);
  assert.deepEqual(filled.slice(0, 2), ['employee@example.com', 'employee-password']);
  assert.ok(!filled.includes(sample.beLogin));
  assert.ok(!filled.includes('customer-password'));
});

test('dashboard dry check never saves or changes accounts, even with dirty input', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const execute = source.slice(source.indexOf('async function executeProvisioning('), source.indexOf('function renderExecutionResults('));
  const state = { accounts: [{ ...sample }], isDirty: true };
  const before = JSON.stringify(state.accounts);
  let saves = 0;
  const element = () => ({ style: {}, scrollIntoView() {}, appendChild() {} });
  const context = vm.createContext({
    state, elements: new Proxy({}, { get: element }), document: { createElement: element },
    validateAccount: () => [], saveAccountsToDisk: async () => { saves++; return true; },
    setControlsDisabled() {}, escapeHtml: value => value, renderTable() {}, markDirty() {},
    renderExecutionResults() {}, loadLatestLogs() {}, showToast() {},
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, okCount: 1, failedCount: 0, results: [{ ok: true, account: { ...sample, provisioningStatus: 'Provisioned', dropboxLink: 'new' } }] }) })
  });
  await vm.runInContext(`${execute}\nexecuteProvisioning(true)`, context);
  assert.equal(saves, 0);
  assert.equal(JSON.stringify(state.accounts), before);
  assert.equal(state.isDirty, true);
  assert.equal(state.isRunning, false);
});

test('local API rejects foreign origins and dry-run endpoint cannot become live', async () => {
  const { server } = require('../src/server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/accounts`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      require('node:http').get(`${url}/api/accounts`, { headers: { Host: 'foreign.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(`${url}/api/provision`, { method: 'POST', body: '{}' })).status, 415);
    const response = await fetch(`${url}/api/dry-run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: false, accounts: [sample] }) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.dryRun, true);
    assert.equal(result.results[0].account.provisioningStatus, 'Pending');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

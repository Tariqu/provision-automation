const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { sdkFolderOptions, generatedAccountId } = require('../public/sdk-options');
const { resolveTemplatePath } = require('../src/lib/folders');
const { validateAccount, normalizeAccount } = require('../src/lib/accounts');

test('explicit SDK selection overrides integration mapping and rejects unknown folders', () => {
  assert.equal(sdkFolderOptions.length, 22);
  assert.equal(generatedAccountId('335004'), 'f00000000335004');
  assert.equal(generatedAccountId('bad'), '');
  for (const sdkFolder of sdkFolderOptions) {
    assert.equal(resolveTemplatePath({ integrationType: 'JavaScript', sdkFolder }, { sdkTemplatePath: 'templates' }), path.join('templates', sdkFolder));
  }
  assert.throws(() => resolveTemplatePath({ sdkFolder: '../escape' }, { sdkTemplatePath: 'templates' }));
  assert.ok(validateAccount(normalizeAccount({}), { requireSdk: true }).includes('sdkFolder'));
});

test('UI generates and copies IDs and persists an independent SDK choice', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    let accounts = [{ accountName: 'Example', beLogin: 'test@example.com', integrationAccountNumber: '335004', url: 'https://example.com', integrationType: 'JavaScript', sdkFolder: '' }];
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value; } } }));
    await page.route('https://fixture.example/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/accounts') {
        if (route.request().method() === 'POST') accounts = route.request().postDataJSON().accounts;
        return route.fulfill({ json: { accounts, ok: true } });
      }
      if (pathname === '/api/folder-preview') return route.fulfill({json:{sdkFolderPath:'clients/example/example.com/JavaScript'}});
      if (pathname.startsWith('/api/')) return route.fulfill({ json: { entries: [] } });
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../public', file)), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('https://fixture.example/');
    const sdk = page.locator('[data-field="sdkFolder"]');
    await sdk.waitFor();
    assert.deepEqual((await sdk.locator('option').allTextContents()).slice(1), sdkFolderOptions);
    assert.equal(await page.locator('.generated-id').textContent(), 'f00000000335004');
    await page.locator('[data-field="integrationAccountNumber"]').fill('123');
    await page.locator('[data-action="copy-account-id"]').click();
    assert.equal(await page.evaluate(() => window.copied), generatedAccountId('123'));
    await page.locator('[data-field="folderLayout"]').selectOption('domain');
    await page.locator('[data-action="preview-folder"]').click();
    await page.getByText('clients/example/example.com/JavaScript', {exact:true}).waitFor();
    await sdk.selectOption('PHP-WordPress_Plugin');
    assert.equal(await page.locator('[data-field="integrationType"]').inputValue(), 'JavaScript');
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST'), page.locator('#btnSaveAccounts').click()]);
    assert.equal(accounts[0].folderLayout, 'domain');
    assert.equal(accounts[0].sdkFolder, 'PHP-WordPress_Plugin');
    await page.reload();
    await sdk.waitFor();
    assert.equal(await sdk.inputValue(), 'PHP-WordPress_Plugin');
  } finally { await browser.close(); }
});

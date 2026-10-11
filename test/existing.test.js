const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { provisioningLookupId, checkExistingAccount } = require('../src/automation/commandConsole');
const { runLiveAccount } = require('../src/orchestrator');

test('lookup IDs match the 15-character format', () => {
  assert.equal(provisioningLookupId('335004'), 'f00000000335004');
  assert.equal(provisioningLookupId('1').length, 15);
  assert.throws(() => provisioningLookupId('123456789012345'));
  assert.throws(() => provisioningLookupId('invalid'));
});

test('lookup distinguishes existing, missing, HTTP errors and login redirects', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const status of [200, 500, 403, 404, 503, 302]) {
      const page = await browser.newPage();
      await page.route('https://fixture.example/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<input id="login"><input id="password" type="password"><button>Log In</button>' });
        if (!url.searchParams.has('org_id')) return route.fulfill({ contentType: 'text/html', body: '<form id="provisioning">Account</form>' });
        assert.equal(url.searchParams.get('org_id'), 'f00000000335004');
        return route.fulfill({ status, headers: status === 302 ? { location: '/login' } : {}, contentType: 'text/html', body: '<form id="provisioning">Account</form>' });
      });
      const lookup = checkExistingAccount(page, { integrationAccountNumber: '335004' }, { selectors: {}, commandConsoleEmail: 'test@example.com', commandConsolePassword: 'test', commandConsoleLoginUrl: 'https://fixture.example/login', commandConsoleProvisioningUrl: 'https://fixture.example/content/ixf/provisioning/' });
      if (status === 200 || status === 500) assert.equal((await lookup).exists, status === 200);
      else await assert.rejects(lookup);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('existing accounts skip only Command Console and finish folder and UI updates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-test-'));
  try {
    const unexpected = () => { throw new Error('Must not provision existing accounts'); };
    const result = await runLiveAccount({ integrationAccountNumber: '335004', beLogin: 'test@example.com', dropboxLink: 'existing-folder' }, { async newPage() { return { async close() {} }; } }, { dataDir: directory, selectors: {} }, {}, {
      async updateSdkAccountId() { return { updated: true }; },
    async checkExistingAccount() { return { exists: true, url: 'https://fixture.example/?org_id=f00000000335004' }; },
      async enableSiteAgent() { return { enabled: true }; },
      provisionAccount: unexpected,
      createSdkFolder() { return { created: true, copiedTemplate: true, folderPath: 'new-folder' }; }
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps.commandConsoleProvisioning.skipped, true);
    assert.equal(result.account.dropboxLink, 'new-folder');
    assert.equal(result.steps.brightedgeSiteAgent.enabled, true);
    assert.equal(result.steps.folder.copiedTemplate, true);
    assert.equal(result.steps.salesforceUpdate.updatedInUi, true);
    assert.equal(result.account.provisioningStatus, 'Provisioned');
  } finally { fs.rmSync(directory, { recursive: true }); }
});

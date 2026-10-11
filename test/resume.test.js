const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runLiveAccount } = require('../src/orchestrator');

test('SDK ID failure retries only ID update after copied-folder checkpoint', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-resume-'));
  let copied = 0, updated = 0, enabled = 0;
  const account = { integrationAccountNumber: '335004', beLogin: 'test@example.com', sdkFolder: 'JavaScript' };
  const actions = {
    async checkExistingAccount() { return { exists: true }; },
    async enableSiteAgent() { enabled++; return { enabled: true }; },
    async provisionAccount() { throw new Error('Must skip provisioning'); },
    createSdkFolder() { copied++; return { sdkFolderPath: 'client/JavaScript', folderPath: 'client' }; },
    updateSdkAccountId() { if (++updated === 1) throw new Error('Required SDK file missing'); return { accountId: 'f00000000335004', updated: true }; }
  };
  try {
    const run = () => runLiveAccount(account, { async newPage() { return { async close() {} }; } }, { dataDir: directory, selectors: {} }, {}, actions);
    const first = await run();
    assert.equal(first.failedStep, 'sdkAccountId');
    assert.equal(first.account.provisioningStatus, 'Failed');
    const second = await run();
    assert.equal(second.ok, true);
    assert.equal(second.steps.folder.resumed, true);
    assert.deepEqual([enabled, copied, updated], [1, 1, 2]);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('retries persist successful steps and resume after failure, with changed inputs invalidating affected steps', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
  const account = { integrationAccountNumber: '335004', beLogin: 'test@example.com', domain: 'example.com', integrationType: 'JavaScript', cmsDetails: 'React' };
  const config = { dataDir: directory, selectors: {}, sdkBasePath: 'sdk', sdkTemplatePath: 'template', commandConsoleProvisioningUrl: 'https://fixture.example/' };
  let be = 0, cc = 0, folders = 0, closed = 0;
  const context = { async newPage() { return { async close() { closed++; } }; } };
  const actions = {
    async updateSdkAccountId() { return { updated: true }; },
    async checkExistingAccount() { return { exists: false }; },
    async enableSiteAgent() { be++; return { enabled: true }; },
    async provisionAccount(page, account, config, progress) {
      cc++;
      if (cc === 1) {
        progress.onSaved({ url: 'https://fixture.example/?id=42' });
        throw new Error('activation failed');
      }
      if (cc === 2) assert.equal(progress.saved.url, 'https://fixture.example/?id=42');
      else assert.equal(progress.saved, null);
      return { provisioned: true };
    },
    createSdkFolder() {
      folders++;
      if (folders === 1) throw new Error('folder unavailable');
      return { folderPath: 'sdk/example.com', created: true };
    }
  };
  try {
    const run = value => runLiveAccount(value || account, context, config, {}, actions);
    const first = await run();
    assert.equal(first.failedStep, 'commandConsoleProvisioning');
    assert.equal(first.steps.brightedgeSiteAgent.enabled, true);
    const second = await run();
    assert.equal(second.failedStep, 'folder');
    assert.equal(second.steps.brightedgeSiteAgent.resumed, true);
    const third = await run();
    assert.equal(third.ok, true);
    assert.equal(third.steps.commandConsoleProvisioning.resumed, true);
    await run();
    assert.deepEqual([be, cc, folders, closed], [1, 2, 2, 4]);
    await run({ ...account, cmsDetails: 'Vue' });
    assert.deepEqual([be, cc, folders], [1, 3, 3]);
    await run({ ...account, cmsDetails: 'Vue', sdkFolder: 'Java-AEM' });
    assert.deepEqual([be, cc, folders], [1, 3, 4]);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

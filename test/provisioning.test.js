const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { provisionAccount, integrationValue } = require('../src/automation/commandConsole');

test('integration mappings match supplied options and reject ambiguous types', () => {
  assert.equal(integrationValue({ integrationType: 'PHP', cmsDetails: 'WordPress' }), '6');
  assert.equal(integrationValue({ integrationType: 'PHP', cmsDetails: 'Drupal 8' }), '4');
  assert.equal(integrationValue({ integrationType: 'PHP', cmsDetails: 'PHP' }), '1');
  assert.equal(integrationValue({ integrationType: 'JavaScript' }), '12');
  assert.throws(() => integrationValue({ integrationType: 'Server Side' }), /No confirmed/);
});

test('supplied form fields save and activate JavaScript, while PHP only saves', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/provisioning.html'), 'utf8');
  try {
    for (const integrationType of ['JavaScript', 'PHP']) {
      const page = await browser.newPage();
      let savedFields;
      let saves = 0;
      const progress = { onSaved(saved) { this.saved = saved; } };
      let activations = 0;
      await page.route('https://fixture.example/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<input id="login"><input id="password" type="password"><button>Log In</button>' });
        if (url.pathname === '/save_org/') {
          saves++;
          savedFields = new URLSearchParams(route.request().postData());
          return route.fulfill({ json: { status: 1, org_art_id: '42' } });
        }
        if (url.pathname === '/activate_custom_js_sdk/') {
          activations++;
          // A real delayed response verifies activation can exceed the old 30s limit.
          if (activations === 2) await new Promise(resolve => setTimeout(resolve, 31000));
          return route.fulfill({ json: { status: activations === 1 ? 0 : 1 } });
        }
        return route.fulfill({ contentType: 'text/html', body: fixture + `<script>
          document.getElementById('save_org').onclick = async () => {
            const data = await (await fetch('/save_org/', { method:'POST', body:new URLSearchParams(new FormData(document.getElementById('provisioning'))) })).json();
            location.href='/content/ixf/provisioning/?id='+data.org_art_id;
          };
          document.getElementById('activate_custom_js_sdk').onclick = () => fetch('/activate_custom_js_sdk/', {method:'POST'});
        </script>` });
      });
      const run = () => provisionAccount(page, { integrationAccountNumber: '335004', domain: 'example.com', integrationType, cmsDetails: integrationType === 'PHP' ? 'WordPress' : 'React' }, { selectors: {}, commandConsoleEmail: 'employee@example.com', commandConsolePassword: 'test', commandConsoleLoginUrl: 'https://fixture.example/login', commandConsoleProvisioningUrl: 'https://fixture.example/content/ixf/provisioning/' }, progress);
      if (integrationType === 'JavaScript') await assert.rejects(run(), /did not confirm/);
      const result = await run();
      assert.equal(saves, 1);
      assert.equal(result.provisioned, true);
      assert.equal(savedFields.get('org_id'), '335004');
      assert.equal(savedFields.get('org_art_id'), '');
      assert.equal(savedFields.get('base_domain'), 'example.com');
      assert.equal(savedFields.get('whitelist_params'), 'ixf');
      assert.equal(savedFields.get('integration_sdk_detail'), integrationType === 'PHP' ? 'WordPress' : 'React');
      assert.equal(savedFields.get('integration_type'), integrationType === 'PHP' ? '6' : '12');
      assert.equal(savedFields.has('javascript_version'), integrationType === 'JavaScript');
      assert.equal(savedFields.has('is_custom_js_sdk_enabled'), integrationType === 'JavaScript');
      assert.equal(activations, integrationType === 'JavaScript' ? 2 : 0);
      await page.close();
    }
  } finally { await browser.close(); }
});

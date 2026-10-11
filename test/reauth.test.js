const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { provisionAccount } = require('../src/automation/commandConsole');

for (const remainsDisabled of [false, true]) test(`disabled Save retries login once; persistent denial=${remainsDisabled}`, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    let logins = 0;
    let saves = 0;
    let fields;
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/provisioning.html'), 'utf8');
    await page.route('https://fixture.example/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/authenticated') {
        logins++;
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname === '/atc/') return route.fulfill({ contentType: 'text/html', body: `<input id="login"><input id="password" type="password"><button onclick="setTimeout(async()=>{await fetch('/authenticated');location.hash='/account'},800)">Log In</button>` });
      if (url.pathname === '/save_org/') {
        saves++;
        fields = new URLSearchParams(route.request().postData());
        return route.fulfill({ json: { status: 1 } });
      }
      const disabled = logins === 0 || remainsDisabled;
      return route.fulfill({ contentType: 'text/html', body: fixture + `<script>
        var hasUpdatePermission = ${!disabled};
        const save = document.getElementById('save_org');
        ${disabled ? "save.classList.add('disabled-button');" : ''}
        save.onclick = async () => {
          await fetch('/save_org/', {method:'POST',body:new URLSearchParams(new FormData(document.getElementById('provisioning')))});
          location.href='/content/ixf/provisioning/?id=42';
        };
      </script>` });
    });
    // The stale authenticated route used to bypass login on Retry failed.
    await page.goto('https://fixture.example/atc/#/account');
    const run = provisionAccount(page, {integrationAccountNumber:'335004',domain:'example.com',integrationType:'PHP',cmsDetails:'WordPress'}, {
      selectors:{},commandConsoleLoginUrl:'https://fixture.example/atc/#/login',commandConsoleProvisioningUrl:'https://fixture.example/content/ixf/provisioning/',commandConsoleEmail:'employee@example.com',commandConsolePassword:'test'
    });
    if (remainsDisabled) await assert.rejects(run, /still disabled after a fresh login/);
    else {
      assert.equal((await run).provisioned, true);
      assert.equal(fields.get('org_id'), '335004');
      assert.equal(fields.get('base_domain'), 'example.com');
    }
    assert.equal(logins, 1);
    assert.equal(saves, remainsDisabled ? 0 : 1);
  } finally { await browser.close(); }
});

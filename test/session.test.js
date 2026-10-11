const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { loginCommandConsole } = require('../src/automation/commandConsole');

test('a readable provisioning page with disabled Save is not a logged-in session', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    let loginVisits = 0;
    await page.route('https://fixture.example/**', route => {
      if (new URL(route.request().url()).pathname === '/atc/') {
        loginVisits++;
        return route.fulfill({ contentType: 'text/html', body: '<input id="login"><input id="password" type="password"><button onclick="location.hash=\'/account\'">Log In</button>' });
      }
      return route.fulfill({ contentType: 'text/html', body: '<form id="provisioning">Readable without login</form><div id="save_org" class="disabled-button">Save</div><script>var hasUpdatePermission = false;</script>' });
    });
    await loginCommandConsole(page, {}, { selectors: {}, commandConsoleProvisioningUrl: 'https://fixture.example/content/ixf/provisioning/', commandConsoleLoginUrl: 'https://fixture.example/atc/#/login', commandConsoleEmail: 'employee@example.com', commandConsolePassword: 'test' });
    assert.equal(loginVisits, 1);
    assert.equal(await page.locator('#login').inputValue(), 'employee@example.com');
    assert.equal(new URL(page.url()).hash, '#/account');
    assert.equal((await loginCommandConsole(page, {}, { selectors: {}, commandConsoleLoginUrl: 'https://fixture.example/atc/#/login' })).reusedSession, true);
  } finally { await browser.close(); }
});

test('login redirect to instances reuses session, including a delayed hash redirect', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const delay of [0, 1200]) {
      const page = await browser.newPage();
      await page.route('https://fixture.example/**', route => route.fulfill({
        contentType: 'text/html',
        body: `<script>setTimeout(() => { location.hash='/instances?sort=launchTime&dir=desc'; }, ${delay});</script>`
      }));
      const config = { selectors: {}, commandConsoleLoginUrl: 'https://fixture.example/atc/#/login' };
      assert.equal((await loginCommandConsole(page, {}, config)).reusedSession, true);
      assert.match(page.url(), /#\/instances\?/);
      // A subsequent call from that page must not navigate to login again.
      await page.unrouteAll();
      assert.equal((await loginCommandConsole(page, {}, config)).reusedSession, true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('reuses authenticated sessions without login, but logs in after a protected-page redirect', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const authenticated of [true, false]) {
      const page = await browser.newPage();
      let loginVisits = 0;
      await page.route('https://fixture.example/**', route => {
        if (new URL(route.request().url()).pathname === '/login') {
          loginVisits++;
          return route.fulfill({ contentType: 'text/html', body: '<input id="login"><input id="password" type="password"><button onclick="document.body.dataset.submitted=1">Log In</button>' });
        }
        return authenticated
          ? route.fulfill({ contentType: 'text/html', body: '<form id="provisioning">Account settings</form><div id="save_org">Save</div>' })
          : route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/login")</script>' });
      });
      const result = await loginCommandConsole(page, {}, {
        selectors: {}, commandConsoleProvisioningUrl: 'https://fixture.example/content/ixf/provisioning/',
        commandConsoleLoginUrl: 'https://fixture.example/login',
        commandConsoleEmail: authenticated ? '' : 'employee@example.com',
        commandConsolePassword: authenticated ? '' : 'test'
      });
      if (authenticated) {
        assert.equal(result.reusedSession, true);
        assert.equal(loginVisits, 0);
      } else {
        assert.ok(loginVisits > 0);
        assert.equal(await page.locator('#login').inputValue(), 'employee@example.com');
        assert.equal(await page.locator('body').getAttribute('data-submitted'), '1');
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

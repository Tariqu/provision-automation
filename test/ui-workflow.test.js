const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

test('selected and failed-only runs preserve other accounts, with clear pinned UI states', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    let accounts = ['First customer with a long name', 'Second customer'].map((accountName, i) => ({ accountName, beLogin: `employee${i}@example.com`, integrationAccountNumber: String(335004 + i), url: 'https://example.com', integrationType: 'JavaScript', sdkFolder: 'JavaScript', provisioningStatus: i ? 'Provisioned' : 'Pending' }));
    const runs = [];
    await page.route('https://fixture.example/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/accounts') {
        if (route.request().method() === 'POST') accounts = route.request().postDataJSON().accounts;
        return route.fulfill({ json: { accounts, ok: true } });
      }
      if (pathname === '/api/provision') {
        const input = route.request().postDataJSON();
        runs.push(input.accounts);
        return route.fulfill({ json: { ok: false, okCount: 0, failedCount: input.accounts.length, results: input.accounts.map(account => ({ account, ok: false, error: 'Test save failed', failedStep: 'commandConsoleProvisioning', steps: { salesforceInput: { ready: true }, brightedgeSiteAgent: { enabled: true, resumed: true }, commandConsoleProvisioning: { error: 'Test save failed' } } })) } });
      }
      if (pathname.startsWith('/api/')) return route.fulfill({ json: { entries: [] } });
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../public', file)), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('https://fixture.example/');
    const rows = page.locator('#accountTableBody tr');
    await rows.first().waitFor();
    await rows.first().locator('[data-action="select-account"]').check();
    await page.locator('#btnRunSelected').click();
    assert.equal(await page.locator('#confirmCount').textContent(), '1');
    await page.locator('#btnProceedRun').click();
    await page.waitForFunction(() => !document.getElementById('btnRetryFailed').disabled);
    assert.equal(runs[0].length, 1);
    assert.equal(runs[0][0].integrationAccountNumber, '335004');
    assert.equal(accounts[1].provisioningStatus, 'Provisioned');
    await page.locator('#btnRetryFailed').click();
    await page.locator('#btnProceedRun').click();
    await page.waitForFunction(() => !document.getElementById('btnRetryFailed').disabled);
    assert.equal(runs.length, 2);
    assert.equal(runs[1].length, 1);
    assert.equal(runs[1][0].integrationAccountNumber, '335004');
    assert.ok((await page.locator('.step-state').allTextContents()).includes('Not started'));
    assert.ok((await page.locator('.step-state').allTextContents()).includes('Already completed — skipped'));
    assert.ok((await page.locator('.step-desc').allTextContents()).includes('Test save failed'));
    await rows.nth(1).locator('[data-field="sdkFolder"]').selectOption('');
    assert.equal(await rows.nth(1).locator('.provision-status').textContent(), 'Provisioned');
    assert.equal(await rows.nth(1).locator('.readiness').textContent(), 'Needs input');
    await page.locator('.table-container').evaluate(element => { element.scrollLeft = 500; });
    assert.equal(await rows.first().locator('.col-name').evaluate(e => getComputedStyle(e).position), 'sticky');
    await page.locator('.table-container').evaluate(element => { element.scrollLeft = 0; });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(__dirname, '../ui-review.png'), fullPage: true });
    await page.setViewportSize({ width: 900, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await browser.close(); }
});

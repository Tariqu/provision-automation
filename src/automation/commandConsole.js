const { integrationOptions } = require('../../public/integration-options');
const {
  checkFirst,
  clickFirst,
  fillFirst,
  waitForSettled
} = require('../lib/browser');

async function loginCommandConsole(page, account, config, { force = false } = {}) {
  const selectors = config.selectors.commandConsole || {};
  const loginOrigin = new URL(config.commandConsoleLoginUrl).origin;
  const isAuthenticatedRoute = url => url.origin === loginOrigin &&
    url.pathname === '/atc/' && /^#\/(?:instances|account)(?:\?|$)/.test(url.hash);
  if (force) {
    // Reset only cookies used by Command Console, preserving unrelated sessions.
    const context = page.context();
    for (const cookie of await context.cookies(loginOrigin)) {
      await context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path });
    }
    await page.goto(loginOrigin, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).origin === loginOrigin) {
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    }
  }
  if (!force && isAuthenticatedRoute(new URL(page.url()))) return { reusedSession: true };
  // Probe a protected page using this browser context's existing cookies.
  // A login redirect or error page is not evidence of an authenticated session.
  if (!force && config.commandConsoleProvisioningUrl) {
    const target = new URL(config.commandConsoleProvisioningUrl);
    target.search = '';
    const response = await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
    await waitForSettled(page);
    const current = new URL(page.url());
    if (isAuthenticatedRoute(current)) return { reusedSession: true };
    if (response?.ok() && current.origin === target.origin && current.pathname === target.pathname &&
        await page.locator('#provisioning').isVisible() &&
        await page.locator('#save_org:not(.disabled-button):not([aria-disabled="true"])').isVisible()) {
      return { reusedSession: true };
    }
  }

  await page.goto(config.commandConsoleLoginUrl);
  await waitForSettled(page);

  const emailSelectors = selectors.email || [
    'input#login',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]'
  ];
  const loginState = await Promise.any([
    page.waitForURL(isAuthenticatedRoute, { timeout: 30000 }).then(() => 'authenticated'),
    page.locator(emailSelectors.map(selector => `${selector}:visible`).join(', ')).first()
      .waitFor({ state: 'visible', timeout: 30000 }).then(() => 'login')
  ]).catch(() => { throw new Error('Command Console showed neither a login form nor the authenticated instances page'); });
  if (loginState === 'authenticated' || isAuthenticatedRoute(new URL(page.url()))) {
    if (force) throw new Error('Command Console redirected without showing the login form during session recovery. Fresh login could not be confirmed.');
    return { reusedSession: true };
  }

  if (!config.commandConsoleEmail || !config.commandConsolePassword) {
    throw new Error('Set COMMAND_CONSOLE_EMAIL and COMMAND_CONSOLE_PASSWORD for Command Console login');
  }

  await fillFirst(
    page,
    emailSelectors,
    config.commandConsoleEmail,
    'Command Console email'
  );
  await fillFirst(
    page,
    selectors.password || [
      'input#password',
      'input[type="password"]',
      'input[name="password"]'
    ],
    config.commandConsolePassword,
    'Command Console password'
  );
  await clickFirst(
    page,
    selectors.submit || [
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Log In")',
      'button:has-text("Sign in")'
    ],
    'Command Console login'
  );
  await waitForSettled(page);
  if (new URL(config.commandConsoleLoginUrl).pathname === '/atc/') {
    await page.waitForURL(isAuthenticatedRoute, { timeout: 30000 }).catch(() => {
      throw new Error('Command Console login did not complete; provisioning stopped before Save.');
    });
  }
}

function integrationValue(account) {
  const index = integrationOptions.indexOf(account.integrationType);
  if (index !== -1) return String(index);
  const cms = String(account.cmsDetails || '').toLowerCase();
  if (account.integrationType === 'JavaScript') return '12';
  if (account.integrationType === 'PHP') {
    if (cms.includes('wordpress')) return '6';
    if (/drupal\s*8/.test(cms)) return '4';
    if (/drupal\s*7/.test(cms)) return '5';
    return '1';
  }
  if (account.integrationType === 'Sitecore') return '9';
  throw new Error(`No confirmed Command Console mapping for ${account.integrationType}; configure commandConsole.integrationTypeValue explicitly`);
}

async function selectIntegrationType(page, account, selectors) {
  const type = account.integrationType;
  const options = selectors.integrationType || [
    '#provisioning select[name="integration_type"]'
  ];

  for (const selector of options) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.selectOption(String(selectors.integrationTypeValue ?? integrationValue(account)));
      return selector;
    }
  }

  await clickFirst(
    page,
    selectors.integrationTypeDropdown || [
      '[role="combobox"]:has-text("Integration")',
      'button:has-text("Integration Type")'
    ],
    'integration type dropdown'
  );
  await clickFirst(
    page,
    selectors.integrationTypeOption || [`text=${type}`],
    'integration type option'
  );
  return 'dropdown';
}

async function submitAndConfirm(page, controls, endpoint, label, timeout = 30000) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST', { timeout }),
    clickFirst(page, controls, `Command Console ${label}`)
  ]);
  if (!response.ok()) throw new Error(`Command Console ${label} failed (HTTP ${response.status()})`);
  const data = await response.json();
  if (data.status !== 1) throw new Error(`Command Console did not confirm successful ${label}`);
  return data;
}

async function fillProvisioningForm(page, account, config) {
  const selectors = config.selectors.commandConsole || {};
  await fillFirst(
    page,
    selectors.orgId || [
      '#provisioning input[name="org_id"]'
    ],
    account.integrationAccountNumber,
    'Command Console Org ID'
  );
  await fillFirst(
    page,
    selectors.domain || [
      '#provisioning input[name="base_domain"]'
    ],
    account.domain,
    'Command Console domain'
  );

  await selectIntegrationType(page, account, selectors);

  await fillFirst(
    page,
    selectors.sdkDetails || [
      '#provisioning input[name="integration_sdk_detail"]'
    ],
    account.cmsDetails,
    'Command Console SDK details'
  );
  await fillFirst(
    page,
    selectors.whitelist || [
      '#provisioning input[name="whitelist_params"]'
    ],
    'ixf',
    'Command Console whitelist'
  );

  if (account.integrationType === 'JavaScript') {
    await checkFirst(
      page,
      selectors.javascriptLinkBlock || [
        '#provisioning input[name="javascript_version"]'
      ],
      'Javascript Link Block Publishing'
    );
    await checkFirst(
      page,
      selectors.customJsSdk || [
        '#provisioning input[name="is_custom_js_sdk_enabled"]'
      ],
      'Custom JS SDK Enabled'
    );
  }

}

async function provisionAccount(page, account, config, progress = {}) {
  const selectors = config.selectors.commandConsole || {};

  await loginCommandConsole(page, account, config);
  await page.goto(progress.saved?.url || config.commandConsoleProvisioningUrl);
  await waitForSettled(page);

  if (!progress.saved) {
    const saveUnavailable = async () => await page.locator('script:not([src])').evaluateAll(scripts =>
      scripts.some(script => /\bvar\s+hasUpdatePermission\s*=\s*false\b/.test(script.textContent))
    ) || await page.locator((selectors.provision || ['#save_org']).join(', ')).evaluateAll(elements =>
      elements.some(element => element.classList.contains('disabled-button') || element.disabled || element.getAttribute('aria-disabled') === 'true')
    );
    await fillProvisioningForm(page, account, config);
    if (await saveUnavailable()) {
      await loginCommandConsole(page, account, config, { force: true });
      await page.goto(config.commandConsoleProvisioningUrl);
      await waitForSettled(page);
      await fillProvisioningForm(page, account, config);
      if (await saveUnavailable()) {
        throw new Error('Command Console Save is still disabled after a fresh login and form refill. Check provisioning update permissions and required fields. No save was attempted.');
      }
    }

    const provisioningOrigin = new URL(config.commandConsoleProvisioningUrl).origin;
    let saveFailure = '';
    const onResponse = async response => {
      if (new URL(response.url()).pathname !== '/save_org/' || response.request().method() !== 'POST') return;
      if (!response.ok()) saveFailure = `Save request returned HTTP ${response.status()}.`;
      else {
        const data = await response.json().catch(() => null);
        if (data && data.status !== 1) saveFailure = 'Server rejected the save (status was not 1).';
      }
    };
    const onRequestFailed = request => {
      if (new URL(request.url()).pathname === '/save_org/') saveFailure = 'Save request failed at the network level.';
    };
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);
    try {
    await Promise.all([
      page.waitForURL(url => url.origin === provisioningOrigin && url.pathname === '/content/ixf/provisioning/' && /^\d+$/.test(url.searchParams.get('id') || ''), { timeout: 30000 })
        .catch(async () => {
        const control = page.locator((selectors.provision || ['#save_org']).join(', ')).first();
        const state = await control.evaluate(element => ({
          text: element.textContent.trim(),
          disabled: element.classList.contains('disabled-button') || element.getAttribute('aria-disabled') === 'true'
        })).catch(() => null);
        throw new Error(`Command Console did not confirm successful save: no saved record redirect. ${saveFailure} ${state?.disabled ? 'Save is disabled or still processing; the request may have failed or may still be running.' : 'Save did not navigate to a saved record.'}`);
      }),
      clickFirst(page, selectors.provision || ['#save_org'], 'Command Console save')
    ]);
    } finally {
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }
    if (progress.onSaved) await progress.onSaved({ url: page.url() });
  }
  await waitForSettled(page);

  if (account.integrationType === 'JavaScript') {
    await page.locator((selectors.activateCustomJs || ['#activate_custom_js_sdk']).join(', ')).first().waitFor({ state: 'visible', timeout: 30000 });
    const configuredTimeout = Number(config.commandConsoleJsActivationTimeoutMs);
    const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 180000;
    try {
      await submitAndConfirm(page, selectors.activateCustomJs || ['#activate_custom_js_sdk'], '/activate_custom_js_sdk/', 'activate Custom JS SDK', timeout);
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error(`Custom JS SDK activation did not respond within ${timeout / 1000} seconds. The saved Command Console record is preserved; activation may still be processing. Check its state before retrying.`, { cause: error });
      }
      throw error;
    }
  }

  return {
    provisioned: true,
    integrationType: account.integrationType,
    url: page.url()
  };
}

module.exports = {
  checkExistingAccount,
  provisioningLookupId,
  loginCommandConsole,
  fillProvisioningForm,
  integrationValue,
  provisionAccount
};

function provisioningLookupId(accountNumber) {
  const number = String(accountNumber).trim();
  if (!/^\d{1,14}$/.test(number)) throw new Error('Integration account number must contain 1–14 digits');
  return `f${number.padStart(14, '0')}`;
}

async function checkExistingAccount(page, account, config) {
  const lookupId = provisioningLookupId(account.integrationAccountNumber);
  await loginCommandConsole(page, account, config);
  const url = new URL(config.commandConsoleProvisioningUrl);
  url.search = '';
  url.searchParams.set('org_id', lookupId);
  const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  const current = new URL(page.url());
  if (!response || current.origin !== url.origin || current.pathname !== url.pathname) {
    throw new Error('Existing-account lookup did not reach the provisioning page; check login');
  }
  if (response.status() === 500) return { exists: false, lookupId, url: url.toString() };
  if (!response.ok()) throw new Error(`Existing-account lookup failed (HTTP ${response.status()}); provisioning stopped`);
  await page.locator('#provisioning').waitFor({ state: 'visible', timeout: 30000 });
  return { exists: true, lookupId, url: page.url() };
}

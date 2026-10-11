const {
  accountOrigin,
  clickFirst,
  fillFirst,
  waitForSettled
} = require('../lib/browser');

async function loginBrightEdge(page, account, config) {
  const selectors = config.selectors.brightedge || {};

  // Check if session is already active
  const currentUrl = page.url();
  if (
    currentUrl.includes('brightedge.com') &&
    !currentUrl.includes('/login') &&
    !currentUrl.includes('/auth')
  ) {
    return;
  }

  await page.goto(config.brightedgeLoginUrl, { waitUntil: 'domcontentloaded' });
  await waitForSettled(page);

  await fillFirst(
    page,
    selectors.email || [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[id*="email"]'
    ],
    account.beLogin,
    'BrightEdge email'
  );
  await fillFirst(
    page,
    selectors.password || [
      'input[type="password"]',
      'input[name="password"]'
    ],
    config.universalPassword,
    'BrightEdge password'
  );
  await clickFirst(
    page,
    selectors.submit || [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")'
    ],
    'BrightEdge login'
  );

  // CRITICAL: BrightEdge login initiates a form POST to global.brightedge.com/auth
  // followed by a 302 redirect chain to the user cluster (e.g. app5.brightedge.com).
  // Navigating while this redirect chain is in-flight causes net::ERR_ABORTED.
  // Wait explicitly for the page to navigate away from login and auth.
  await page.waitForURL(
    (url) => !url.pathname.includes('/login') && !url.pathname.includes('/auth'),
    { timeout: 45000 }
  );
  await page.waitForLoadState('domcontentloaded');
}

async function enableSiteAgent(page, account, config) {
  const selectors = config.selectors.brightedge || {};

  await loginBrightEdge(page, account, config);

  const origin = accountOrigin(page.url());
  const accountId = account.integrationAccountNumber;

  // Attempt direct navigation to the account's edit page first
  const editUrl = `${origin}/admin/edit_account_details/${accountId}`;
  let onEditPage = false;

  try {
    const res = await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (res && res.ok() && page.url().includes('edit_account_details')) {
      onEditPage = true;
    }
  } catch (_) {
    // If direct navigation fails or times out, proceed with fallback to manage_account
  }

  if (!onEditPage) {
    const manageUrl = new URL(config.brightedgeManageAccountPath, origin);
    await page.goto(manageUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForSettled(page);

    // Look for account link directly in table
    const directLink = page.locator(
      `a[href*="/admin/edit_account_details/${accountId}"], table tbody tr a:has-text("${accountId}")`
    ).first();

    if (await directLink.count()) {
      await directLink.click();
      await page.waitForLoadState('domcontentloaded');
    } else {
      // Use account search
      await fillFirst(
        page,
        selectors.accountSearch || [
          'input.simple_input_match_type',
          'input[type="search"]',
          'input[name*="account"]',
          'input[placeholder*="Account"]',
          'input[placeholder*="Search"]'
        ],
        accountId,
        'BrightEdge account lookup'
      );

      const searchBtn = page.locator('input.simple_search_button, button:has-text("Search")').first();
      if (await searchBtn.count()) {
        await searchBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await waitForSettled(page);

      await clickFirst(
        page,
        selectors.accountResult || [
          `a[href*="/admin/edit_account_details/${accountId}"]`,
          `text=${accountId}`,
          `text=${account.accountName}`
        ],
        'BrightEdge account result'
      );
      await page.waitForLoadState('domcontentloaded');
    }
  }

  // 1. Switch to the "LR" tab where Site Agent settings live
  // Prefer the panel target: generated ui-id values and substring text matches
  // can identify a different link. Re-click if initialization resets the tab.
  const lrTab = page.locator('a[href="#tabs-6"]').first();
  if (await lrTab.count()) {
    const panel = page.locator('#tabs-6');
    for (let attempt = 0; attempt < 3; attempt++) {
      await lrTab.click();
      try {
        await panel.waitFor({ state: 'visible', timeout: 5000 });
        break;
      } catch (error) {
        if (attempt === 2) {
          throw new Error('BrightEdge LR tab stayed hidden after three activation attempts. Site Agent was not changed.', { cause: error });
        }
      }
    }
  }

  // 2. Select Enable Site Agent (LR)
  // BrightEdge uses a radio button group (Disable / Enable)
  // ID: #enable_link_block_1 (Enable Site Agent: (LR):)
  const siteAgentControls = [
    '#enable_link_block_1',
    'input[name="data[Account][enable_link_block]"][value="1"]',
    'label:has-text("Enable Site Agent: (LR):") ~ input[value="1"]',
    'label:has-text("Enable Site Agent") ~ input[value="1"]',
    'label:has-text("Enable Site Agent: (LR):") input',
    'label:has-text("Enable Site Agent") input'
  ];

  let selectedControl;
  for (const selector of selectors.siteAgentCheckbox || siteAgentControls) {
    const loc = page.locator(selector).first();
    if (!await loc.count()) continue;
    if (await loc.isChecked()) return { enabled: true, alreadyEnabled: true, manageUrl: page.url() };
    // A forced click cannot reveal a radio inside an inactive or rendering tab.
    await loc.waitFor({ state: 'visible', timeout: 30000 });
    await loc.check();
    selectedControl = selector;
    break;
  }
  if (!selectedControl) throw new Error('Could not find the Enable Site Agent (LR) control');

  // 3. Save changes
  await clickFirst(
    page,
    selectors.save || [
      'input[type="submit"][name="save"]',
      'input[type="submit"][value="Save"]',
      'input[type="submit"]',
      'button:has-text("Save")'
    ],
    'BrightEdge save'
  );
  await waitForSettled(page);

  // Reload the account form to verify that the setting was persisted.
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  const verificationControls = [selectedControl];
  let persisted = false;
  for (const selector of verificationControls) {
    const control = page.locator(selector).first();
    if (await control.count() && await control.isChecked().catch(() => false)) {
      persisted = true;
      break;
    }
  }
  if (!persisted) throw new Error('BrightEdge did not persist the enabled Site Agent setting');

  return {
    enabled: true,
    manageUrl: page.url()
  };
}

const enableAutopilot = enableSiteAgent;

module.exports = {
  enableSiteAgent,
  enableAutopilot
};

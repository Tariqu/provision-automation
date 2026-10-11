const { normalizeAccount } = require('./accounts');
const { waitForSettled, fillFirst, clickFirst } = require('./browser');

function salesforceApiUrl(config, path) {
  const base = config.salesforceBaseUrl.replace(/\/$/, '');
  return `${base}/services/data/${config.salesforceApiVersion}${path}`;
}

async function requestSalesforce(config, path, options = {}) {
  if (!config.salesforceBaseUrl || !config.salesforceAccessToken) {
    throw new Error('Salesforce API requires SALESFORCE_BASE_URL and SALESFORCE_ACCESS_TOKEN');
  }

  const response = await fetch(salesforceApiUrl(config, path), {
    ...options,
    headers: {
      Authorization: `Bearer ${config.salesforceAccessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Salesforce API ${response.status}: ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function fetchAccountsFromSalesforce(config) {
  const query = encodeURIComponent(config.salesforceAccountsSoql);
  const data = await requestSalesforce(config, `/query?q=${query}`);
  return (data.records || []).map((record) =>
    normalizeAccount({
      salesforceId: record.Id,
      accountName: record.Name,
      url: record.Website,
      beLogin: record.BE_Login_from_Account_level__c,
      integrationAccountNumber: record.Integration_Account_Numbers__c,
      cmsDetails: record.CMS_Language_Details__c
    })
  );
}

async function updateSalesforceApi(account, result, config) {
  if (!account.salesforceId) {
    return { skipped: true, reason: 'No salesforceId on account' };
  }

  const fields = {
    [config.salesforceStatusField]: config.salesforceProvisionedValue
  };

  if (result.folderPath && config.salesforceDropboxField) {
    fields[config.salesforceDropboxField] = result.folderPath;
  }

  await requestSalesforce(config, `/sobjects/Account/${account.salesforceId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields)
  });

  return { skipped: false, method: 'api' };
}

async function updateSalesforceUi(page, account, result, config) {
  if (!config.salesforceBaseUrl) {
    return { skipped: true, reason: 'No Salesforce base URL configured' };
  }

  const selectors = config.selectors.salesforce || {};
  await page.goto(config.salesforceBaseUrl);
  await waitForSettled(page);

  await fillFirst(
    page,
    selectors.search || [
      'input[placeholder*="Search"]',
      'input[type="search"]'
    ],
    account.accountName,
    'Salesforce account search'
  );
  await page.keyboard.press('Enter');
  await waitForSettled(page);
  await clickFirst(
    page,
    selectors.accountResult || [`text=${account.accountName}`],
    'Salesforce account result'
  );
  await waitForSettled(page);

  await clickFirst(
    page,
    selectors.edit || ['button:has-text("Edit")', 'text=Edit'],
    'Salesforce edit'
  );
  await fillFirst(
    page,
    selectors.dropbox || ['input[name*="Dropbox"]', 'textarea[name*="Dropbox"]'],
    result.folderPath || '',
    'Salesforce Dropbox field'
  );
  await fillFirst(
    page,
    selectors.status || ['input[name*="Provisioning_Status"]'],
    config.salesforceProvisionedValue,
    'Salesforce status field'
  );
  await clickFirst(
    page,
    selectors.save || ['button:has-text("Save")'],
    'Salesforce save'
  );
  await waitForSettled(page);

  return { skipped: false, method: 'ui' };
}

async function helpMicrosoftSso(page, config) {
  const email = config.salesforceSsoEmail;
  if (!email) return;

  try {
    const emailField = page
      .locator('input[name="loginfmt"], input#i0116, input[type="email"]:visible')
      .first();

    const isVisible = await emailField
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    if (!isVisible) return;

    await emailField.fill(email, { timeout: 3000 });
    await page
      .locator('input[type="submit"], button[type="submit"], button:has-text("Next")')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
  } catch (_) {
    // Non-fatal if page layout is different or already submitted
  }
}

function isAuthOrVerificationUrl(url) {
  const lower = String(url || '').toLowerCase();
  return (
    lower.includes('identity/verification') ||
    lower.includes('unifiedpasskeyverificationui') ||
    lower.includes('login.salesforce.com') ||
    lower.includes('login.microsoftonline.com') ||
    lower.includes('saml.salesforce.com') ||
    lower.includes('/setup/secur/') ||
    lower.includes('passkey') ||
    lower.includes('authenticator')
  );
}

async function waitForSalesforceReady(page, config, logger) {
  const selectors = config.selectors.salesforce || {};
  const readySelectors = selectors.ready || [
    'one-appnav',
    '.slds-table',
    'lightning-datatable',
    '[role="grid"]',
    'input[placeholder*="Search"]'
  ];

  const maxWaitMs = 180000;
  const pollIntervalMs = 2500;
  const start = Date.now();
  let warnedAuth = false;

  while (Date.now() - start < maxWaitMs) {
    const currentUrl = page.url();

    for (const selector of readySelectors) {
      const ready = await page
        .locator(selector)
        .first()
        .waitFor({ timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      if (ready) return;
    }

    if (isAuthOrVerificationUrl(currentUrl)) {
      if (!warnedAuth) {
        if (logger) {
          logger.info(
            'Salesforce login / passkey verification detected. Please complete sign-in in the open Chrome browser...'
          );
        }
        warnedAuth = true;
      }
      await helpMicrosoftSso(page, config);
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function scrapeVisibleRows(page, config) {
  const selectors = config.selectors.salesforce || {};
  const rowSelectors = selectors.scrapeRows || [
    'lightning-datatable tbody tr',
    '.slds-table tbody tr',
    '[role="grid"] [role="row"]'
  ];

  for (const rowSelector of rowSelectors) {
    const rows = page.locator(rowSelector);
    const count = await rows.count();
    if (!count) continue;

    return rows.evaluateAll((rowElements) =>
      rowElements
        .map((row) => {
          const cellElements = Array.from(
            row.querySelectorAll('th, td, [role="gridcell"], [role="rowheader"]')
          );
          const cells = cellElements
            .map((cell) => cell.innerText || cell.textContent || '')
            .map((text) => text.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const links = Array.from(row.querySelectorAll('a[href]')).map((link) => ({
            text: (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim(),
            href: link.href
          }));

          return { cells, links };
        })
        .filter((row) => row.cells.length || row.links.length)
    );
  }

  return [];
}

function normalizeScrapedRow(row) {
  const cells = row.cells || [];
  const firstLink = (row.links || []).find((link) => link.text) || {};
  const possibleUrl = cells.find((cell) => /^https?:\/\//i.test(cell) || /\.[a-z]{2,}/i.test(cell));

  return normalizeAccount({
    accountName: firstLink.text || cells[0] || '',
    salesforceUrl: firstLink.href || '',
    url: possibleUrl || '',
    beLogin: cells.find((cell) => /@/.test(cell)) || '',
    integrationAccountNumber:
      cells.find((cell) => /^\d{5,}$/.test(cell.replace(/\D/g, ''))) || '',
    cmsDetails: cells.join(' | '),
    rawCells: cells,
    rawLinks: row.links || []
  });
}

async function scrapeSalesforceAccounts(page, config, logger) {
  if (!config.salesforceScrapeUrl) {
    throw new Error('Set SALESFORCE_SCRAPE_URL or SALESFORCE_BASE_URL in .env');
  }
  if (/your-company/i.test(config.salesforceScrapeUrl)) {
    throw new Error(
      'SALESFORCE_SCRAPE_URL is still using the placeholder URL. ' +
        'Set it to your real Salesforce dashboard/list URL in .env.'
    );
  }

  const currentUrl = page.url();
  const isOnSalesforce =
    currentUrl.includes('force.com') || currentUrl.includes('salesforce.com');
  const isEmptyTab =
    currentUrl === 'about:blank' || currentUrl.startsWith('chrome://');

  if (!isOnSalesforce || isEmptyTab) {
    await page.goto(config.salesforceScrapeUrl);
  }
  await waitForSettled(page);
  await helpMicrosoftSso(page, config);

  logger.info('Waiting for Salesforce page. Complete login, SSO, or Passkey in Chrome if prompted.');
  await waitForSalesforceReady(page, config, logger);

  const selectors = config.selectors.salesforce || {};
  if (selectors.scrapeSearch) {
    await fillFirst(
      page,
      selectors.scrapeSearch,
      selectors.scrapeSearchText || 'TKOs Not Ready',
      'Salesforce scrape search'
    );
    await page.keyboard.press('Enter');
    await waitForSettled(page);
  }

  const rows = await scrapeVisibleRows(page, config);
  const accounts = rows.map(normalizeScrapedRow);

  return {
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows: rows.map((row) => ({
      cells: (row.cells || []).map(cleanText),
      links: row.links || []
    })),
    accounts
  };
}

module.exports = {
  fetchAccountsFromSalesforce,
  scrapeSalesforceAccounts,
  updateSalesforceApi,
  updateSalesforceUi
};

const { updateSdkAccountId } = require('./lib/sdk-account-id');
const path = require('path');
const { createCheckpoints } = require('./lib/checkpoints');
const { enableSiteAgent, enableAutopilot } = require('./automation/brightedge');
const { provisionAccount, checkExistingAccount } = require('./automation/commandConsole');
const { createSdkFolder } = require('./lib/folders');
const { updateSalesforceApi, updateSalesforceUi } = require('./lib/salesforce');
const { validateAccount, normalizeAccount } = require('./lib/accounts');

function publicAccount(account) {
  return {
    id: account.id,
    accountName: account.accountName,
    beLogin: account.beLogin,
    integrationAccountNumber: account.integrationAccountNumber,
    domain: account.domain,
    cmsDetails: account.cmsDetails,
    sdkFolder: account.sdkFolder || '',
    integrationType: account.integrationType,
    integrationConfidence: account.integrationConfidence,
    integrationReason: account.integrationReason,
    provisioningStatus: account.provisioningStatus || 'Pending',
    dropboxLink: account.dropboxLink || ''
  };
}

async function runDryAccount(account, config) {
  const folder = createSdkFolder(account, config, { dryRun: true });
  const pub = publicAccount(account);

  return {
    account: pub,
    steps: {
      salesforceInput: { ready: true },
      integrationDecision: {
        type: account.integrationType,
        confidence: account.integrationConfidence,
        reason: account.integrationReason
      },
      brightedgeSiteAgent: { dryRun: true, wouldEnable: true },
      brightedgeAutopilot: { dryRun: true, wouldEnable: true },
      commandConsoleProvisioning: {
        dryRun: true,
        orgId: account.integrationAccountNumber,
        domain: account.domain,
        type: account.integrationType,
        whitelist: 'ixf',
        javascriptOptions:
          account.integrationType === 'JavaScript'
            ? ['Javascript Link Block Publishing', 'Custom JS SDK Enabled']
            : []
      },
      folder,
      sdkAccountId: updateSdkAccountId(account, folder, { dryRun: true }),
      salesforceUpdate: {
        dryRun: true,
        updatedInUi: false,
        status: pub.provisioningStatus,
        dropboxLink: pub.dropboxLink,
        reason: 'Simulation only; account data and Salesforce are unchanged'
      }
    },
    ok: true
  };
}

async function runLiveAccount(account, context, config, options, actions = { enableSiteAgent, provisionAccount, createSdkFolder, checkExistingAccount, updateSdkAccountId }) {
  const result = { account: publicAccount(account), steps: { salesforceInput: { ready: true } }, ok: false };
  const checkpoints = createCheckpoints(path.join(config.dataDir, 'checkpoints'), [account.integrationAccountNumber, account.beLogin]);
  const beInputs = [config.brightedgeLoginUrl, config.brightedgeManageAccountPath];
  const ccInputs = [config.commandConsoleProvisioningUrl, account.domain, account.integrationType, account.cmsDetails, config.selectors.commandConsole || {}];
  const folderInputs = ['sdk-directory-v3', account.sdkFolder || '', account.domain, account.integrationType, account.cmsDetails, config.sdkBasePath, config.sdkTemplatePath, config.sdkTemplateMap || {}];
  let activeStep;
  async function step(name, inputs, action) {
    activeStep = name;
    const previous = checkpoints.get(name, inputs);
    if (previous) {
      result.steps[name] = { ...previous, resumed: true };
      return;
    }
    const completed = await action();
    checkpoints.set(name, inputs, completed);
    result.steps[name] = completed;
  }
  async function withPage(action) {
    const page = await context.newPage();
    try { return await action(page); }
    finally { await page.close().catch(() => {}); }
  }
  try {
    // A saved record from our own interrupted run must finish its remaining steps.
    if (!checkpoints.get('commandConsoleSaved', ccInputs) && !checkpoints.get('commandConsoleProvisioning', ccInputs)) {
      activeStep = 'existingAccountCheck';
      const existing = await withPage(page => actions.checkExistingAccount(page, account, config));
      result.steps.existingAccountCheck = existing;
      if (existing.exists) {
        checkpoints.set('commandConsoleProvisioning', ccInputs, {
          skipped: true,
          reason: 'Account already exists in Command Console',
          provisioned: true,
          url: existing.url
        });
      }
    }
    await step('brightedgeSiteAgent', beInputs, () => withPage(page => actions.enableSiteAgent(page, account, config)));
    result.steps.brightedgeAutopilot = result.steps.brightedgeSiteAgent;
    await step('commandConsoleProvisioning', ccInputs, () => withPage(page => actions.provisionAccount(page, account, config, {
      saved: checkpoints.get('commandConsoleSaved', ccInputs),
      onSaved: saved => checkpoints.set('commandConsoleSaved', ccInputs, saved)
    })));
    await step('folder', folderInputs, () => actions.createSdkFolder(account, config));
    await step('sdkAccountId', ['account-id-v1', ...folderInputs, account.integrationAccountNumber, result.steps.folder.sdkFolderPath], () => actions.updateSdkAccountId(account, result.steps.folder));
  } catch (error) {
    result.steps[activeStep] = { error: error.message };
    result.error = error.message;
    result.failedStep = activeStep;
    result.account.provisioningStatus = 'Failed';
    return result;
  }

  // Update Status & Dropbox link directly for the UI; do not update Salesforce
  const statusVal = config.salesforceProvisionedValue || 'Provisioned';
  const dropboxVal = result.steps.folder.folderPath || '';

  result.account.provisioningStatus = statusVal;
  result.account.dropboxLink = dropboxVal;

  result.steps.salesforceUpdate = {
    updatedInUi: true,
    status: statusVal,
    dropboxLink: dropboxVal,
    reason: 'Updated in UI directly (Salesforce direct updates disabled)'
  };

  result.ok = true;
  return result;
}

async function getCdpEndpoint(config) {
  if (config.cdpUrl) return config.cdpUrl;
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version', {
      signal: AbortSignal.timeout(1000)
    });
    if (res.ok) return 'http://127.0.0.1:9222';
  } catch (_) {}
  return null;
}

async function launchBrowserContext(config, logger) {
  const { chromium } = require('@playwright/test');
  const launchOptions = {
    headless: config.headless,
    slowMo: config.slowMo
  };

  const cdpUrl = await getCdpEndpoint(config);
  if (cdpUrl) {
    logger.info(`Connecting to existing Chrome browser via CDP at ${cdpUrl}`);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    return {
      browser,
      context,
      persistent: true,
      isCdp: true
    };
  }

  let launchTarget = 'Playwright bundled Chromium';
  if (config.browserExecutablePath) {
    launchOptions.executablePath = config.browserExecutablePath;
    launchTarget = `Chrome executable: ${config.browserExecutablePath}`;
  } else if (config.browserChannel) {
    launchOptions.channel = config.browserChannel;
    launchTarget = `Browser channel: ${config.browserChannel}`;
  }

  logger.info(`Launching browser with ${launchTarget}`);

  if (config.browserUserDataDir) {
    const context = await chromium.launchPersistentContext(
      config.browserUserDataDir,
      launchOptions
    );
    return {
      context,
      browser: context.browser(),
      persistent: true,
      isCdp: false
    };
  }

  const browser = await chromium.launch(launchOptions);
  return {
    browser,
    context: await browser.newContext(),
    persistent: false,
    isCdp: false
  };
}

async function runProvisioning(accounts, config, options, logger) {
  const results = [];
  const browserSession = options.dryRun
    ? null
    : await launchBrowserContext(config, logger);
  const browser = browserSession ? browserSession.browser : null;
  const context = browserSession ? browserSession.context : null;

  try {
    for (const rawAccount of accounts) {
      const account = normalizeAccount(rawAccount);
      const missing = validateAccount(account, { requireSdk: !options.dryRun });
      if (missing.length) {
        const result = {
          account: publicAccount(account),
          ok: false,
          error: `Missing required fields: ${missing.join(', ')}`
        };
        results.push(result);
        logger.warn(`Skipped ${account.accountName || 'unknown account'}`, result);
        continue;
      }

      logger.info(`Processing ${account.accountName}`, {
        account: publicAccount(account)
      });

      try {
        const result = options.dryRun
          ? await runDryAccount(account, config)
          : await runLiveAccount(account, context, config, options);

        results.push(result);
        if (result.ok) logger.info(`Completed ${account.accountName}`, { ok: true });
        else logger.error(`Failed ${account.accountName}`, result);
      } catch (error) {
        const result = {
          account: publicAccount(account),
          ok: false,
          error: error.message
        };
        results.push(result);
        logger.error(`Failed ${account.accountName}`, result);
      }
    }
  } finally {
    if (context && (!browserSession || !browserSession.isCdp)) {
      await context.close();
    }
    if (browser && (!browserSession || (!browserSession.persistent && !browserSession.isCdp))) {
      await browser.close();
    }
  }

  return results;
}

module.exports = {
  launchBrowserContext,
  publicAccount,
  runProvisioning,
  runLiveAccount
};

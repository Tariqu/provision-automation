const path = require('path');
const fs = require('fs');
const config = require('./config');
const { loadAccounts } = require('./lib/accounts');
const { createLogger } = require('./lib/logger');
const {
  fetchAccountsFromSalesforce,
  scrapeSalesforceAccounts
} = require('./lib/salesforce');
const { launchBrowserContext, runProvisioning } = require('./orchestrator');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    input: '',
    fromSalesforce: false,
    scrapeSalesforce: false,
    skipSalesforceUpdate: false,
    keepOpen: false,
    cdp: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--from-salesforce') args.fromSalesforce = true;
    else if (arg === '--scrape-salesforce') args.scrapeSalesforce = true;
    else if (arg === '--skip-salesforce-update') args.skipSalesforceUpdate = true;
    else if (arg === '--keep-open') args.keepOpen = true;
    else if (arg === '--cdp') {
      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        args.cdp = next;
        index += 1;
      } else {
        args.cdp = 'http://127.0.0.1:9222';
      }
    } else if (arg.startsWith('--cdp=')) {
      args.cdp = arg.slice('--cdp='.length);
    } else if (arg === '--input') {
      args.input = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--input=')) {
      args.input = arg.slice('--input='.length);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node src/cli.js --dry-run --input data/sample-accounts.json
  node src/cli.js --scrape-salesforce
  node src/cli.js --scrape-salesforce --cdp
  node src/cli.js --input data/accounts.json
  node src/cli.js --from-salesforce

Options:
  --dry-run                  Preview every workflow step without browser actions or file writes.
  --input <path>             Read JSON or simple CSV account records.
  --from-salesforce          Query Salesforce directly using REST API / SOQL.
  --scrape-salesforce        Scrape accounts from a visible Salesforce dashboard / list view.
  --cdp [url]                Connect to existing Chrome via CDP (default: http://127.0.0.1:9222).
  --keep-open                Leave browser open after running.
  --skip-salesforce-update   Skip writing provisioned statuses and Dropbox links back to Salesforce.
`);
}

async function loadInput(args) {
  if (args.fromSalesforce) {
    return fetchAccountsFromSalesforce(config);
  }

  const inputPath = args.input || path.join(config.dataDir, 'accounts.json');
  return loadAccounts(inputPath);
}

async function runSalesforceScrape(logger, options = {}) {
  const browserSession = await launchBrowserContext(config, logger);
  const context = browserSession.context;
  const pages = context.pages();

  const existingSfPage = pages.find((p) => {
    const u = p.url();
    return u.includes('force.com') || u.includes('salesforce.com');
  });
  const emptyPage = pages.find((p) => {
    const u = p.url();
    return (
      u === 'about:blank' ||
      u.startsWith('chrome://new-tab') ||
      u.startsWith('chrome://whats-new')
    );
  });
  const page = existingSfPage || emptyPage || (await context.newPage());

  try {
    const output = await scrapeSalesforceAccounts(page, config, logger);
    const outputPath = path.join(config.dataDir, 'salesforce-scrape.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ outputPath, ...output }, null, 2));
  } finally {
    if (!browserSession.isCdp && !options.keepOpen) {
      await browserSession.context.close();
      if (browserSession.browser && !browserSession.persistent) {
        await browserSession.browser.close();
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.cdp) {
    config.cdpUrl = args.cdp;
  }

  const logger = createLogger(config.logsDir);
  if (args.scrapeSalesforce) {
    await runSalesforceScrape(logger, args);
    return;
  }

  const accounts = await loadInput(args);

  logger.info(`Loaded ${accounts.length} account(s)`);

  const results = await runProvisioning(accounts, config, args, logger);
  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;

  console.log(JSON.stringify({ ok, failed, results, logFile: logger.filePath }, null, 2));

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

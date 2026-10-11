const path = require('path');
const fs = require('fs');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const rootDir = path.resolve(__dirname, '..');

loadDotEnv(path.join(rootDir, '.env'));

function readJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  logsDir: path.join(rootDir, 'logs'),
  salesforceBaseUrl: process.env.SALESFORCE_BASE_URL || '',
  salesforceScrapeUrl:
    process.env.SALESFORCE_SCRAPE_URL ||
    process.env.SALESFORCE_BASE_URL ||
    '',
  salesforceSsoEmail:
    process.env.SALESFORCE_SSO_EMAIL || 'tarique.ansari@brightedge.com',
  salesforceAccessToken: process.env.SALESFORCE_ACCESS_TOKEN || '',
  salesforceApiVersion: process.env.SALESFORCE_API_VERSION || 'v60.0',
  salesforceAccountsSoql:
    process.env.SALESFORCE_ACCOUNTS_SOQL ||
    "SELECT Id, Name, Website, BE_Login_from_Account_level__c, Integration_Account_Numbers__c, CMS_Language_Details__c FROM Account WHERE Provisioning_Status__c = 'TKOs Not Ready'",
  salesforceStatusField:
    process.env.SALESFORCE_STATUS_FIELD || 'Provisioning_Status__c',
  salesforceDropboxField:
    process.env.SALESFORCE_DROPBOX_FIELD || 'Dropbox_Link__c',
  salesforceProvisionedValue:
    process.env.SALESFORCE_PROVISIONED_VALUE || 'Provisioned',
  brightedgeLoginUrl:
    process.env.BRIGHTEDGE_LOGIN_URL ||
    'https://www.brightedge.com/secure/login',
  brightedgeManageAccountPath:
    process.env.BRIGHTEDGE_MANAGE_ACCOUNT_PATH || '/admin/manage_account/',
  commandConsoleLoginUrl:
    process.env.COMMAND_CONSOLE_LOGIN_URL ||
    'https://command-console.brightedge.com/atc/#/login',
  commandConsoleProvisioningUrl:
    process.env.COMMAND_CONSOLE_PROVISIONING_URL ||
    'https://command-console.brightedge.com/content/ixf/provisioning/',
  universalPassword: process.env.BE_UNIVERSAL_PASSWORD || '',
  commandConsoleEmail: process.env.COMMAND_CONSOLE_EMAIL || '',
  commandConsoleJsActivationTimeoutMs: Number(process.env.COMMAND_CONSOLE_JS_ACTIVATION_TIMEOUT_MS || 180000),
  commandConsolePassword: process.env.COMMAND_CONSOLE_PASSWORD || '',
  sdkBasePath:
    process.env.SDK_BASE_PATH ||
    'C:\\Users\\tarique.ansari\\BrightEdge Dropbox\\Tarique Ansari\\Client SDK Folders',
  sdkTemplateMap: readJson(process.env.SDK_TEMPLATE_MAP, {}),
  sdkTemplatePath:
    process.env.SDK_TEMPLATE_PATH ||
    'C:\\Users\\tarique.ansari\\BrightEdge Dropbox\\Tarique Ansari\\Client SDK Folders\\1-Template',
  headless: readBoolean(process.env.BROWSER_HEADLESS, false),
  slowMo: Number(process.env.BROWSER_SLOW_MO || 0),
  browserChannel: process.env.BROWSER_CHANNEL || '',
  browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
  browserUserDataDir: process.env.BROWSER_USER_DATA_DIR || '',
  cdpUrl: process.env.CDP_URL || process.env.BROWSER_CDP_URL || '',
  selectors: readJson(process.env.AUTOMATION_SELECTORS, {})
};

module.exports = config;

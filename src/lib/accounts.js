const { sdkFolderOptions } = require('../../public/sdk-options');
const fs = require('fs');
const { extractDomain } = require('./domain');
const { detectIntegrationType } = require('./integration');

function normalizeAccount(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error('Each account must be an object');
  const cmsDetails =
    account.cmsDetails ||
    account.cms ||
    account['CMS/Language Details'] ||
    '';
  const integrationAccountNumber =
    account.integrationAccountNumber ||
    account.orgId ||
    account['Integration Account Numbers'] ||
    '';
  const url = account.url || account.domain || account.website || '';
  const accountName = account.accountName || account.name || account.Account || '';
  const beLogin =
    account.beLogin ||
    account.email ||
    account['BE Login from Account level'] ||
    '';
  const detected = detectIntegrationType(cmsDetails, account.detectedTech || '');

  return {
    ...account,
    accountName,
    beLogin,
    integrationAccountNumber: String(integrationAccountNumber).trim(),
    cmsDetails,
    url,
    domain: extractDomain(url),
    integrationType: account.integrationType || detected.type,
    integrationReason: detected.reason,
    integrationConfidence: detected.confidence,
    provisioningStatus: account.provisioningStatus || account.status || 'Pending',
    dropboxLink: account.dropboxLink || account.dropbox || account.folderPath || ''
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(value.trim()); value = '';
      if (char !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else value += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map(values => {
    if (values.length !== headers.length) throw new Error('CSV row has an unexpected number of columns');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function parseAccounts(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const parsed = raw.startsWith('[') || raw.startsWith('{')
    ? JSON.parse(raw)
    : parseCsv(raw);
  const accounts = Array.isArray(parsed) ? parsed : [parsed];

  return accounts.map(normalizeAccount);
}

function loadAccounts(filePath) {
  return parseAccounts(fs.readFileSync(filePath, 'utf8'));
}

function validateAccount(account, options = {}) {
  const missing = [];
  if (options.requireSdk && !sdkFolderOptions.includes(account.sdkFolder)) missing.push('sdkFolder');
  if (!String(account.accountName || '').trim()) missing.push('accountName');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.beLogin || '')) missing.push('beLogin');
  if (!/^\d{1,14}$/.test(account.integrationAccountNumber || '')) {
    missing.push('integrationAccountNumber');
  }
  if (!extractDomain(account.domain)) missing.push('url/domain');

  return missing;
}

module.exports = {
  loadAccounts,
  normalizeAccount,
  parseAccounts,
  validateAccount
};

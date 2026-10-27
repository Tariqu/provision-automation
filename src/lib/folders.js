const { sdkFolderOptions } = require('../../public/sdk-options');
const fs = require('fs');
const path = require('path');
const { extractDomain, folderCandidates } = require('./domain');

function resolveFolderPath(account, basePath) {
  const domain = extractDomain(account.domain || account.url);
  if (!domain) throw new Error('A valid domain is required for the SDK folder');
  if (account.folderLayout && !['standard', 'domain'].includes(account.folderLayout)) throw new Error('Invalid folder layout');
  if (account.folderLayout === 'domain') {
    const client = folderCandidates(domain)[0];
    return path.join(basePath, client, domain);
  }
  for (const name of folderCandidates(domain)) {
    const candidate = path.join(basePath, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return path.join(basePath, domain);
}

function resolveTemplatePath(account, config) {
  if (account.sdkFolder) {
    if (!sdkFolderOptions.includes(account.sdkFolder)) throw new Error('Invalid SDK folder selection');
    return path.join(config.sdkTemplatePath, account.sdkFolder);
  }
  const type = account.integrationType;
  const names = {
    JavaScript: 'JavaScript', Java: 'Java', 'PHP (General)': 'PHP',
    'PHP (Wordpress)': 'PHP-WordPress', 'PHP (Drupal 7)': 'PHP-Drupal 7', AEM: 'Java-AEM'
  };
  const legacy = type === 'PHP' ? (/wordpress/i.test(account.cmsDetails || '') ? 'PHP-WordPress' : 'PHP') : null;
  const name = config.sdkTemplateMap?.[type] || names[type] || legacy;
  if (!name) throw new Error(`No confirmed SDK template folder for ${type}; configure SDK_TEMPLATE_MAP`);
  if (path.basename(name) !== name || name === '.' || name === '..') throw new Error('SDK template mapping must name a direct child folder');
  return path.join(config.sdkTemplatePath, name);
}

function createSdkFolder(account, config, options = {}) {
  const folderPath = resolveFolderPath(account, config.sdkBasePath);
  const templatePath = resolveTemplatePath(account, config);
  const sdkFolderPath = path.join(folderPath, path.basename(templatePath));
  assertFolderOwner(sdkFolderPath, account, config.dataDir);
  if (options.dryRun) return { folderPath, templatePath, sdkFolderPath, created: false, copiedTemplate: false, dryRun: true };
  if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isDirectory()) {
    throw new Error(`SDK template directory does not exist: ${templatePath}`);
  }
  const created = !fs.existsSync(folderPath);
  fs.mkdirSync(folderPath, { recursive: true });
  fs.mkdirSync(sdkFolderPath, { recursive: true });
  recordFolderOwner(sdkFolderPath, account, config.dataDir);
  // Copy the SDK directory itself, preserving nested files and existing client edits.
  fs.cpSync(templatePath, sdkFolderPath, { recursive: true, force: false, errorOnExist: false });
  return { folderPath, templatePath, sdkFolderPath, ownershipDataDir: config.dataDir, created, copiedTemplate: true };
}

function ownerFile(sdkFolderPath, dataDir = path.resolve(__dirname, '../../data')) {
  const key = require('crypto').createHash('sha256').update(path.resolve(sdkFolderPath).toLowerCase()).digest('hex');
  return path.join(dataDir, 'sdk-owners', key + '.json');
}

function assertFolderOwner(sdkFolderPath, account, dataDir) {
  for (const marker of [ownerFile(sdkFolderPath, dataDir), path.join(sdkFolderPath, '.provision-account.json')]) {
    if (!fs.existsSync(marker)) continue;
    const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (owner.accountId !== String(account.integrationAccountNumber) || owner.domain !== extractDomain(account.domain || account.url)) {
      throw new Error('SDK destination belongs to another account: ' + sdkFolderPath + '. Choose a separate domain folder.');
    }
  }
}

function recordFolderOwner(sdkFolderPath, account, dataDir) {
  assertFolderOwner(sdkFolderPath, account, dataDir);
  const marker = ownerFile(sdkFolderPath, dataDir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify({ accountId: String(account.integrationAccountNumber), domain: extractDomain(account.domain || account.url), sdkFolderPath: path.resolve(sdkFolderPath) }), { flag: 'wx' });
}

function validateDestinations(accounts, config) {
  const destinations = new Map();
  for (const account of accounts) {
    const folder = createSdkFolder(account, config, { dryRun: true });
    const key = path.resolve(folder.sdkFolderPath).toLowerCase();
    const identity = `${account.integrationAccountNumber}:${extractDomain(account.domain || account.url)}`;
    if (destinations.has(key) && destinations.get(key) !== identity) throw new Error(`Accounts share SDK destination ${folder.sdkFolderPath}. Select Domain subfolder for these accounts before running.`);
    destinations.set(key, identity);
  }
}

module.exports = { createSdkFolder, resolveFolderPath, resolveTemplatePath, assertFolderOwner, recordFolderOwner, validateDestinations };

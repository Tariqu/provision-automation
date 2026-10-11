const { sdkFolderOptions } = require('../../public/sdk-options');
const fs = require('fs');
const path = require('path');
const { extractDomain, folderCandidates } = require('./domain');

function resolveFolderPath(account, basePath) {
  const domain = extractDomain(account.domain || account.url);
  if (!domain) throw new Error('A valid domain is required for the SDK folder');
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
  if (options.dryRun) return { folderPath, templatePath, sdkFolderPath, created: false, copiedTemplate: false, dryRun: true };
  if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isDirectory()) {
    throw new Error(`SDK template directory does not exist: ${templatePath}`);
  }
  const created = !fs.existsSync(folderPath);
  fs.mkdirSync(folderPath, { recursive: true });
  // Copy the SDK directory itself, preserving nested files and existing client edits.
  fs.cpSync(templatePath, sdkFolderPath, { recursive: true, force: false, errorOnExist: false });
  return { folderPath, templatePath, sdkFolderPath, created, copiedTemplate: true };
}

module.exports = { createSdkFolder, resolveFolderPath, resolveTemplatePath };

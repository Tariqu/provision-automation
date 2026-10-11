const fs = require('fs');
const path = require('path');
const { generatedAccountId } = require('../../public/sdk-options');

const skipped = new Set(['DotNet-Kentico', 'DotNet-Optimizely_Plugin', 'DotNet-Umbraco_Plugin', 'Java-OSGI', 'Magento_2_Plugin', 'PHP-Drupal9-11', 'PHP-WordPress_Plugin', 'Side-Car']);
const files = {
  'DotNet-MVC': [/^Controllers\/.*\.(cs|vb)$/i],
  'DotNet-VB': [/(^|\/)Site\.Master\.vb$/i],
  'DotNet-WebForms': [/(^|\/)Site\.Master\.cs$/i],
  Java: [/(^|\/)sample-master\.jsp$/i],
  'Java-AEM': [/(^|\/)BrightEdgeUtil\.java$/i],
  'Java-AEM6.5': [/(^|\/)BrightEdgeUtil\.java$/i],
  'Java-Hybris': [/(^|\/)hybris_template\.jsp$/i],
  JavaScript: [/(^|\/)sample_master\.html?$/i],
  PHP: [/(^|\/)sample_master_standard\.php$/i, /(^|\/)sample_master_hybrid\.php$/i],
  'PHP-Drupal 7': [/(^|\/)html\.tpl\.php$/i],
  'PHP-Joomla': [/(^|\/)theme\.php$/i],
  'PHP-Twig': [/(^|\/)PreContentViewListener\.php$/i],
  'PHP-WordPress': [/(^|\/)header\.php$/i],
  'PHP-WordPress_Shortcode': [/(^|\/)header\.php$/i]
};

function patternFor(sdk) {
  if (sdk === 'JavaScript') return /(<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/cdn\.bc0a\.com\/autopilot\/)[^/"'\s]+(\/autopilot_sdk\.js)/gi;
  if (sdk.startsWith('DotNet')) return /(ixf_config\.SetProperty\(\s*IXFConfigKeys\.ACCOUNT_ID\s*,\s*")[^"]*("\s*\))/g;
  if (sdk.startsWith('Java')) return /(ixfConfig\.setProperty\(\s*IXFConfiguration\.ACCOUNT_ID\s*,\s*")[^"]*("\s*\))/g;
  return /(BEIXFClient::\$ACCOUNT_ID_CONFIG\s*=>\s*["'])[^"']*(["'])/g;
}

function updateSdkAccountId(account, folder, options = {}) {
  const accountId = generatedAccountId(account.integrationAccountNumber);
  if (!accountId) throw new Error('Cannot update SDK: invalid integration account number');
  const sdk = account.sdkFolder || path.basename(folder.sdkFolderPath);
  if (skipped.has(sdk)) return { skipped: true, reason: 'This SDK does not require an account ID update', accountId, files: [] };
  const rules = files[sdk];
  if (!rules) throw new Error(`No account ID update rule for SDK ${sdk}`);
  if (options.dryRun) return { dryRun: true, accountId, sdkFolderPath: folder.sdkFolderPath, files: [], wouldUpdate: true };
  const root = path.resolve(folder.sdkFolderPath);
  if (folder.templatePath && fs.realpathSync(root) === fs.realpathSync(folder.templatePath)) throw new Error('Refusing to modify the source template');
  const candidates = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error(`Cannot personalize linked SDK item: ${item.name}`);
      if (item.isDirectory()) walk(full);
      else candidates.push({ full, relative: path.relative(root, full).replace(/\\/g, '/') });
    }
  }
  walk(root);
  const edits = new Map();
  for (const rule of rules) {
    const matches = candidates.filter(item => rule.test(item.relative));
    let found = false;
    for (const item of matches) {
      const original = fs.readFileSync(item.full);
      let encoding = 'latin1';
      let bytes = original;
      const bigEndian = original[0] === 0xfe && original[1] === 0xff;
      if (bigEndian) bytes = Buffer.from(original).swap16();
      if (bigEndian || original[0] === 0xff && original[1] === 0xfe) encoding = 'utf16le';
      const text = bytes.toString(encoding);
      let count = 0;
      const updated = text.replace(patternFor(sdk), (_, prefix, suffix) => { count++; return prefix + accountId + suffix; });
      if (!count) continue;
      found = true;
      const output = Buffer.from(updated, encoding);
      if (bigEndian) output.swap16();
      edits.set(item.full, { output, original, relative: item.relative, count });
    }
    if (!found) throw new Error(`Account ID setting missing for ${sdk}: expected ${rule}; checked ${matches.map(m => m.relative).join(', ') || 'no matching files'}`);
  }
  // Validate every required file before changing any of them.
  for (const [file, edit] of edits) {
    if (!edit.original.equals(edit.output)) fs.writeFileSync(file, edit.output);
    if (!fs.readFileSync(file).equals(edit.output)) throw new Error(`SDK account ID verification failed: ${edit.relative}`);
  }
  return { accountId, updated: true, files: [...edits.values()].map(e => e.relative) };
}
module.exports = { updateSdkAccountId };

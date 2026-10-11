const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeAccount } = require('./accounts');
const { extractDomain } = require('./domain');

const fields = ['accountName', 'beLogin', 'integrationAccountNumber', 'url', 'cmsDetails'];
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function revision(accounts) {
  return crypto.createHash('sha256').update(JSON.stringify(accounts)).digest('hex');
}
function cleanCapture(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Capture is required');
  const result = {};
  for (const field of [...fields, 'salesforceRecordId', 'sourceUrl', 'cmsLanguage', 'cmsLanguageDetails']) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') throw new Error(`${field} must be text`);
    result[field] = (raw[field] || '').trim();
    if (result[field].length > 10000) throw new Error(`${field} is too long`);
  }
  const source = new URL(result.sourceUrl);
  if (source.protocol !== 'https:' || !/^[a-z0-9-]+\.lightning\.force\.com$/.test(source.hostname)) throw new Error('Use a Salesforce Lightning record');
  const record = source.pathname.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view\/?$/);
  if (!record || record[1] !== result.salesforceRecordId) throw new Error('Capture must include the current Salesforce record ID');
  result.sourceUrl = source.origin + source.pathname;
  result.sourceOrg = source.hostname;
  if (!result.accountName) throw new Error('BE Integration Name is required');
  if (result.beLogin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.beLogin)) throw new Error('Check the BE login email');
  if (result.integrationAccountNumber && !/^\d{1,14}$/.test(result.integrationAccountNumber)) throw new Error('Org ID must contain 1–14 digits');
  if (result.url && (!/^https?:\/\//i.test(result.url) || !extractDomain(result.url))) throw new Error('Mockup URL must be a valid HTTP or HTTPS website');
  return result;
}
function planImport(accounts, capture) {
  const sameRecord = accounts.filter(a => a.sourceOrg === capture.sourceOrg && a.salesforceRecordId?.slice(0, 15) === capture.salesforceRecordId.slice(0, 15));
  const candidates = sameRecord.length ? sameRecord : accounts.filter(a =>
    !a.salesforceRecordId && capture.integrationAccountNumber && capture.url &&
    a.integrationAccountNumber === capture.integrationAccountNumber && extractDomain(a.url) === extractDomain(capture.url));
  if (candidates.length > 1) throw new Error('Multiple matching accounts. Resolve duplicate rows in the dashboard before syncing.');
  const existing = candidates[0];
  // A partial identity match is not enough to safely create a second record.
  if (!existing && accounts.some(a => !a.salesforceRecordId && capture.integrationAccountNumber && a.integrationAccountNumber === capture.integrationAccountNumber)) {
    throw new Error('This org ID already exists with a different or missing domain. Correct the dashboard row before syncing.');
  }
  const changes = fields.filter(field => capture[field] && capture[field] !== (existing?.[field] || ''))
    .map(field => ({ field, before: existing?.[field] || '', after: capture[field] }));
  return { existing, index: existing ? accounts.indexOf(existing) : -1, changes };
}
function applyImport(accounts, capture, chosenFields = []) {
  const plan = planImport(accounts, capture);
  const next = { ...(plan.existing || {}) };
  for (const { field, before, after } of plan.changes) {
    if (!before || chosenFields.includes(field)) next[field] = after;
  }
  Object.assign(next, {
    id: next.id || `acc_${crypto.randomUUID()}`,
    salesforceRecordId: capture.salesforceRecordId, sourceOrg: capture.sourceOrg,
    sourceUrl: capture.sourceUrl, cmsLanguage: capture.cmsLanguage,
    cmsLanguageDetails: capture.cmsLanguageDetails, lastCapturedAt: new Date().toISOString()
  });
  // Preserve operator-selected integration and SDK, plus provisioning results.
  const normalized = normalizeAccount(next);
  const result = [...accounts];
  if (plan.index < 0) result.push(normalized); else result[plan.index] = normalized;
  return { accounts: result, account: normalized, action: plan.existing ? 'updated' : 'added' };
}
module.exports = { atomicWrite, revision, cleanCapture, planImport, applyImport };

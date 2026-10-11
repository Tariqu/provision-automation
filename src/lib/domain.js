function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function extractDomain(value) {
  if (!value) return '';

  try {
    const hostname = new URL(normalizeUrl(value)).hostname;
    const domain = hostname.replace(/^www\./i, '').toLowerCase();
    if (domain.length > 253 || !domain.includes('.') || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return '';
    return domain;
  } catch (error) {
    return '';
  }
}

function folderCandidates(value) {
  const domain = extractDomain(value);
  if (!domain) return [];

  const parts = domain.split('.');
  const shortName = parts.length > 1 ? parts.slice(0, -1).join('.') : domain;
  const firstLabel = parts[0];

  return [...new Set([shortName, domain, firstLabel].filter(Boolean))];
}

module.exports = {
  extractDomain,
  folderCandidates,
  normalizeUrl
};

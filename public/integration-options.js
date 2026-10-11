// Labels and order match Command Console's integration_type values (0–13).
const integrationOptions = [
  "Unknown",
  "PHP (General)",
  "DotNet Core 2.X (General)",
  "Java",
  "Drupal 8 Module",
  "PHP (Drupal 7)",
  "PHP (Wordpress)",
  "DotNet FX 4.5 (General)",
  "DotNet FX 4.5 (DNN)",
  "DotNet FX 4.5 (SiteCore)",
  "DotNet FX 4.5 (SiteFinity)",
  "DotNet FX 4.5 (nopCommerce)",
  "JavaScript",
  "Custom Integration"
];
function normalizeIntegrationOption(type, cms = '') {
  if (integrationOptions.includes(type)) return type;
  if (type === 'PHP') {
    if (/wordpress/i.test(cms)) return 'PHP (Wordpress)';
    if (/drupal\s*8/i.test(cms)) return 'Drupal 8 Module';
    if (/drupal\s*7/i.test(cms)) return 'PHP (Drupal 7)';
    return 'PHP (General)';
  }
  if (type === 'Sitecore') return 'DotNet FX 4.5 (SiteCore)';
  return 'Unknown';
}
if (typeof module !== 'undefined') module.exports = { integrationOptions, normalizeIntegrationOption };

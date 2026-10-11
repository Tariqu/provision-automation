const CLIENT_SIDE_HINTS = [
  'react',
  'angular',
  'vue',
  'next.js',
  'nextjs',
  'nuxt',
  'svelte',
  'spa',
  'single page'
];

const SERVER_SIDE_RULES = [
  { type: 'PHP', hints: ['wordpress', 'drupal', 'php'] },
  { type: 'Liquid', hints: ['shopify', 'liquid'] },
  { type: 'AEM', hints: ['aem', 'adobe experience manager'] },
  { type: 'Sitecore', hints: ['sitecore'] },
  { type: 'Server Side', hints: ['java', 'jsp', 'asp.net', '.net', 'rails'] }
];

function includesAny(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

function detectIntegrationType(cmsDetails = '', detectedTech = '') {
  const text = `${cmsDetails} ${detectedTech}`.toLowerCase();

  if (includesAny(text, CLIENT_SIDE_HINTS)) {
    return {
      type: 'JavaScript',
      confidence: 'high',
      reason: 'Client-side framework detected'
    };
  }

  for (const rule of SERVER_SIDE_RULES) {
    if (includesAny(text, rule.hints)) {
      return {
        type: rule.type,
        confidence: 'medium',
        reason: `Matched ${rule.type} CMS/platform hint`
      };
    }
  }

  return {
    type: 'Server Side',
    confidence: 'low',
    reason: 'No client-side framework found; defaulting to server-side'
  };
}

module.exports = {
  CLIENT_SIDE_HINTS,
  detectIntegrationType
};

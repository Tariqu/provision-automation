/* Runs only after Capture is clicked. No Salesforce cookies or credentials are read. */
async function extractSalesforceRecord() {
  const record = location.pathname.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view\/?$/);
  if (!/^[a-z0-9-]+\.lightning\.force\.com$/.test(location.hostname) || !record) {
    throw new Error('Open a Salesforce Lightning BE Integration record, then capture again.');
  }
  const labels = {
    accountName: 'BE Integration Name', beLogin: 'BE Login from Account level',
    integrationAccountNumber: 'Integration Account Numbers', url: 'Page URL for Mockup',
    cmsLanguage: 'CMS/Language', cmsLanguageDetails: 'CMS/Language Details'
  };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  function all(root, selector) {
    const found = [...root.querySelectorAll(selector)];
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) found.push(...all(element.shadowRoot, selector));
    return found;
  }
  function visible(element) {
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  }
  function read() {
    const result = {}, warnings = [], missing = [];
    const nodes = all(document, '.test-id__field-label, .slds-form-element__label, .labelCol, label');
    for (const [field, label] of Object.entries(labels)) {
      const values = new Set();
      let foundLabel = false;
      for (const node of nodes.filter(node => visible(node) && clean(node.textContent).replace(/\s*\*$/, '') === label)) {
        foundLabel = true;
        let container = node.closest('.slds-form-element, .forcePageBlockItem, .form-element');
        if (!container) container = node.parentElement;
        let valueNodes = [];
        for (let depth = 0; container && depth < 4; depth++) {
          valueNodes = all(container, '.test-id__field-value, .slds-form-element__static, .dataCol').filter(visible);
          if (valueNodes.length) break;
          // Do not escape this field into a multi-field section.
          const parent = container.parentElement || container.getRootNode().host;
          if (parent && all(parent, '.test-id__field-label, .slds-form-element__label').filter(visible).length > 1) break;
          container = parent;
        }
        for (const valueNode of valueNodes) {
          const clone = valueNode.cloneNode(true);
          clone.querySelectorAll('button, .slds-assistive-text').forEach(element => element.remove());
          let value = clean(clone.textContent);
          if (field === 'url') {
            const link = all(valueNode, 'a[href]').find(a => /^https?:\/\//i.test(a.getAttribute('href')));
            if (link) value = link.href;
          }
          // Open shadow roots may hold formatted values with no light-DOM text.
          if (!value) value = clean(all(valueNode, 'lightning-formatted-text, lightning-formatted-email, lightning-formatted-url, a').map(el => el.textContent).join(' '));
          if (value && value !== '—') values.add(value);
        }
      }
      if (values.size > 1) {
        result[field] = ''; warnings.push(`Multiple values for ${label}. Verify the active record and enter the correct value.`);
      } else result[field] = [...values][0] || '';
      if (!foundLabel) missing.push(label);
    }
    if (missing.length) warnings.push(`Not loaded or unavailable: ${missing.join(', ')}. Open the Details tab and expand the relevant sections, or fill the fields below.`);
    result.cmsDetails = [result.cmsLanguage, result.cmsLanguageDetails].filter(Boolean).join(' — ');
    if (/migrat|headless|new build|golive|go.live/i.test(result.cmsDetails)) warnings.push('CMS notes mention a migration or headless build. Confirm the current integration and SDK in the dashboard.');
    return { ...result, warnings, salesforceRecordId: record[1], sourceUrl: location.origin + location.pathname, capturedAt: new Date().toISOString() };
  }
  let capture;
  for (let attempt = 0; attempt < 8; attempt++) {
    capture = read();
    if (capture.accountName) return capture;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (!capture.accountName && !capture.beLogin && !capture.integrationAccountNumber) throw new Error('Record fields are not available yet. Open Details, expand the sections, wait for loading to finish, then capture again.');
  return capture;
}
if (typeof module !== 'undefined') module.exports = { extractSalesforceRecord };

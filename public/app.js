/**
 * Account Provisioning Studio - Client Controller
 * Reactive store, inline grid editing, live CMS detection, bulk import, & execution stepper.
 */

// Integration Classification Rules (Matching src/lib/integration.js)
const CLIENT_SIDE_HINTS = ['react', 'angular', 'vue', 'next.js', 'nextjs', 'nuxt', 'svelte', 'spa', 'single page'];
const SERVER_SIDE_RULES = [
  { type: 'PHP', hints: ['wordpress', 'drupal', 'php'] },
  { type: 'Liquid', hints: ['shopify', 'liquid'] },
  { type: 'AEM', hints: ['aem', 'adobe experience manager'] },
  { type: 'Sitecore', hints: ['sitecore'] },
  { type: 'Server Side', hints: ['java', 'jsp', 'asp.net', '.net', 'rails'] }
];

function detectIntegrationType(cmsDetails = '') {
  const text = String(cmsDetails || '').toLowerCase();
  if (CLIENT_SIDE_HINTS.some((hint) => text.includes(hint))) {
    return { type: 'JavaScript', reason: 'Client-side framework detected' };
  }
  for (const rule of SERVER_SIDE_RULES) {
    if (rule.hints.some((hint) => text.includes(hint))) {
      return { type: normalizeIntegrationOption(rule.type, cmsDetails), reason: `Matched ${rule.type} CMS hint` };
    }
  }
  return { type: 'Unknown', reason: 'Choose an integration type' };
}

// App State
const state = {
  accounts: [],
  selectedIds: new Set(),
  pendingRunIds: null,
  isDirty: false,
  isRunning: false,
  logsOpen: false
};

// DOM References
const elements = {
  accountTable: document.getElementById('accountTable'),
  accountTableBody: document.getElementById('accountTableBody'),
  emptyState: document.getElementById('emptyState'),
  totalCount: document.getElementById('totalCount'),
  readyCount: document.getElementById('readyCount'),
  incompleteCount: document.getElementById('incompleteCount'),
  saveStatus: document.getElementById('saveStatus'),
  btnAddRow: document.getElementById('btnAddRow'),
  btnBulkPaste: document.getElementById('btnBulkPaste'),
  btnSaveAccounts: document.getElementById('btnSaveAccounts'),
  btnRunDry: document.getElementById('btnRunDry'),
  bulkModal: document.getElementById('bulkModal'),
  btnCloseBulkModal: document.getElementById('btnCloseBulkModal'),
  btnCancelBulk: document.getElementById('btnCancelBulk'),
  btnApplyBulk: document.getElementById('btnApplyBulk'),
  bulkInput: document.getElementById('bulkInput'),
  bulkParseCount: document.getElementById('bulkParseCount'),
  chkReplaceExisting: document.getElementById('chkReplaceExisting'),
  confirmRunModal: document.getElementById('confirmRunModal'),
  btnCloseConfirmModal: document.getElementById('btnCloseConfirmModal'),
  btnCancelRun: document.getElementById('btnCancelRun'),
  btnProceedRun: document.getElementById('btnProceedRun'),
  confirmCount: document.getElementById('confirmCount'),
  resultsSection: document.getElementById('resultsSection'),
  resultsTitle: document.getElementById('resultsTitle'),
  resultsSummary: document.getElementById('resultsSummary'),
  resultsStats: document.getElementById('resultsStats'),
  executionCards: document.getElementById('executionCards'),
  runSpinner: document.getElementById('runSpinner'),
  toggleLogs: document.getElementById('toggleLogs'),
  logsChevron: document.getElementById('logsChevron'),
  logsBody: document.getElementById('logsBody'),
  logsContent: document.getElementById('logsContent'),
  logFileName: document.getElementById('logFileName'),
  btnRefreshLogs: document.getElementById('btnRefreshLogs'),
  toastsContainer: document.getElementById('toastsContainer')
};

// Helpers
function generateId() {
  return 'acc_' + Math.random().toString(36).substring(2, 9);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastsContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function validWebsite(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw || (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))) return false;
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return !url.username && !url.password && url.hostname.length <= 253 && url.hostname.includes('.') && url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  } catch { return false; }
}

function validateAccount(account) {
  const missing = [];
  if (!account.accountName || !account.accountName.trim()) missing.push('Account Name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.beLogin || '')) missing.push('Valid BE Login Email');
  if (!account.integrationAccountNumber || !String(account.integrationAccountNumber).trim()) missing.push('Org ID');
  if (!validWebsite(account.url)) missing.push('Valid Website URL');
  if (!sdkFolderOptions.includes(account.sdkFolder)) missing.push('SDK Folder');
  if (!generatedAccountId(account.integrationAccountNumber)) missing.push('Valid Org ID (1–14 digits)');
  return missing;
}

function markDirty(dirty = true) {
  state.isDirty = dirty;
  if (dirty) {
    elements.saveStatus.textContent = 'Unsaved changes';
    elements.saveStatus.className = 'save-status-text is-dirty';
  } else {
    elements.saveStatus.textContent = 'All changes saved';
    elements.saveStatus.className = 'save-status-text';
  }
}

// Render Functions
function updateMetrics() {
  const total = state.accounts.length;
  let ready = 0;

  state.accounts.forEach((acc) => {
    const missing = validateAccount(acc);
    acc.missingFields = missing;
    if (missing.length === 0 && acc.provisioningStatus !== 'Provisioned') ready++;
  });

  const incomplete = state.accounts.filter(acc => acc.missingFields.length > 0).length;
  elements.totalCount.textContent = total;
  elements.readyCount.textContent = ready;
  elements.incompleteCount.textContent = incomplete;

  if (total === 0) {
    elements.accountTable.style.display = 'none';
    elements.emptyState.style.display = 'block';
  } else {
    elements.accountTable.style.display = 'table';
    elements.emptyState.style.display = 'none';
  }
}

function updateSelectionControls() {
  const ids = new Set(state.accounts.map(a => a.id));
  state.selectedIds = new Set([...state.selectedIds].filter(id => ids.has(id)));
  document.getElementById('selectionCount').textContent = `${state.selectedIds.size} selected`;
  document.getElementById('btnRunSelected').disabled = state.isRunning || !state.selectedIds.size;
  document.getElementById('btnRetryFailed').hidden = !state.accounts.some(a => a.provisioningStatus === 'Failed');
  document.getElementById('btnRetryFailed').disabled = state.isRunning || !state.accounts.some(a => a.provisioningStatus === 'Failed');
  const all = document.getElementById('selectAllAccounts');
  all.checked = ids.size > 0 && state.selectedIds.size === ids.size;
  all.indeterminate = state.selectedIds.size > 0 && !all.checked;
}

function readinessMarkup(account) {
  const missing = validateAccount(account);
  if (!missing.length && account.provisioningStatus === 'Provisioned') return '<span class="readiness ready-input">Completed</span>';
  return `<span class="readiness ${missing.length ? 'needs-input' : 'ready-input'}">${missing.length ? 'Needs input' : 'Ready to run'}</span>`;
}

function renderTable() {
  elements.accountTableBody.innerHTML = '';
  updateMetrics();

  state.accounts.forEach((account, index) => {
    const tr = document.createElement('tr');
    tr.dataset.id = account.id;
    const isReady = account.missingFields.length === 0;
    const isProvisioned = account.provisioningStatus === 'Provisioned';
    if (!isReady) tr.classList.add('row-invalid');

    account.integrationType = normalizeIntegrationOption(account.integrationType, account.cmsDetails);
    const techClass = 'tech-' + String(account.integrationType || 'serverside').toLowerCase().replace(/[^a-z0-9]/g, '');

    tr.innerHTML = `
      <td class="col-num"><input type="checkbox" data-action="select-account" aria-label="Select ${escapeHtml(account.accountName || 'account')}" ${state.selectedIds.has(account.id) ? 'checked' : ''}></td>
      <td class="col-status">
        <span class="provision-status ${account.provisioningStatus === 'Failed' ? 'is-failed' : ''}">${escapeHtml(account.provisioningStatus || 'Pending')}</span>
        <span class="readiness-wrap">${readinessMarkup(account)}</span>
      </td>
      <td class="col-name">
        <input type="text" class="cell-input ${!account.accountName ? 'input-invalid' : ''}"
               data-field="accountName" value="${escapeHtml(account.accountName || '')}" placeholder="e.g. Acme Corp">
        ${/^https:\/\/[a-z0-9-]+\.lightning\.force\.com\/lightning\/r\//.test(account.sourceUrl || '') ? `<a class="account-source" href="${escapeHtml(account.sourceUrl)}" target="_blank" rel="noopener">Salesforce record ↗</a>` : ''}
      </td>
      <td class="col-login">
        <input type="email" class="cell-input ${!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.beLogin || '') ? 'input-invalid' : ''}"
               data-field="beLogin" value="${escapeHtml(account.beLogin || '')}" placeholder="admin@acme.com">
      </td>
      <td class="col-org">
        <input type="text" class="cell-input ${!account.integrationAccountNumber ? 'input-invalid' : ''}"
               data-field="integrationAccountNumber" value="${escapeHtml(account.integrationAccountNumber || '')}" placeholder="123456789">
      <div class="dropbox-cell generated-cell">
        <code class="generated-id">${generatedAccountId(account.integrationAccountNumber) || '—'}</code>
        <button type="button" class="btn-copy" data-action="copy-account-id" title="Copy generated account ID" ${generatedAccountId(account.integrationAccountNumber) ? '' : 'disabled'}>Copy</button>
      </div></td>
      <td class="col-url">
        <input type="text" class="cell-input ${!validWebsite(account.url) ? 'input-invalid' : ''}"
               data-field="url" value="${escapeHtml(account.url || '')}" placeholder="https://acme.com">
      </td>
      <td class="col-cms">
        <input type="text" class="cell-input"
               data-field="cmsDetails" value="${escapeHtml(account.cmsDetails || '')}" placeholder="e.g. WordPress, React">
      </td>
      <td class="col-tech">
        <select class="tech-select ${techClass}" data-field="integrationType">
          ${integrationOptions.map(type => `<option value="${type}" ${account.integrationType === type ? 'selected' : ''}>${type}</option>`).join('')}
        </select>
      </td>
      <td class="col-sdk"><select class="tech-select" data-field="sdkFolder" aria-label="SDK Template Folder">
        <option value="">Choose SDK folder</option>
        ${sdkFolderOptions.map(name => `<option value="${name}" ${account.sdkFolder === name ? 'selected' : ''}>${name}</option>`).join('')}
      </select><span class="sdk-validation" role="status">${sdkFolderOptions.includes(account.sdkFolder) ? '' : 'Select an SDK folder'}</span></td>
      <td class="col-dropbox">
        <select class="tech-select" data-field="folderLayout" aria-label="Dropbox folder layout">
          <option value="standard" ${account.folderLayout !== 'domain' ? 'selected' : ''}>Client folder</option>
          <option value="domain" ${account.folderLayout === 'domain' ? 'selected' : ''}>Domain subfolder</option>
        </select>
        <button type="button" class="btn-copy" data-action="preview-folder">Preview destination</button>
        <div class="folder-preview" role="status" style="white-space:normal;overflow-wrap:anywhere"></div>
        ${account.dropboxLink ? `
          <div class="dropbox-cell">
            <span class="dropbox-path" title="${escapeHtml(account.dropboxLink)}">${escapeHtml(account.dropboxLink.split(/[\\/]/).filter(Boolean).pop())}</span>
            <button type="button" class="btn-copy" data-action="copy-dropbox" data-path="${escapeHtml(account.dropboxLink)}" title="Copy Dropbox folder path">Copy path</button>
          </div>
        ` : `<span style="color:#94a3b8; font-size:12px;">—</span>`}
      </td>
      <td class="col-actions">
        <div class="row-actions-group">
          <button type="button" class="btn-icon btn-details" title="View and edit account details" data-action="details">Details</button>
          <button type="button" class="btn-icon btn-delete" title="Delete row" data-action="delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;

    tr.querySelectorAll('input[data-field]').forEach(input => {
      input.title = input.value;
      if (['accountName', 'beLogin', 'url'].includes(input.dataset.field)) {
        const preview = document.createElement('span');
        preview.className = 'field-preview';
        preview.textContent = input.value;
        input.after(preview);
      }
    });
    elements.accountTableBody.appendChild(tr);
  });
  updateSelectionControls();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline Table Event Handlers
elements.accountTableBody.addEventListener('input', (e) => {
  const target = e.target;
  const tr = target.closest('tr');
  if (!tr) return;

  const id = tr.dataset.id;
  const field = target.dataset.field;
  const account = state.accounts.find((a) => a.id === id);
  if (!account || !field) return;

  target.title = target.value;
  if (target.nextElementSibling?.classList.contains('field-preview')) target.nextElementSibling.textContent = target.value;
  account[field] = target.value;
  if (field === 'integrationAccountNumber') {
    const generated = generatedAccountId(target.value);
    tr.querySelector('.generated-id').textContent = generated || '—';
    tr.querySelector('[data-action="copy-account-id"]').disabled = !generated;
  }

  // Auto-detect CMS if cmsDetails was changed
  if (field === 'cmsDetails') {
    const detected = detectIntegrationType(target.value);
    account.integrationType = detected.type;
    const select = tr.querySelector('select[data-field="integrationType"]');
    if (select) {
      select.value = detected.type;
      select.className = 'tech-select tech-' + detected.type.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
  }

  // Update input error status visually without re-rendering entire table
  if (target.classList.contains('cell-input')) {
    if (['accountName', 'beLogin', 'integrationAccountNumber', 'url'].includes(field)) {
      const valid = field === 'beLogin' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.value) : field === 'url' ? validWebsite(target.value) : field === 'integrationAccountNumber' ? !!generatedAccountId(target.value) : !!target.value.trim();
      if (!valid) {
        target.classList.add('input-invalid');
      } else {
        target.classList.remove('input-invalid');
      }
    }
  }

  // Live update row badge
  const missing = validateAccount(account);
  account.missingFields = missing;
  tr.querySelector('.readiness-wrap').innerHTML = readinessMarkup(account);
  tr.classList.toggle('row-invalid', missing.length > 0);
  const sdkHint = tr.querySelector('.sdk-validation');
  sdkHint.textContent = sdkFolderOptions.includes(account.sdkFolder) ? '' : 'Select an SDK folder';
  markDirty(true);
  updateMetrics();
});

elements.accountTableBody.addEventListener('change', (e) => {
  const target = e.target;
  if (target.dataset.action === 'select-account') {
    const id = target.closest('tr').dataset.id;
    if (target.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
    updateSelectionControls();
    return;
  }
  if (target.tagName === 'SELECT') {
    const tr = target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return;
    account[target.dataset.field] = target.value;
    updateMetrics();
    target.className = 'tech-select tech-' + target.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    markDirty(true);
  }
});

// Keyboard navigation: Enter on the last input field adds new row
elements.accountTableBody.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const target = e.target;
    if (target.dataset.field === 'cmsDetails') {
      e.preventDefault();
      addNewRow(true);
    }
  }
});

// Table Action Buttons (Duplicate, Delete)
elements.accountTableBody.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const tr = button.closest('tr');
  const id = tr.dataset.id;
  const index = state.accounts.findIndex((a) => a.id === id);
  if (index === -1) return;

  const action = button.dataset.action;
  if (action === 'details') { openAccountDetails(state.accounts[index]); return; }
  if (action === 'copy-account-id') {
    const value = generatedAccountId(state.accounts[index].integrationAccountNumber);
    if (value) navigator.clipboard.writeText(value).then(() => showToast('Account ID copied', 'success')).catch(() => showToast('Could not copy. Select the displayed ID and copy it manually.', 'error'));
    return;
  }
  if (action === 'copy-dropbox') {
    const path = button.dataset.path;
    if (path) {
      navigator.clipboard.writeText(path).then(() => {
        showToast('Copied Dropbox path to clipboard!', 'info');
      }).catch(() => {
        showToast(`Dropbox path: ${path}`, 'info');
      });
    }
    return;
  }

  if (action === 'delete') {
    state.accounts.splice(index, 1);
    markDirty(true);
    renderTable();
  }
});

function addNewRow(focus = false) {
  const newAccount = {
    id: generateId(),
    accountName: '',
    beLogin: '',
    integrationAccountNumber: '',
    url: '',
    cmsDetails: '',
    integrationType: 'Unknown',
    provisioningStatus: 'Pending',
    dropboxLink: '',
    missingFields: ['Account Name', 'BE Login', 'Org ID', 'Website URL']
  };
  state.accounts.push(newAccount);
  markDirty(true);
  renderTable();

  if (focus) {
    const rows = elements.accountTableBody.querySelectorAll('tr');
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const firstInput = lastRow.querySelector('input');
      if (firstInput) firstInput.focus();
    }
  }
}

// Bulk Paste Parser
function parseBulkData(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];

  // Check if JSON
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.accounts || [parsed]);
      return list.map((item) => ({
        id: generateId(),
        accountName: item.accountName || item.name || item.Account || '',
        beLogin: item.beLogin || item.email || '',
        integrationAccountNumber: item.integrationAccountNumber || item.orgId || '',
        url: item.url || item.domain || '',
        cmsDetails: item.cmsDetails || item.cms || '',
        sdkFolder: item.sdkFolder || '',
      folderLayout: item.folderLayout || 'standard',
      integrationType: item.integrationType || detectIntegrationType(item.cmsDetails || item.cms).type,
        provisioningStatus: item.provisioningStatus || item.status || 'Pending',
        dropboxLink: item.dropboxLink || item.dropbox || item.folder || '',
        missingFields: []
      }));
    } catch (_) {}
  }

  // Parse TSV (Tab separated, common from Excel/Sheets) or CSV
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check delimiter
    const delimiter = line.includes('\t') ? '\t' : ',';
    const cols = line.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim());

    // Skip potential header row
    if (i === 0 && (
      cols[0].toLowerCase().includes('account') ||
      cols[1]?.toLowerCase().includes('email') ||
      cols[1]?.toLowerCase().includes('login')
    )) {
      continue;
    }

    if (!cols.length || (!cols[0] && !cols[1])) continue;

    const cms = cols[4] || '';
    const detected = detectIntegrationType(cms);

    results.push({
      id: generateId(),
      accountName: cols[0] || '',
      beLogin: cols[1] || '',
      integrationAccountNumber: cols[2] || '',
      url: cols[3] || '',
      cmsDetails: cms,
      sdkFolder: cols[8] || '',
      integrationType: cols[5] || detected.type,
      provisioningStatus: cols[6] || 'Pending',
      dropboxLink: cols[7] || '',
      missingFields: []
    });
  }

  return results;
}

// Bulk Modal Handlers
elements.btnBulkPaste.addEventListener('click', () => {
  elements.bulkInput.value = '';
  elements.bulkParseCount.textContent = '0 rows recognized';
  elements.bulkModal.style.display = 'flex';
  elements.bulkInput.focus();
});

elements.btnCloseBulkModal.addEventListener('click', () => {
  elements.bulkModal.style.display = 'none';
});

elements.btnCancelBulk.addEventListener('click', () => {
  elements.bulkModal.style.display = 'none';
});

elements.bulkInput.addEventListener('input', () => {
  const parsed = parseBulkData(elements.bulkInput.value);
  elements.bulkParseCount.textContent = `${parsed.length} account(s) recognized`;
});

elements.btnApplyBulk.addEventListener('click', () => {
  const parsed = parseBulkData(elements.bulkInput.value);
  if (!parsed.length) {
    showToast('No valid accounts found in pasted content', 'error');
    return;
  }

  if (elements.chkReplaceExisting.checked) {
    state.accounts = parsed;
  } else {
    state.accounts = [...state.accounts, ...parsed];
  }

  elements.bulkModal.style.display = 'none';
  markDirty(true);
  renderTable();
  showToast(`Successfully imported ${parsed.length} account(s)`, 'success');
});

// API Operations
async function loadAccountsFromDisk() {
  try {
    const res = await fetch('/api/accounts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = data.accounts || [];
    state.revision = data.revision;
    state.baseline = structuredClone(list);

    state.accounts = list.map((item) => ({
      ...item,
      id: item.id || generateId(),
      accountName: item.accountName || '',
      beLogin: item.beLogin || '',
      integrationAccountNumber: item.integrationAccountNumber || '',
      url: item.url || item.domain || '',
      cmsDetails: item.cmsDetails || '',
      sdkFolder: item.sdkFolder || '',
      folderLayout: item.folderLayout || 'standard',
      integrationType: item.integrationType || detectIntegrationType(item.cmsDetails).type,
      provisioningStatus: item.provisioningStatus || item.status || 'Pending',
      dropboxLink: item.dropboxLink || '',
      missingFields: []
    }));

    markDirty(false);
    renderTable();
    showToast(`Loaded ${state.accounts.length} account(s) from ${data.source || 'disk'}`, 'info');
  } catch (err) {
    showToast(`Failed to load accounts: ${err.message}`, 'error');
  }
}

async function saveAccountsToDisk() {

  try {
    elements.btnSaveAccounts.disabled = true;
    const savedSnapshot = JSON.stringify(state.accounts);
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: state.accounts, revision: state.revision })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.revision = data.revision;
    state.baseline = structuredClone(data.accounts);

    markDirty(JSON.stringify(state.accounts) !== savedSnapshot);
    showToast(`Saved ${state.accounts.length} account(s) to data/accounts.json`, 'success');
    return true;
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
    return false;
  } finally {
    elements.btnSaveAccounts.disabled = false;
  }
}

// Provisioning Stepper Execution
async function executeProvisioning(dryRun = true, runIds = null) {
  const runAccounts = state.accounts.filter(a => !runIds || runIds.includes(a.id));
  if (state.isRunning) return;
  if (runAccounts.length === 0) {
    showToast('Add at least one account to proceed', 'error');
    return;
  }

  // Preflight validation check
  const invalid = runAccounts.filter((a) => validateAccount(a).length > 0);
  if (invalid.length > 0 && !dryRun) {
    showToast(`Cannot run live: ${invalid.length} account(s) have missing required fields`, 'error');
    return;
  }

  // Auto-save before running
  if (!dryRun && state.isDirty) {
    if (!await saveAccountsToDisk()) return;
  }

  state.isRunning = true;
  setControlsDisabled(true);

  // Setup Results UI
  elements.resultsSection.style.display = 'block';
  elements.resultsSection.scrollIntoView({ behavior: 'smooth' });
  elements.runSpinner.style.display = 'block';
  elements.resultsTitle.textContent = dryRun ? 'Simulating Provisioning (Dry Run)' : 'Executing Live Provisioning';
  elements.resultsSummary.textContent = `Processing ${runAccounts.length} account(s)...`;
  elements.resultsStats.innerHTML = '';
  elements.executionCards.innerHTML = '';

  // Render initial pending cards
  runAccounts.forEach((acc) => {
    const card = document.createElement('div');
    card.className = 'exec-card';
    card.id = `card_${acc.id}`;
    card.innerHTML = `
      <div class="exec-card-header">
        <div class="exec-card-title">
          <span>${escapeHtml(acc.accountName || 'Unnamed')}</span>
          <span class="tech-pill tech-${String(acc.integrationType || 'serverside').toLowerCase()}">${acc.integrationType || 'Server Side'}</span>
        </div>
        <span class="status-badge" style="background:#f1f5f9; color:#64748b;">⏳</span>
      </div>
      <div class="exec-steps-stepper">
        <div class="step-node"><div class="step-header">1. Account Data</div><div class="step-desc">Pending...</div></div>
        <div class="step-node"><div class="step-header">2. Classification</div><div class="step-desc">Pending...</div></div>
        <div class="step-node"><div class="step-header">3. BE Site Agent</div><div class="step-desc">Pending...</div></div>
        <div class="step-node"><div class="step-header">4. CC Provisioning</div><div class="step-desc">Pending...</div></div>
        <div class="step-node"><div class="step-header">5. Dropbox Folder</div><div class="step-desc">Pending...</div></div>
        <div class="step-node"><div class="step-header">6. Update SDK Account ID</div><div class="step-desc">Pending...</div></div>
        <div class="step-node"><div class="step-header">7. UI Status & Dropbox</div><div class="step-desc">Pending...</div></div>
      </div>
    `;
    elements.executionCards.appendChild(card);
  });

  try {
    const res = await fetch('/api/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dryRun,
        revision: state.revision,
        skipSalesforceUpdate: true,
        accounts: runAccounts
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Update local accounts with status and Dropbox link directly in UI
    if (!dryRun) {
      (data.results || []).forEach((resItem) => {
        const resAcc = resItem.account || {};
        const matched = state.accounts.find((a) =>
          a.id === resAcc.id
        );
        if (matched) {
          matched.provisioningStatus = resItem.ok ? resAcc.provisioningStatus : 'Failed';
          matched.dropboxLink = resAcc.dropboxLink || resItem.steps?.folder?.folderPath || '';
        }
      });

      // Re-render table and persist updated statuses & Dropbox links to accounts.json
      renderTable();
      markDirty(true);
      await saveAccountsToDisk();
    }

    // Update Results UI with actual execution outcomes
    elements.resultsTitle.textContent = dryRun ? 'Dry check results' : 'Live run results';
    elements.runSpinner.style.display = 'none';
    elements.resultsSummary.textContent = dryRun ? 'Dry check complete. Account statuses and folders were not changed.' : 'Live run complete. Results updated in this UI.';

    elements.resultsStats.innerHTML = `
      <span class="stat-chip stat-ok">✓ ${data.okCount} Succeeded</span>
      ${data.failedCount > 0 ? `<span class="stat-chip stat-failed">✕ ${data.failedCount} Failed</span>` : ''}
    `;

    renderExecutionResults(data.results || [], dryRun);
    loadLatestLogs();
    showToast(data.ok ? (dryRun ? 'Dry check passed' : 'Provisioning completed & updated in UI!') : 'Provisioning completed with issues', data.ok ? 'success' : 'error');
  } catch (err) {
    elements.runSpinner.style.display = 'none';
    elements.resultsSummary.textContent = `Run failed: ${err.message}`;
    showToast(`Execution error: ${err.message}`, 'error');
  } finally {
    state.isRunning = false;
    setControlsDisabled(false);
  }
}

function renderExecutionResults(results, dryRun) {
  elements.executionCards.innerHTML = '';

  results.forEach((result) => {
    const acc = result.account || {};
    const steps = result.steps || {};
    const isOk = result.ok;

    const card = document.createElement('div');
    card.className = `exec-card ${isOk ? 'exec-ok' : 'exec-fail'}`;

    function stepNode(title, step, description) {
      const failed = Boolean(step?.error);
      const skipped = step?.resumed || step?.skipped || step?.alreadyEnabled;
      return { title, status: failed ? 'error' : step ? 'ok' : 'pending',
        label: failed ? 'Failed' : skipped ? 'Already completed — skipped' : step ? (dryRun ? 'Dry check passed' : 'Completed') : 'Not started',
        desc: failed ? step.error : step ? description : 'Waiting for earlier steps' };
    }
    const stepNodes = [
      stepNode('1. Account Data', steps.existingAccountCheck?.error ? steps.existingAccountCheck : steps.salesforceInput, `Validated (${acc.integrationAccountNumber || ''})`),
      stepNode('2. Classification', steps.salesforceInput ? {} : null, `${acc.integrationType || 'Unknown'}`),
      stepNode('3. BE Site Agent', steps.brightedgeSiteAgent, 'Site Agent enabled'),
      stepNode('4. CC Provisioning', steps.commandConsoleProvisioning, steps.commandConsoleProvisioning?.reason || `Org ${acc.integrationAccountNumber}`),
      stepNode('5. Dropbox Folder', steps.folder, dryRun ? `Source: ${steps.folder?.templatePath || ''}\nDestination: ${steps.folder?.sdkFolderPath || ''}` : steps.folder?.folderPath || ''),
      stepNode('6. Update SDK Account ID', steps.sdkAccountId, steps.sdkAccountId?.reason || `Account ID: ${steps.sdkAccountId?.accountId || ''}\n${(steps.sdkAccountId?.files || []).join(', ')}`),
      stepNode('7. Status & Folder Link', steps.salesforceUpdate, `Status: ${acc.provisioningStatus || ''}\nFolder: ${acc.dropboxLink || ''}`)
    ];

    card.innerHTML = `
      <div class="exec-card-header">
        <div class="exec-card-title">
          <span>${escapeHtml(acc.accountName || 'Unnamed')}</span>
          <span class="tech-pill tech-${String(acc.integrationType || 'serverside').toLowerCase()}">${acc.integrationType || 'Server Side'}</span>
          <span style="font-size:12px; color:#64748b; font-weight:normal;">Domain: ${escapeHtml(acc.domain || acc.url || '')}</span>
        </div>
        <span class="stat-chip ${isOk ? 'stat-ok' : 'stat-failed'}">
          ${isOk ? (dryRun ? 'Dry Check Passed' : 'Provisioned') : 'Failed'}
        </span>
      </div>
      <div class="exec-steps-stepper">
        ${stepNodes.map((s) => `
          <div class="step-node ${s.status === 'ok' ? 'step-success' : s.status === 'error' ? 'step-error' : 'step-pending'}">
            <div class="step-header">
              <span>${s.title}</span>
              <span class="step-state">${s.label}</span>
            </div>
            <div class="step-desc">${escapeHtml(s.desc)}</div>
          </div>
        `).join('')}
      </div>
      ${result.error ? `<div style="margin-top:10px; color:#dc2626; font-size:12px; font-weight:600;">Error: ${escapeHtml(result.error)}</div>` : ''}
    `;

    elements.executionCards.appendChild(card);
  });
}

function setControlsDisabled(disabled) {
  elements.btnAddRow.disabled = disabled;
  elements.btnBulkPaste.disabled = disabled;
  elements.btnSaveAccounts.disabled = disabled;
  elements.btnRunDry.disabled = disabled;
  elements.accountTable.querySelectorAll('input, select, button').forEach(control => { control.disabled = disabled; });
  if (!disabled) elements.accountTable.querySelectorAll('[data-action="copy-account-id"]').forEach(button => {
    const account = state.accounts.find(a => a.id === button.closest('tr').dataset.id);
    button.disabled = !generatedAccountId(account?.integrationAccountNumber);
  });
  updateSelectionControls();
}

// Logs Drawer
async function loadLatestLogs() {
  try {
    const res = await fetch('/api/logs/latest');
    const data = await res.json();
    if (data.fileName) {
      elements.logFileName.textContent = data.fileName;
    }
    const entries = data.entries || [];
    if (entries.length) {
      elements.logsContent.textContent = entries.map((e) => {
        const time = e.time ? `[${e.time.split('T')[1].slice(0, 8)}] ` : '';
        const level = e.level ? `[${e.level.toUpperCase()}] ` : '';
        return `${time}${level}${e.message || JSON.stringify(e)}`;
      }).join('\n');
      elements.logsBody.scrollTop = elements.logsBody.scrollHeight;
    }
  } catch (_) {}
}

elements.toggleLogs.addEventListener('click', (e) => {
  if (e.target.id === 'btnRefreshLogs') return;
  state.logsOpen = !state.logsOpen;
  elements.logsBody.style.display = state.logsOpen ? 'block' : 'none';
  elements.logsChevron.classList.toggle('open', state.logsOpen);
  if (state.logsOpen) loadLatestLogs();
});

elements.btnRefreshLogs.addEventListener('click', (e) => {
  e.stopPropagation();
  loadLatestLogs();
});

// Primary Toolbar Buttons
elements.btnAddRow.addEventListener('click', () => addNewRow(true));
elements.btnSaveAccounts.addEventListener('click', () => saveAccountsToDisk());
elements.btnRunDry.addEventListener('click', () => executeProvisioning(true));

function confirmRun(ids) {
  const accounts = state.accounts.filter(a => ids.includes(a.id));
  if (!accounts.length || state.isRunning) return;
  const invalid = accounts.filter(a => validateAccount(a).length);
  if (invalid.length) { showToast(`${invalid.length} selected account(s) need input. Complete the highlighted fields first.`, 'error'); return; }
  state.pendingRunIds = accounts.map(a => a.id);
  elements.confirmCount.textContent = accounts.length;
  elements.confirmRunModal.style.display = 'flex';
}
document.getElementById('btnRunSelected').addEventListener('click', () => confirmRun([...state.selectedIds]));
document.getElementById('btnRetryFailed').addEventListener('click', () => confirmRun(state.accounts.filter(a => a.provisioningStatus === 'Failed').map(a => a.id)));
document.getElementById('selectAllAccounts').addEventListener('change', event => {
  state.selectedIds = new Set(event.target.checked ? state.accounts.map(a => a.id) : []);
  renderTable();
});

elements.btnCloseConfirmModal.addEventListener('click', () => {
  elements.confirmRunModal.style.display = 'none';
});

elements.btnCancelRun.addEventListener('click', () => {
  elements.confirmRunModal.style.display = 'none';
});

elements.btnProceedRun.addEventListener('click', () => {
  elements.confirmRunModal.style.display = 'none';
  executeProvisioning(false, state.pendingRunIds);
});

// Warn user before leaving if unsaved changes exist
window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  loadAccountsFromDisk();
});
// Resolve on the server so previews use the same filesystem rules as a run.
elements.accountTableBody.addEventListener('click', async event => {
  const button = event.target.closest('[data-action="preview-folder"]');
  if (!button) return;
  const row = button.closest('tr');
  const account = state.accounts.find(item => item.id === row.dataset.id);
  const output = row.querySelector('.folder-preview');
  const snapshot = JSON.stringify(account);
  output.textContent = 'Checking destination…';
  try {
    const response = await fetch('/api/folder-preview', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({account})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (JSON.stringify(account) === snapshot) output.textContent = data.sdkFolderPath;
  } catch (error) { if (JSON.stringify(account) === snapshot) output.textContent = error.message; }
});
elements.accountTableBody.addEventListener('input', event => {
  const row = event.target.closest('tr');
  if (row && event.target.dataset.field) row.querySelector('.folder-preview').textContent = '';
});

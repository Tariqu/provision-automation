const accountDialog = document.createElement('dialog');
accountDialog.className = 'sync-dialog account-dialog';
accountDialog.setAttribute('aria-label', 'Account details');
document.body.append(accountDialog);
function openAccountDetails(account) {
  if (state.isRunning) return;
  accountDialog.replaceChildren();
  const header = document.createElement('div'); header.className = 'sync-dialog-head';
  const title = document.createElement('h2'); title.textContent = 'Account details';
  const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Close details'); close.onclick = () => accountDialog.close();
  header.append(title, close); accountDialog.append(header);
  const form = document.createElement('form'); form.noValidate = true;
  const controls = {};
  const labels = { accountName: 'BE Integration Name', beLogin: 'BE login email', integrationAccountNumber: 'Org ID / Account number', url: 'Website / Mockup URL', cmsDetails: 'CMS / Tech hints', integrationType: 'Command Console integration', sdkFolder: 'SDK template folder' };
  for (const [key, label] of Object.entries(labels)) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const control = document.createElement(['integrationType', 'sdkFolder'].includes(key) ? 'select' : ['accountName', 'cmsDetails'].includes(key) ? 'textarea' : 'input');
    control.name = key;
    if (control.tagName === 'SELECT') {
      const values = key === 'sdkFolder' ? ['', ...sdkFolderOptions] : integrationOptions;
      for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value || 'Choose SDK folder'; control.append(option); }
    }
    control.value = account[key] || '';
    if (control.tagName === 'TEXTAREA') control.rows = key === 'cmsDetails' ? 4 : 2;
    wrapper.append(control); form.append(wrapper); controls[key] = control;
  }
  controls.cmsDetails.oninput = () => { controls.integrationType.value = detectIntegrationType(controls.cmsDetails.value).type; };
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const read = () => ({ ...account, ...Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value.trim()])) });
  form.addEventListener('input', () => { const missing = validateAccount(read()); status.textContent = missing.length ? `Needs attention: ${missing.join(', ')}` : 'All required inputs are valid.'; });
  status.textContent = 'Changes apply to the queue. Use Save accounts to save them to Studio.';
  const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'btn btn-primary'; apply.textContent = 'Apply changes';
  form.append(status, apply);
  form.onsubmit = event => {
    event.preventDefault();
    if (state.isRunning) return;
    Object.assign(account, read()); markDirty(true); renderTable(); accountDialog.close();
  };
  accountDialog.append(form); accountDialog.showModal();
}

const syncBanner = document.getElementById('syncBanner');
const syncDialog = document.getElementById('syncDialog');
const syncContent = document.getElementById('syncContent');
const syncApply = document.getElementById('syncApply');
let mergeSnapshot = null;
async function refreshPairingStatus() {
  const label = document.getElementById('extensionStatus');
  try {
    const response = await fetch('/api/extension/status');
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    label.textContent = data.paired ? 'Extension paired with this Studio' : 'Extension not paired';
  } catch { label.textContent = 'Pairing status unavailable'; }
}
refreshPairingStatus();

document.getElementById('btnExtension').onclick = () => {
  document.getElementById('pairDialog').showModal();
};
document.querySelectorAll('[data-close-dialog]').forEach(button => button.onclick = () => button.closest('dialog').close());
document.getElementById('pairForm').onsubmit = async event => {
  event.preventDefault();
  const output = document.getElementById('pairOutput');
  try {
    const response = await fetch('/api/extension/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extensionId: document.getElementById('extensionId').value.trim() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    output.hidden = false;
    document.getElementById('pairToken').value = data.token;
    refreshPairingStatus();
    document.getElementById('pairMessage').textContent = 'Paste this connection key into the extension. Generating a new key replaces the previous connection.';
  } catch (error) { document.getElementById('pairMessage').textContent = error.message; }
};
document.getElementById('copyPairToken').onclick = async () => {
  try { await navigator.clipboard.writeText(document.getElementById('pairToken').value); showToast('Connection key copied', 'success'); }
  catch { document.getElementById('pairToken').select(); }
};
let checkingIncoming = false;
function canApplyIncoming() {
  return !state.isDirty && !state.isRunning && !elements.btnSaveAccounts.disabled &&
    !document.querySelector('dialog[open]') &&
    ![...document.querySelectorAll('.modal-backdrop')].some(modal => getComputedStyle(modal).display !== 'none') &&
    !document.activeElement?.matches('#accountTable input[data-field], #accountTable select');
}
async function checkIncoming() {
  if (checkingIncoming || !state.revision || state.isRunning || syncDialog.open) return;
  checkingIncoming = true;
  const requestedRevision = state.revision;
  try {
    const response = await fetch('/api/accounts', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const data = await response.json();
    // A save, run, or review may have completed while this request was in flight.
    if (state.revision !== requestedRevision || state.isRunning || syncDialog.open) return;
    syncBanner.hidden = data.revision === state.revision;
    if (!syncBanner.hidden && data.revision && Array.isArray(data.accounts) && canApplyIncoming()) {
      state.accounts = structuredClone(data.accounts);
      state.baseline = structuredClone(data.accounts);
      state.revision = data.revision;
      renderTable(); markDirty(false);
      syncBanner.hidden = true;
      showToast('Account queue updated from Studio.', 'success');
    }
  } catch { /* Existing editor stays available while offline. */ }
  finally { checkingIncoming = false; }
}
document.getElementById('reviewIncoming').onclick = async () => {
  if (state.isRunning) return showToast('Review incoming changes after the run finishes.', 'info');
  try {
    const response = await fetch('/api/accounts');
    if (!response.ok) throw new Error('Could not load incoming changes');
    mergeSnapshot = await response.json();
    const merged = mergeAccounts(state.baseline || [], state.accounts, mergeSnapshot.accounts);
    syncContent.replaceChildren();
    const description = document.createElement('p');
    description.textContent = merged.conflicts.length ? 'Choose which value to keep for each conflict. Other changes merge automatically.' : 'Incoming accounts and updates will merge with your current edits. Your unsaved changes are preserved.';
    syncContent.append(description);
    for (const conflict of merged.conflicts) {
      const card = document.createElement('label'); card.className = 'sync-conflict';
      const names = { accountName: 'BE Integration Name', beLogin: 'BE login email', integrationAccountNumber: 'Org ID', url: 'Mockup URL', cmsDetails: 'CMS / Tech hints', integrationType: 'Integration', sdkFolder: 'SDK folder' };
      const title = document.createElement('strong'); title.textContent = `${conflict.name} · ${names[conflict.field] || conflict.field}`;
      const select = document.createElement('select'); select.dataset.key = conflict.key;
      for (const [value, text] of [['local', `My edit: ${conflict.local}`], ['remote', `Incoming: ${conflict.remote}`]]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
      }
      card.append(title, select); syncContent.append(card);
    }
    syncDialog.showModal();
  } catch (error) { showToast(error.message, 'error'); }
};
syncApply.onclick = () => {
  const choices = Object.fromEntries([...syncContent.querySelectorAll('select')].map(select => [select.dataset.key, select.value]));
  state.accounts = mergeAccounts(state.baseline || [], state.accounts, mergeSnapshot.accounts, choices).accounts;
  state.baseline = structuredClone(mergeSnapshot.accounts);
  state.revision = mergeSnapshot.revision;
  renderTable(); markDirty(true);
  syncBanner.hidden = true; syncDialog.close();
  showToast('Changes merged. Save accounts when ready.', 'success');
};
setInterval(checkIncoming, 4000);
window.addEventListener('focus', checkIncoming);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkIncoming(); });

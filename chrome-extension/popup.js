const $ = id => document.getElementById(id);
const fields = ['accountName', 'beLogin', 'integrationAccountNumber', 'url', 'cmsDetails'];
const fieldNames = { accountName: 'BE Integration Name', beLogin: 'BE login email', integrationAccountNumber: 'Org ID', url: 'Page URL for Mockup', cmsDetails: 'CMS / Tech hints' };
let draft = null, plan = null, jobId = null;
const message = (text, success = false) => { $('message').hidden = false; $('message').textContent = text; $('message').className = success ? 'success' : ''; };
async function request(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) { const error = new Error(response?.error || 'Extension is unavailable. Reopen it and try again.'); error.offline = response?.offline; throw error; }
  return response;
}
function readForm() { return { ...draft, ...Object.fromEntries(fields.map(field => [field, $(field).value.trim()])) }; }
function showDraft(capture, id = null) {
  draft = capture; jobId = id; plan = null;
  document.body.classList.add('has-draft');
  for (const field of fields) $(field).value = capture[field] || '';
  $('review').hidden = false; $('changes').hidden = true; $('sync').textContent = 'Sync to Studio →';
  $('source').href = capture.sourceUrl;
  $('warnings').textContent = (capture.warnings || []).join('\n\n'); $('warnings').hidden = !capture.warnings?.length;
}
async function renderQueue() {
  const { queue = [] } = await chrome.storage.local.get('queue');
  $('queue').replaceChildren();
  if (!queue.length) { const text = document.createElement('p'); text.className = 'hint'; text.textContent = 'Your captures and sync status will appear here.'; $('queue').append(text); }
  for (const job of [...queue].reverse()) {
    const card = document.createElement('div'); card.className = 'queue-item';
    const title = document.createElement('strong'); title.textContent = job.capture.accountName;
    const meta = document.createElement('div'); meta.className = 'queue-meta';
    const badge = document.createElement('span'); badge.className = `status ${job.status}`; badge.textContent = { synced: 'Synced', pending: 'Pending', attention: 'Needs attention' }[job.status]; meta.append(badge);
    if (job.status !== 'synced') {
      const review = document.createElement('button'); review.className = 'text-button'; review.textContent = 'Review'; review.onclick = async () => { showDraft(job.capture, job.id); await chrome.storage.local.set({ draft, draftJobId: jobId }); $('review').scrollIntoView({ behavior: 'smooth' }); }; meta.append(review);
      const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = 'Remove'; remove.onclick = async () => { if (confirm('Remove this pending capture?')) { await request({ type: 'remove', jobId: job.id }); await renderQueue(); } }; meta.append(remove);
    }
    const detail = document.createElement('p'); detail.textContent = job.message; card.append(title, meta, detail); $('queue').append(card);
  }
}
async function health() {
  try { await request({ type: 'health' }); $('connectionStatus').textContent = 'Connected to local Studio'; $('connectionDot').classList.add('online'); }
  catch (error) { $('connectionStatus').textContent = error.offline ? 'Studio offline · captures stay here' : 'Connection needed'; $('connectionDot').classList.remove('online'); }
}
$('settingsToggle').onclick = () => { $('settings').hidden = !$('settings').hidden; };
$('copyId').onclick = async () => { await navigator.clipboard.writeText(chrome.runtime.id); message('Extension ID copied.', true); };
$('openStudio').onclick = async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.tabs.create({ url: settings?.baseUrl || 'http://localhost:3000' });
};
$('settingsForm').onsubmit = async event => {
  event.preventDefault();
  try {
    const url = new URL($('baseUrl').value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) throw new Error('Use http://localhost:3000 or your local Studio port.');
    await chrome.storage.local.set({ settings: { baseUrl: url.origin, token: $('token').value.trim() } });
    await request({ type: 'health' }); $('settings').hidden = true; message('Connected. Open a Salesforce record and capture it.', true); await health();
  } catch (error) { message(error.message); }
};
$('capture').onclick = async () => {
  $('capture').disabled = true;
  try {
    if (draft && !confirm('Replace the current draft with a new capture? Pending captures are kept.')) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractSalesforceRecord });
    if (!results[0]?.result) throw new Error('Could not read the record. Open Salesforce Details and try again.');
    showDraft(results[0].result); await chrome.storage.local.set({ draft, draftJobId: null });
    message('Captured. Review the fields, then sync to Studio.', true);
    $('review').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { message(error.message); }
  finally { $('capture').disabled = false; }
};
$('captureForm').oninput = async event => {
  if (!fields.includes(event.target.id)) return;
  plan = null; $('changes').hidden = true; $('sync').textContent = 'Sync to Studio →';
  draft = readForm(); await chrome.storage.local.set({ draft, draftJobId: jobId });
};
$('captureForm').onsubmit = async event => {
  event.preventDefault(); $('sync').disabled = true;
  try {
    const capture = readForm();
    if (!plan) {
      try { plan = await request({ type: 'preview', capture }); }
      catch (error) { if (!error.offline) throw error; plan = { offline: true, changes: [] }; }
      const conflicts = plan.changes.filter(change => change.before);
      if (conflicts.length) {
        $('changes').replaceChildren();
        const heading = document.createElement('h3'); heading.textContent = 'This record is already in Studio'; $('changes').append(heading);
        const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Existing values stay unless you select a replacement below.'; $('changes').append(hint);
        for (const change of conflicts) {
          const card = document.createElement('div'); card.className = 'change';
          const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.dataset.field = change.field;
          label.append(check, `Replace ${fieldNames[change.field] || change.field}`);
          const before = document.createElement('p'); before.textContent = `Studio: ${change.before}`;
          const after = document.createElement('p'); after.textContent = `Capture: ${change.after}`;
          card.append(label, before, after); $('changes').append(card);
        }
        $('changes').hidden = false; $('sync').textContent = 'Confirm reviewed sync →';
        message('Review the differences below. SDK selections and provisioning progress are preserved.'); return;
      }
    }
    const chosenFields = [...$('changes').querySelectorAll('input:checked')].map(input => input.dataset.field);
    await request({ type: 'queue', jobId, capture, approved: plan.changes, chosenFields });
    draft = null; plan = null; jobId = null; await chrome.storage.local.remove(['draft', 'draftJobId']);
    $('review').hidden = true; message('Capture saved. See its sync status below.', true); await renderQueue(); await health();
    document.body.classList.remove('has-draft');
  } catch (error) { message(error.message); plan = null; }
  finally { $('sync').disabled = false; }
};
$('retry').onclick = async () => { $('retry').disabled = true; try { await request({ type: 'retry' }); await renderQueue(); await health(); } catch (error) { message(error.message); } finally { $('retry').disabled = false; } };
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.queue) renderQueue(); });
(async () => {
  $('extensionId').textContent = chrome.runtime.id;
  const stored = await chrome.storage.local.get(['settings', 'draft', 'draftJobId']);
  $('settings').hidden = !!stored.settings?.token;
  if (stored.settings) { $('baseUrl').value = stored.settings.baseUrl; $('token').value = stored.settings.token; }
  if (stored.draft) showDraft(stored.draft, stored.draftJobId);
  await renderQueue(); await health();
})();

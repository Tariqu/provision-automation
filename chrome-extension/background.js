let serial = Promise.resolve();
const serialized = task => { const next = serial.then(task); serial = next.catch(() => {}); return next; };
async function api(route, body) {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.token) throw new Error('Connect the extension to Provisioning Studio first.');
  const base = new URL(settings.baseUrl);
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname) || base.username || base.password) throw new Error('Use a localhost or 127.0.0.1 dashboard address.');
  let response;
  try {
    response = await fetch(`${base.origin}/api/extension/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}`, 'X-Extension-Id': chrome.runtime.id },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
    });
  } catch { const error = new Error('Studio is offline. Start it with npm start; pending captures will retry automatically.'); error.offline = true; throw error; }
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || `Sync failed (${response.status})`); error.status = response.status; throw error; }
  return data;
}
async function processQueue() {
  const { queue = [] } = await chrome.storage.local.get('queue');
  for (const job of queue.filter(job => job.status === 'pending')) {
    try {
      const plan = await api('import', { capture: job.capture, preview: true });
      const conflicts = plan.changes.filter(change => change.before);
      const reviewed = conflicts.every(change => job.approved?.some(approved => approved.field === change.field && approved.before === change.before && approved.after === change.after));
      if (!reviewed) { job.status = 'attention'; job.message = 'Existing values differ. Review before syncing.'; continue; }
      const result = await api('import', { capture: job.capture, revision: plan.revision, chosenFields: job.chosenFields || [] });
      job.status = 'synced'; job.message = `Account ${result.action} in Studio`; job.syncedAt = new Date().toISOString();
    } catch (error) {
      job.message = error.message;
      if (!error.offline && error.status !== 409) job.status = 'attention';
    }
  }
  const pending = queue.filter(job => job.status !== 'synced');
  const history = queue.filter(job => job.status === 'synced').slice(-20);
  await chrome.storage.local.set({ queue: [...history, ...pending] });
  await chrome.action.setBadgeText({ text: pending.length ? String(pending.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: pending.some(job => job.status === 'attention') ? '#b45309' : '#0f766e' });
  return { queue: [...history, ...pending] };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  serialized(async () => {
    if (message.type === 'health') return api('health', {});
    if (message.type === 'preview') return api('import', { capture: message.capture, preview: true });
    if (message.type === 'retry') return processQueue();
    if (message.type === 'queue') {
      const { queue = [] } = await chrome.storage.local.get('queue');
      const remaining = queue.filter(job => job.id !== message.jobId);
      remaining.push({ id: message.jobId || crypto.randomUUID(), capture: message.capture, approved: message.approved || [], chosenFields: message.chosenFields || [], status: 'pending', message: 'Waiting to sync' });
      await chrome.storage.local.set({ queue: remaining });
      return processQueue();
    }
    if (message.type === 'remove') {
      const { queue = [] } = await chrome.storage.local.get('queue');
      await chrome.storage.local.set({ queue: queue.filter(job => job.id !== message.jobId) });
      return processQueue();
    }
    throw new Error('Unknown extension action');
  }).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message, offline: !!error.offline }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'retry-sync') serialized(processQueue).catch(() => {}); });
async function ensureAlarm() { if (!await chrome.alarms.get('retry-sync')) await chrome.alarms.create('retry-sync', { periodInMinutes: 1 }); }
ensureAlarm().catch(() => {});
chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); serialized(processQueue).catch(() => {}); });

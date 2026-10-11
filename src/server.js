const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { loadAccounts, normalizeAccount, validateAccount } = require('./lib/accounts');
const { createLogger } = require('./lib/logger');
const { runProvisioning } = require('./orchestrator');
const crypto = require('crypto');
const sync = require('./lib/extension-sync');

const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve(config.rootDir, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

async function handleGetAccounts(res) {
  const accountsFile = path.join(config.dataDir, 'accounts.json');
  const sampleFile = path.join(config.dataDir, 'sample-accounts.json');

  let targetPath = accountsFile;
  if (!fs.existsSync(accountsFile) && fs.existsSync(sampleFile)) {
    targetPath = sampleFile;
  }

  if (!fs.existsSync(targetPath)) {
    sendJson(res, 200, { accounts: [], revision: sync.revision([]), source: 'empty' });
    return;
  }

  try {
    const accounts = readCurrentAccounts();
    sendJson(res, 200, {
      accounts,
      revision: sync.revision(accounts),
      source: targetPath === accountsFile ? 'accounts.json' : 'sample-accounts.json'
    });
  } catch (err) {
    sendJson(res, 500, { error: `Failed to load accounts: ${err.message}` });
  }
}

async function handleSaveAccounts(req, res) {
  const body = await parseJsonBody(req);
  const rawAccounts = Array.isArray(body) ? body : body.accounts;

  if (!Array.isArray(rawAccounts)) {
    sendJson(res, 400, { error: 'Payload must be an array of accounts or { accounts: [...] }' });
    return;
  }

  const normalized = rawAccounts.map(normalizeAccount);
  if (typeof body.revision !== 'string') {
    return sendJson(res, 428, { error: 'Reload the dashboard before saving so incoming changes can be protected.' });
  }
  if (body.revision !== undefined && body.revision !== sync.revision(readCurrentAccounts())) {
    return sendJson(res, 409, { error: 'New changes arrived. Review incoming changes before saving.' });
  }
  const validated = normalized.map((acc) => ({
    ...acc,
    missingFields: validateAccount(acc)
  }));

  const accountsFile = path.join(config.dataDir, 'accounts.json');
  fs.mkdirSync(config.dataDir, { recursive: true });
  sync.atomicWrite(accountsFile, normalized);

  sendJson(res, 200, {
    ok: true,
    message: `Saved ${normalized.length} account(s) to data/accounts.json`,
    accounts: validated,
    revision: sync.revision(normalized)
  });
}

let provisioning = false;

function readCurrentAccounts() {
  const file = path.join(config.dataDir, 'accounts.json');
  const sample = path.join(config.dataDir, 'sample-accounts.json');
  const accounts = fs.existsSync(file) ? loadAccounts(file) : fs.existsSync(sample) ? loadAccounts(sample) : [];
  return accounts.map((account, index) => ({ ...account, id: account.id || `legacy_${index}` }));
}
function readPairing() {
  const file = path.join(config.dataDir, 'extension-pairing.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
async function handleExtension(req, res) {
  const pairing = readPairing();
  const origin = `chrome-extension://${pairing?.extensionId}`;
  if (!pairing || (req.headers.origin && req.headers.origin !== origin)) return sendJson(res, 403, { error: 'Pair this extension from the dashboard first.' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Id');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.writeHead(204); return res.end();
  }
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  if (req.headers['x-extension-id'] !== pairing.extensionId || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(pairing.tokenHash))) return sendJson(res, 401, { error: 'Pairing expired or invalid. Connect again from the dashboard.' });
  if (req.method !== 'POST' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'Use a JSON POST request' });
  const body = await parseJsonBody(req);
  if (req.url === '/api/extension/health') return sendJson(res, 200, { ok: true });
  if (req.url !== '/api/extension/import') return sendJson(res, 404, { error: 'Not found' });
  if (provisioning) return sendJson(res, 409, { error: 'A provisioning run is active. Sync again after it finishes.' });
  const capture = sync.cleanCapture(body.capture);
  const accounts = readCurrentAccounts();
  const revision = sync.revision(accounts);
  const plan = sync.planImport(accounts, capture);
  if (body.preview === true) return sendJson(res, 200, { revision, action: plan.existing ? 'update' : 'add', changes: plan.changes });
  if (body.revision !== revision) return sendJson(res, 409, { error: 'The queue changed. Review the latest differences and sync again.' });
  const result = sync.applyImport(accounts, capture, Array.isArray(body.chosenFields) ? body.chosenFields : []);
  sync.atomicWrite(path.join(config.dataDir, 'accounts.json'), result.accounts);
  sendJson(res, 200, { ok: true, action: result.action, revision: sync.revision(result.accounts) });
}

async function handleProvision(req, res, forceDryRun = false) {
  const body = await parseJsonBody(req);
  const dryRun = forceDryRun || body.dryRun !== false;
  if (!dryRun && body.revision !== undefined && body.revision !== sync.revision(readCurrentAccounts())) {
    return sendJson(res, 409, { error: 'The account queue changed. Review incoming changes before provisioning.' });
  }
  const skipSalesforceUpdate = Boolean(body.skipSalesforceUpdate);

  let accounts = null;
  if (Array.isArray(body.accounts) && body.accounts.length) {
    accounts = body.accounts.map(normalizeAccount);
  } else {
    const accountsFile = path.join(config.dataDir, 'accounts.json');
    if (!fs.existsSync(accountsFile)) {
      sendJson(res, 400, { error: 'No accounts provided and data/accounts.json does not exist' });
      return;
    }
    accounts = loadAccounts(accountsFile);
  }

  if (!accounts.length) {
    sendJson(res, 400, { error: 'No accounts to provision' });
    return;
  }

  if (provisioning) return sendJson(res, 409, { error: 'A provisioning run is already active' });
  const logger = createLogger(config.logsDir);
  provisioning = true;
  logger.info(`Starting ${dryRun ? 'DRY-RUN' : 'LIVE'} provisioning for ${accounts.length} account(s) via web UI`);

  try {
    const results = await runProvisioning(
      accounts,
      config,
      { dryRun, skipSalesforceUpdate },
      logger
    );

    const okCount = results.filter((r) => r.ok).length;
    const failedCount = results.length - okCount;

    sendJson(res, 200, {
      ok: failedCount === 0,
      dryRun,
      total: results.length,
      okCount,
      failedCount,
      results,
      logFile: logger.filePath
    });
  } catch (err) {
    logger.error(`Provisioning error: ${err.message}`, { stack: err.stack });
    sendJson(res, 500, { error: err.message, logFile: logger.filePath });
  } finally {
    provisioning = false;
  }
}

async function handleGetLatestLog(res) {
  try {
    if (!fs.existsSync(config.logsDir)) {
      sendJson(res, 200, { entries: [] });
      return;
    }

    const files = fs
      .readdirSync(config.logsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    if (!files.length) {
      sendJson(res, 200, { entries: [] });
      return;
    }

    const latestFile = path.join(config.logsDir, files[0]);
    const lines = fs
      .readFileSync(latestFile, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return { message: l };
        }
      });

    sendJson(res, 200, { fileName: files[0], entries: lines.slice(-100) });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  const allowedHosts = new Set([`localhost:${server.address().port}`, `127.0.0.1:${server.address().port}`]);
  if (!allowedHosts.has(req.headers.host)) return sendJson(res, 403, { error: 'Local access only' });
  if (['/api/extension/import', '/api/extension/health'].includes(req.url)) {
    return handleExtension(req, res).catch(error => sendJson(res, 400, { error: error.message }));
  }
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    return sendJson(res, 403, { error: 'Cross-origin requests are not allowed' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { error: 'Cross-site requests are not allowed' });
  if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return sendJson(res, 415, { error: 'Use application/json' });
  }
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;
  if (req.method === 'GET' && pathname === '/api/extension/status') {
    try { return sendJson(res, 200, { paired: !!readPairing() }); }
    catch { return sendJson(res, 200, { paired: false }); }
  }

  if (req.method === 'POST' && pathname === '/api/extension/pair') {
    try {
      const body = await parseJsonBody(req);
      if (!/^[a-p]{32}$/.test(body.extensionId || '')) return sendJson(res, 400, { error: 'Paste the 32-character extension ID shown in the extension.' });
      const token = crypto.randomBytes(32).toString('hex');
      sync.atomicWrite(path.join(config.dataDir, 'extension-pairing.json'), { extensionId: body.extensionId, tokenHash: crypto.createHash('sha256').update(token).digest('hex') });
      return sendJson(res, 200, { token });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  // Handle API routes
  if (req.method === 'GET' && pathname === '/api/accounts') {
    return handleGetAccounts(res);
  }

  if (req.method === 'POST' && pathname === '/api/accounts') {
    return handleSaveAccounts(req, res).catch((err) =>
      sendJson(res, 500, { error: err.message })
    );
  }

  if (req.method === 'POST' && pathname === '/api/provision') {
    return handleProvision(req, res).catch((err) =>
      sendJson(res, 500, { error: err.message })
    );
  }

  if (req.method === 'POST' && pathname === '/api/dry-run') {
    // Backwards compatibility for previous button
    return handleProvision(req, res, true).catch((err) =>
      sendJson(res, 500, { error: err.message })
    );
  }

  if (req.method === 'GET' && pathname === '/api/logs/latest') {
    return handleGetLatestLog(res);
  }

  // Handle Static files from /public
  if (req.method === 'GET') {
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    return serveStaticFile(res, filePath);
  }

  sendJson(res, 404, { error: 'Not found' });
});

if (require.main === module) server.listen(port, '127.0.0.1', () => {
  console.log(`Provision Automation Dashboard running at http://localhost:${port}`);
});

module.exports = { server };

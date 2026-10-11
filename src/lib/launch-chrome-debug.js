const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

async function checkPortOpen(url = 'http://127.0.0.1:9222/json/version') {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function main() {
  const isAlreadyOpen = await checkPortOpen();
  if (isAlreadyOpen) {
    console.log('Chrome is already running with remote debugging enabled on port 9222.');
    console.log('Any automation scripts will automatically connect to this open Chrome instance.');
    return;
  }

  const chromePath =
    config.browserExecutablePath ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const userDataDir =
    config.browserUserDataDir ||
    path.resolve(config.rootDir, '.browser-profile', 'salesforce');

  console.log(`Launching Chrome with remote debugging on port 9222...`);
  console.log(`Chrome binary: ${chromePath}`);
  console.log(`User data dir: ${userDataDir}`);

  const args = [
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  // Wait up to 10 seconds for debugging port to be ready
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 10000) {
    await new Promise((r) => setTimeout(r, 500));
    ready = await checkPortOpen();
    if (ready) break;
  }

  if (ready) {
    console.log('\nSuccess! Chrome is running with remote debugging enabled on port 9222.');
    console.log('You can now log into Salesforce in this browser, and run:');
    console.log('  npm run scrape:salesforce');
    console.log('It will reuse this same browser and session without closing it.');
  } else {
    console.warn(
      '\nWarning: Chrome was launched, but port 9222 is not responding yet.\n' +
      'If you have another personal Chrome instance running without remote debugging, close it first or check Chrome status.'
    );
  }
}

main().catch(console.error);

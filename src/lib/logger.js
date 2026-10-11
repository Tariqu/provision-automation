const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createLogger(logsDir) {
  ensureDir(logsDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(logsDir, `provision-${stamp}.jsonl`);

  function write(level, message, context = {}) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...context
    };

    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
    const prefix = level.toUpperCase().padEnd(5);
    console.log(`[${prefix}] ${message}`);
  }

  return {
    filePath,
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context)
  };
}

module.exports = {
  createLogger,
  ensureDir
};

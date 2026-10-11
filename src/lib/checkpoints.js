const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

function createCheckpoints(directory, identity) {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const file = path.join(directory, `${hash(identity)}.json`);
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return {
    get(step, inputs) {
      const entry = state[step];
      return entry?.fingerprint === hash(inputs) ? entry.result : null;
    },
    set(step, inputs, result) {
      state[step] = { fingerprint: hash(inputs), result, completedAt: new Date().toISOString() };
      fs.mkdirSync(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
      fs.renameSync(temporary, file);
    }
  };
}

module.exports = { createCheckpoints };

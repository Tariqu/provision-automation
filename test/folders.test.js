const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSdkFolder } = require('../src/lib/folders');

test('reuses legacy client folder and copies the matching whole SDK directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-test-'));
  try {
    const base = path.join(root, 'clients');
    const templates = path.join(root, 'templates');
    const client = path.join(base, 'parkholidays');
    for (const dir of [client, path.join(base, 'parkholidays.com'), path.join(templates, 'JavaScript', 'nested'), path.join(templates, 'PHP')]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(templates, 'JavaScript', 'nested', 'sdk.js'), 'sdk');
    fs.writeFileSync(path.join(templates, 'JavaScript', 'readme.txt'), 'source');
    fs.writeFileSync(path.join(templates, 'PHP', 'sdk.php'), 'php');
    fs.mkdirSync(path.join(client, 'JavaScript'));
    fs.writeFileSync(path.join(client, 'JavaScript', 'readme.txt'), 'client edits');
    const result = createSdkFolder({ domain: 'parkholidays.com', integrationType: 'JavaScript' }, { sdkBasePath: base, sdkTemplatePath: templates });
    assert.equal(result.folderPath, client);
    assert.equal(result.created, false);
    assert.equal(fs.readFileSync(path.join(client, 'JavaScript', 'nested', 'sdk.js'), 'utf8'), 'sdk');
    assert.equal(fs.readFileSync(path.join(client, 'JavaScript', 'readme.txt'), 'utf8'), 'client edits');
    assert.equal(fs.existsSync(path.join(client, 'PHP')), false);
    const php = createSdkFolder({ domain: 'php.example.com', integrationType: 'JavaScript', sdkFolder: 'PHP' }, { sdkBasePath: base, sdkTemplatePath: templates });
    assert.ok(fs.existsSync(path.join(php.sdkFolderPath, 'sdk.php')));
    assert.throws(() => createSdkFolder({ domain: 'example.com', integrationType: 'Unknown' }, { sdkBasePath: base, sdkTemplatePath: templates }), /No confirmed/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

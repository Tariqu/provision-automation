const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { updateSdkAccountId } = require('../src/lib/sdk-account-id');
const dotnet = 'ixf_config.SetProperty(IXFConfigKeys.ACCOUNT_ID, "f00000000000000");';
const java = 'ixfConfig.setProperty(IXFConfiguration.ACCOUNT_ID, "enter_account_number_here");';
const php = 'BEIXFClient::$ACCOUNT_ID_CONFIG => "enter_account_id_here",';
const cases = {
 'DotNet-MVC': ['Controllers/Home.cs', dotnet], 'DotNet-VB': ['Site.Master.vb', dotnet], 'DotNet-WebForms': ['Site.Master.cs', dotnet],
 Java: ['sample-master.jsp', java], 'Java-AEM': ['nested/BrightEdgeUtil.java', java], 'Java-AEM6.5': ['nested/BrightEdgeUtil.java', java], 'Java-Hybris': ['hybris_template.jsp', java.replace('enter_account_number_here','[ENTER_ACCOUNT_ID]')],
 JavaScript: ['sample_master.html', '<script src="//cdn.bc0a.com/autopilot/f00000000000000/autopilot_sdk.js"></script>'],
 PHP: ['sample_master_standard.php', php.replace('enter_account_id_here','ACCOUNT_ID')], 'PHP-Drupal 7': ['html.tpl.php', php], 'PHP-Joomla': ['theme.php', php.replace('enter_account_id_here','enter_account_id')], 'PHP-Twig': ['PreContentViewListener.php', php], 'PHP-WordPress': ['header.php', php], 'PHP-WordPress_Shortcode': ['header.php', php]
};

test('all required SDK rules update only copied settings and are repeatable', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-id-'));
 try {
  for (const [sdk, [name, setting]] of Object.entries(cases)) {
   const dir = path.join(root, sdk); const target = path.join(dir, name);
   fs.mkdirSync(path.dirname(target), {recursive:true});
   fs.writeFileSync(target, 'Unrelated café\r\n'+setting+'\r\n');
   if (sdk === 'PHP') fs.writeFileSync(path.join(dir,'sample_master_hybrid.php'), php);
   const result = updateSdkAccountId({sdkFolder:sdk,integrationAccountNumber:'335004'}, {sdkFolderPath:dir});
   assert.equal(result.accountId,'f00000000335004');
   assert.ok(fs.readFileSync(target,'utf8').startsWith('Unrelated café\r\n'));
   assert.ok(fs.readFileSync(target,'utf8').includes('f00000000335004'));
   if (sdk === 'PHP') { assert.equal(result.files.length,2); assert.ok(fs.readFileSync(path.join(dir,'sample_master_hybrid.php'),'utf8').includes(result.accountId)); }
   const before=fs.readFileSync(target);
   updateSdkAccountId({sdkFolder:sdk,integrationAccountNumber:'335004'}, {sdkFolderPath:dir});
   assert.deepEqual(fs.readFileSync(target),before);
  }
 } finally { fs.rmSync(root,{recursive:true}); }
});

test('missing required PHP file prevents partial updates; UTF16 is preserved', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sdk-id-'));
 try {
  const target=path.join(root,'sample_master_standard.php');fs.writeFileSync(target,php);
  assert.throws(()=>updateSdkAccountId({sdkFolder:'PHP',integrationAccountNumber:'1'},{sdkFolderPath:root}),/sample_master_hybrid/);
  assert.equal(fs.readFileSync(target,'utf8'),php);
  const vb=path.join(root,'Site.Master.vb');fs.writeFileSync(vb,Buffer.from('\ufeff'+dotnet+'\r\n','utf16le'));
  updateSdkAccountId({sdkFolder:'DotNet-VB',integrationAccountNumber:'1'},{sdkFolderPath:root});
  assert.equal(fs.readFileSync(vb).toString('utf16le'),'\ufeff'+dotnet.replace('f00000000000000','f00000000000001')+'\r\n');
  assert.throws(()=>updateSdkAccountId({sdkFolder:'DotNet-VB',integrationAccountNumber:'1'},{sdkFolderPath:root,templatePath:root}),/source template/);
 } finally {fs.rmSync(root,{recursive:true});}
});

test('plugin and other exempt SDKs skip without opening files; dry check never writes',()=>{
 for(const sdk of ['DotNet-Kentico','DotNet-Optimizely_Plugin','DotNet-Umbraco_Plugin','Java-OSGI','Magento_2_Plugin','PHP-Drupal9-11','PHP-WordPress_Plugin','Side-Car']) assert.equal(updateSdkAccountId({sdkFolder:sdk,integrationAccountNumber:'1'},{}).skipped,true);
 assert.equal(updateSdkAccountId({sdkFolder:'JavaScript',integrationAccountNumber:'1'},{sdkFolderPath:'does-not-exist'},{dryRun:true}).dryRun,true);
});

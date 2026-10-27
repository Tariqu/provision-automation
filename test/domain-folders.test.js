const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSdkFolder,validateDestinations}=require('../src/lib/folders');
const {updateSdkAccountId}=require('../src/lib/sdk-account-id');
test('Canon domain copies isolate IDs, preserve legacy files, and reject collisions across runs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canon-sdk-'));
 try {
  const config={dataDir:path.join(root,'data'),sdkBasePath:path.join(root,'clients'),sdkTemplatePath:path.join(root,'templates')};
  const template=path.join(config.sdkTemplatePath,'JavaScript');fs.mkdirSync(path.join(template,'nested'),{recursive:true});
  const sample='<script src="//cdn.bc0a.com/autopilot/f00000000000000/autopilot_sdk.js"></script>';
  fs.writeFileSync(path.join(template,'sample_master.htm'),sample);fs.writeFileSync(path.join(template,'nested','readme.txt'),'full folder');
  const legacy=path.join(config.sdkBasePath,'canon','JavaScript');fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'sample_master.htm'),'legacy unchanged');
  const accounts=['de','ie','fr','nl','es','it'].map((t,i)=>({domain:`canon.${t}`,integrationAccountNumber:String(316890+i),sdkFolder:'JavaScript',folderLayout:'domain'}));
  assert.throws(()=>validateDestinations(accounts.map(a=>({...a,folderLayout:'standard'})),config),/share SDK destination/);
  validateDestinations(accounts,config);
  for(const account of accounts){
   const preview=createSdkFolder(account,config,{dryRun:true});assert.equal(fs.existsSync(preview.folderPath),false);
   const folder=createSdkFolder(account,config);assert.equal(fs.existsSync(path.join(folder.sdkFolderPath,'.provision-account.json')),false);assert.equal(folder.sdkFolderPath,path.join(config.sdkBasePath,'canon',account.domain,'JavaScript'));
   const result=updateSdkAccountId(account,folder);
   assert.ok(fs.readFileSync(path.join(folder.sdkFolderPath,'sample_master.htm'),'utf8').includes(result.accountId));
   assert.equal(fs.readFileSync(path.join(folder.sdkFolderPath,'nested','readme.txt'),'utf8'),'full folder');
   updateSdkAccountId(account,createSdkFolder(account,config));
   assert.throws(()=>createSdkFolder({...account,integrationAccountNumber:'999'},config),/belongs to another/);
  }
  assert.equal(fs.readFileSync(path.join(legacy,'sample_master.htm'),'utf8'),'legacy unchanged');
  assert.equal(fs.readFileSync(path.join(template,'sample_master.htm'),'utf8'),sample);
  const f=path.join(root,'unmarked');fs.mkdirSync(f);const file=path.join(f,'sample_master.htm');const personalized=sample.replace('f00000000000000','f00000000316890');fs.writeFileSync(file,personalized);
  assert.throws(()=>updateSdkAccountId({sdkFolder:'JavaScript',integrationAccountNumber:'999'},{sdkFolderPath:f}),/belongs to another/);
  assert.equal(fs.readFileSync(file,'utf8'),personalized);
 } finally {fs.rmSync(root,{recursive:true});}
});

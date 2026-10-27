const fs=require('fs'),path=require('path');
const config=require('../src/config');
const {recordFolderOwner}=require('../src/lib/folders');
const base=fs.realpathSync(config.sdkBasePath);
let migrated=0;
function walk(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(entry.isSymbolicLink())continue;
  const full=path.join(dir,entry.name);
  if(entry.isDirectory()){if(entry.name!=='1-Template')walk(full);continue;}
  if(entry.name!=='.provision-account.json')continue;
  const relative=path.relative(base,fs.realpathSync(full));
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Marker outside SDK base');
  const owner=JSON.parse(fs.readFileSync(full,'utf8'));
  if(!/^\d{1,14}$/.test(owner.accountId)||typeof owner.domain!=='string')throw new Error('Unexpected marker: '+full);
  recordFolderOwner(dir,{integrationAccountNumber:owner.accountId,domain:owner.domain},config.dataDir);
  fs.unlinkSync(full);
  migrated++;
 }
}
walk(base);console.log('Migrated ownership records and removed SDK metadata files:',migrated);

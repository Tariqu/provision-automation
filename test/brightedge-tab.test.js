const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const {enableSiteAgent}=require('../src/automation/brightedge');
for(const alreadyEnabled of [false,true]) test(`Site Agent waits for delayed LR tab; already enabled=${alreadyEnabled}`,async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage();let enabled=alreadyEnabled,saves=0;
  await page.route('https://app1.brightedge.com/**',async route=>{
   if(route.request().method()==='POST'){
    saves++;const data=new URLSearchParams(route.request().postData());enabled=data.get('agent')==='1';assert.equal(data.get('v2'),'0');
   }
   await route.fulfill({contentType:'text/html',body:`<form method="post">
    <a id="ui-id-6" href="#wrong">LR unrelated link</a>
    <a href="#tabs-6" onclick="event.preventDefault();if(!window.tabReady)return;setTimeout(()=>document.getElementById('tabs-6').style.display='block',1200)">LR</a>
    <script>setTimeout(()=>window.tabReady=true,1800)</script>
    <div id="tabs-6" style="display:none">
    <input type="radio" name="agent" value="0" ${enabled?'':'checked'}>
    <input id="enable_link_block_1" type="radio" name="agent" value="1" ${enabled?'checked':''}>
    <input name="v2" type="radio" value="0" checked><input id="enable_autopilot_seo_v2_1" name="v2" type="radio" value="1">
    </div><input type="submit" name="save" value="Save"></form>`});
  });
  await page.goto('https://app1.brightedge.com/home');
  const result=await enableSiteAgent(page,{integrationAccountNumber:'336154'},{selectors:{}});
  assert.equal(result.enabled,true);assert.equal(enabled,true);assert.equal(saves,alreadyEnabled?0:1);
 }finally{await browser.close()}
});

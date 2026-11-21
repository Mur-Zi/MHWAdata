import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {createRequire}from'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('../app/',import.meta.url),version=fs.readFileSync(new URL('../android/AndroidManifest.xml',root),'utf8').match(/android:versionName="([\d.]+)"/)[1],packaged=new URL('./delivery'+version.replaceAll('.','')+'/apk-assets/',import.meta.url),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const server=http.createServer((req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',p.endsWith('.apk')?'application/vnd.android.package-archive':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(new URL('.'+(p==='/'?'/index.html':p),root)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
const announcement=fs.readFileSync(new URL('announcement.js',root),'utf8').match(/"id":\s*"([^"]+)"/)[1],meta=JSON.parse(fs.readFileSync(new URL('downloads/release.json',root)));
try{
 for(const width of [1440,412,360]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.addInitScript(id=>localStorage.setItem('mhwa_announcement_dismissed',id),announcement);
  await page.goto(origin);await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);
  const link=page.locator('#download-app');assert.equal(await link.isVisible(),true);assert.equal(await link.getAttribute('href'),'downloads/'+meta.file);
  const bounds=await link.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
  const received=page.waitForEvent('download');await link.click();const download=await received;
  assert.equal(download.suggestedFilename(),'MHWA数据库-'+version+'.apk');assert.equal(await download.failure(),null);assert.equal(hash(fs.readFileSync(await download.path())),meta.sha256);
  assert.deepEqual(errors,[]);await page.close();console.log(width+'px website download: visible, clickable, correct APK hash');
 }
 const native=await browser.newPage({viewport:{width:412,height:900}}),errors=[];native.on('pageerror',e=>errors.push(e.message));
 await native.route(/^https?:/,r=>r.abort());await native.addInitScript(id=>localStorage.setItem('mhwa_announcement_dismissed',id),announcement);
 await native.goto(new URL('index.html',packaged).href);await native.waitForFunction(()=>!!window.__MHWILD_DEBUG__);
 assert.equal(await native.locator('#download-app').isVisible(),false);
 await native.locator('#nav-calculator').click();
 for(const weapon of ['bow','light_bowgun','heavy_bowgun']){
  await native.evaluate(value=>{const select=document.querySelector('#calc-weapon');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},weapon);
  assert.ok(await native.locator('#calc-move option').count()>0,weapon);
 }
 assert.deepEqual(errors,[]);await native.close();console.log('Actual APK assets: offline file:// startup, hidden download link, bow and bowguns loaded');
}finally{await browser.close();await new Promise(r=>server.close(r));}

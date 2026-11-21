import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const source=fs.readFileSync(new URL('../app/announcement.js',import.meta.url),'utf8');
const entries=JSON.parse(source.match(/var announcements = ([\s\S]*?);\n  var announcement/)[1]);
assert.deepEqual(entries.map(e=>e.date),['2026-11-21','2026-10-15','2026-10-13']);assert.equal(entries[0].paragraphs.length,7);
for(const entry of entries){assert.match(entry.date,/^\d{4}-\d{2}-\d{2}$/);assert.ok(entry.id.startsWith(entry.date));}
const {chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('../app/',import.meta.url),server=http.createServer((req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(new URL('.'+(p==='/'?'/index.html':p),root)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
try{for(const width of [1440,412]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 // A dismissed older announcement must not suppress the new publication.
 await page.goto(origin+'/web-version.json');await page.evaluate(()=>localStorage.setItem('mhwa_announcement_dismissed','2026-10-15-update'));
 await page.goto(origin);await page.waitForSelector('.announcement-overlay');
 const panel=page.locator('.announcement-panel');assert.equal(await panel.getAttribute('data-announcement-id'),entries[0].id);
 assert.equal(await panel.locator(':scope > time').textContent(),'2026-11-21');assert.equal(await panel.locator(':scope > p').count(),7);
 assert.equal(await panel.evaluate(e=>e.scrollTop),0);assert.ok(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth));
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'历史公告');
 await page.locator('.announcement-history > summary').click();
 for(const entry of entries.slice(1)){
  const detail=page.locator('.announcement-entry[data-announcement-id="'+entry.id+'"]');await detail.locator(':scope > summary').click();
  assert.equal(await detail.locator('time').getAttribute('datetime'),entry.date);
  assert.deepEqual(await detail.locator(':scope > p').allTextContents(),entry.paragraphs.map((p,i)=>(i+1)+'. '+p));
 }
 await panel.locator('button').click();assert.equal(await page.locator('.announcement-overlay').count(),0);
 assert.equal(await page.evaluate(()=>localStorage.getItem('mhwa_announcement_dismissed')),entries[0].id);
 await page.reload();await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);assert.equal(await page.locator('.announcement-overlay').count(),0);
 await page.locator('#footer-announcements').click();await page.waitForSelector('.announcement-overlay');assert.equal(await page.locator('.announcement-entry').count(),2);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.announcement-overlay').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'footer-announcements');
 assert.deepEqual(errors,[]);await page.close();console.log(width+'px: dated archive, popup dismissal, keyboard access, and footer reopening passed');
}}finally{await browser.close();await new Promise(r=>server.close(r));}

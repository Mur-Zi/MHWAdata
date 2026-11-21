import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('../app/',import.meta.url);
const server=http.createServer((req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(new URL('.'+(p==='/'?'/index.html':p),root)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
try{for(const width of [1440,412]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.addInitScript(()=>localStorage.setItem('mhwa_announcement_dismissed','2026-10-15-update'));
 await page.goto(origin);await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);
 await page.evaluate(()=>{document.getElementById('nav-calculator').click();const change=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));};change('calc-weapon','bow');const derive=document.getElementById('calc-derive-toggle');if(derive.checked)derive.click();change('calc-move','bow_051');document.getElementById('calc-add').click();document.querySelector('.calc-combo-item .calc-move-select').click();});
 const wound=page.locator('[data-move-field="wound"] input').filter({visible:true});await wound.first().check();
 const count=page.locator('select[data-move-field="woundCount"]').filter({visible:true});
 // Enhanced selects are hidden; inspect their options and dispatch the native event.
 const report=await page.evaluate(()=>{const q=s=>document.querySelector(s),w=q('select[data-move-field="woundCount"]'),input=q('input[aria-label="追击贯通跳数"]');return {wounds:w&&Array.from(w.options).map(o=>o.value),input:!!input,max:input?.getAttribute('max'),note:document.body.textContent.includes('资料尚未确认总命中上限')||document.body.textContent.includes('仅命中临时弱点时选0处')};});
 assert.deepEqual(report.wounds,['0','1','2','3','4']);assert.equal(report.input,true);assert.equal(report.max,null);assert.equal(report.note,false);
 await page.evaluate(()=>{const input=document.querySelector('input[aria-label="追击贯通跳数"]');input.value='100';input.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(await page.locator('input[aria-label="追击贯通跳数"]').first().inputValue(),'100');assert.deepEqual(errors,[]);await page.close();console.log(width+'px bow focus options passed');
}}finally{await browser.close();await new Promise(r=>server.close(r));}

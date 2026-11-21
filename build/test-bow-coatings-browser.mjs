import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('../app/',import.meta.url),server=http.createServer((req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(new URL('.'+(p==='/'?'/index.html':p),root)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
try{for(const width of [1440,412]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.addInitScript(id=>localStorage.setItem('mhwa_announcement_dismissed',id),fs.readFileSync(new URL('announcement.js',root),'utf8').match(/"id":\s*"([^"]+)"/)[1]);
 await page.goto(origin);await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);
 const report=await page.evaluate(()=>{
  const q=s=>document.querySelector(s),change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new Event('change',{bubbles:true}));},metric=name=>Number(Array.from(document.querySelectorAll('#calc-result-grid .calc-stat')).find(e=>e.querySelector('span').textContent===name)?.querySelector('strong').textContent);
  q('#nav-calculator').click();change('#calc-weapon','bow');if(q('#calc-derive-toggle').checked)q('#calc-derive-toggle').click();change('#calc-move','bow_001');q('#calc-add').click();q('.calc-combo-item .calc-move-select').click();
  const options=Array.from(q('[data-move-field="bowCoating"]').options).map(o=>o.textContent);
  if(Array.from(q('#calc-move').options).some(o=>o.value==='bow_ready'||o.textContent.includes('回到自由态')))throw Error('Retired bow placeholder remains visible');
  change('[data-move-field="rangedVariant"]','4');const raw=metric('物理伤害');
  change('[data-move-field="bowCoating"]','power');const power=metric('物理伤害'),level=q('[data-move-field="rangedVariant"]').value;
  change('[data-move-field="bowCoating"]','pierce');const pierceLevel=q('[data-move-field="rangedVariant"]').value,stages=!!q('[data-move-field="rangedHits"]');
  change('[data-move-field="bowCoating"]','poison');const poison=metric('异常累计(期望)'),noPierce=!q('[data-move-field="rangedHits"]');
  q('#calc-add').click();q('.calc-combo-item:last-child .calc-move-select').click();const inherited=q('[data-move-field="bowCoating"]').value;
  change('[data-move-field="bowCoating"]','exhaust');const exhaust=metric('减气累计');
  return {options,raw,power,level,pierceLevel,stages,poison,noPierce,inherited,exhaust};
 });
 assert.deepEqual(report.options,['无瓶','强击瓶','接击瓶','贯通瓶','毒瓶','麻痹瓶','睡眠瓶','爆破瓶','减气瓶']);assert.ok(Math.abs(report.power-report.raw*1.35)<.02);assert.equal(report.level,'4');assert.equal(report.pierceLevel,'5');assert.equal(report.stages,true);assert.equal(report.poison,15);assert.equal(report.noPierce,true);assert.equal(report.inherited,'poison');assert.ok(report.exhaust>0);assert.deepEqual(errors,[]);
 await page.close();console.log(width+'px coating selection, calculation, level retention, and inheritance passed');
}}finally{await browser.close();await new Promise(r=>server.close(r));}

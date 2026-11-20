import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire}from'node:module';
import {fileURLToPath}from'node:url';
const {chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL('../app/',import.meta.url),errors=[];
const server=http.createServer((req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(path.includes('..')){res.writeHead(403).end();return;}const file=new URL('.'+(path==='/'?'/index.html':path),root);try{res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.json')?'application/json':path==='/'?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});let count=0;
try{for(const width of [1440,412]){
 const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.addInitScript(()=>localStorage.setItem('mhwa_announcement_dismissed','2026-10-15-update'));
 await page.goto(origin);await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);
 const report=await page.evaluate(()=>{
  const D=window.__MHWILD_DEBUG__,rows=[],check=(name,value)=>rows.push({name,pass:!!value}),q=id=>document.getElementById(id);
  const change=(id,value)=>{q(id).value=String(value);q(id).dispatchEvent(new Event('change',{bubbles:true}));};
  for(const m of D.monsters){D.openMonster(m.name);const el=q('view-monster-detail');check(m.name+' detail renders',el.querySelectorAll('[data-hzv-row]').length>0);}
  D.openMonster('Chatacabra');check('tongue on monster page',q('view-monster-detail').textContent.includes('舌'));check('extract column',q('view-monster-detail').textContent.includes('猎虫精华'));
  D.openMonster('Zoh Shia');q('view-monster-detail').querySelector('[data-hzv="伤口"]').click();check('wound state column visible',!q('view-monster-detail').querySelector('.state-col').hidden);check('final form tab',q('view-monster-detail').querySelector('[data-hzv="最终形态"]'));
  D.openMonster('Rey Dau');let detail=q('view-monster-detail');check('sever threshold header',detail.textContent.includes('断尾（切断）'));check('sever 500',Array.from(detail.querySelectorAll('table tr')).some(r=>/尾/.test(r.textContent)&&r.textContent.includes('500')));
  const at=D.quests.find(q=>q.targets.some(t=>t.monsterName==='Rey Dau'&&t.legendaryID===2));q('scale-toggle').click();q('scale-task-difficulty').value='2';q('scale-task-difficulty').dispatchEvent(new Event('change',{bubbles:true}));detail.querySelector('[data-qid="'+at.id+'"]').click();check('AT tool table',q('view-monster-detail').textContent.includes('道具效果（历战王）'));const tool=q('view-monster-detail').querySelector('[data-detail-group="tools"]');check('AT flash 10 seconds',Array.from(tool.querySelectorAll('tbody tr')).some(r=>r.textContent.includes('持续')&&r.querySelector('td.num')?.textContent==='10'));
  check('small monsters absent',!D.monsters.some(m=>m.name==='Omega Micros'||m.name==='Dalthydon'));
  q('nav-calculator').click();change('calc-monster','Chatacabra');change('calc-part','Tongue');check('tongue selectable',q('calc-meat-hint').textContent.includes('斩 85')&&q('calc-meat-hint').textContent.includes('弹 90'));
  change('calc-monster','Omega Planetes');check('omega both conditions',Array.from(q('calc-meat-state').options).some(o=>o.text.includes('失败后'))&&Array.from(q('calc-meat-state').options).some(o=>o.text.includes('失败前')));
  change('calc-monster','Nerscylla Clone');check('clone selectable',q('calc-part').options.length>0);check('small absent from calculator',!Array.from(q('calc-monster').options).some(o=>o.value==='Omega Micros'||o.value==='Dalthydon'));
  change('calc-monster','Arkveld');check('new task selectable',Array.from(q('calc-quest').options).some(o=>o.value.startsWith('25425:')));
  change('calc-weapon','light_bowgun');change('calc-monster','Ajarakan');change('calc-part','Head');const hot=Array.from(q('calc-meat-state').options).find(o=>o.text.includes('红莲'));change('calc-meat-state',hot.value);check('head-on shot condition shown',q('calc-target-conditions').textContent.includes('正面射击头顶'));
  change('calc-monster','Arkveld');change('calc-part','Chainblade');const absorb=Array.from(q('calc-meat-state').options).find(o=>o.text.includes('属性吸收'));change('calc-meat-state',absorb.value);check('first-hit absorption toggle',q('calc-target-conditions').querySelector('input')?.checked);
  return rows;
 });const failed=report.filter(r=>!r.pass);assert.deepEqual(failed,[],width+'px failed checks: '+JSON.stringify(failed));count+=report.length;
 await page.evaluate(()=>window.__MHWILD_DEBUG__.openMonster('Chatacabra'));await page.screenshot({path:fileURLToPath(new URL('monster-completion-'+width+'.png',import.meta.url)),fullPage:false});await page.close();
}assert.deepEqual(errors,[]);console.log(`${count} browser checks passed, desktop/mobile, all retained monsters and calculator selectors.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}

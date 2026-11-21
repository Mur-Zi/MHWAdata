import fs from 'node:fs';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const{chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL(process.argv[2]||'../app/',import.meta.url),audit=process.argv.includes('--audit'),latest=fs.readFileSync(new URL('announcement.js',root),'utf8').match(/"id":\s*"([^"]+)"/)[1],browser=await chromium.launch({headless:true}),reports=[];
try{for(const {width,largeText} of [{width:320},{width:360},{width:412},{width:920},...audit?[]:[{width:360,largeText:true}]]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());await page.addInitScript(id=>localStorage.setItem('mhwa_announcement_dismissed',id),latest);await page.goto(new URL('index.html',root).href);await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);await page.locator('#nav-calculator').click();
 if(largeText)await page.addStyleTag({content:'.calc-move-control .seg-btn,.calc-move-control .picker-btn-text {font-size:18px!important;}'});
 const weapons=await page.evaluate(()=>Object.keys(window.MHWCALC.weaponMoves));let moves=0,states=0,issues=[];
 for(const weapon of weapons){const report=await page.evaluate(weapon=>{
  const q=s=>document.querySelector(s),change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new Event('change',{bubbles:true}));};change('#calc-weapon',weapon);if(q('#calc-derive-toggle').checked)q('#calc-derive-toggle').click();
  const ids=[...q('#calc-move').options].map(o=>o.value).filter(Boolean),issues=[];let states=0;
  const measure=(id,stage)=>{
   states++;const scope=q('#calc-combo-list'),editor=q('#calc-combo-editor'),roots=[scope,...editor&&!editor.hidden?[editor]:[]];
   for(const root of roots)for(const el of root.querySelectorAll('.calc-move-control,.seg-group,.seg-btn,.calc-move-header')){
    if(!el.getClientRects().length)continue;const rect=el.getBoundingClientRect(),container=root.getBoundingClientRect();
    const range=document.createRange();range.selectNodeContents(el);const wraps=el.matches('.seg-btn')&&range.getClientRects().length>1;
    if(el.scrollWidth>el.clientWidth+1||rect.left<container.left-1||rect.right>container.right+1||wraps)issues.push({weapon,id,stage,field:el.closest('[data-move-control]')?.dataset.moveControl,element:el.className,text:el.textContent.slice(0,80),width:Math.round(rect.width),overflow:el.scrollWidth-el.clientWidth,wraps});
   }
  };
  for(const id of ids){
   q('#calc-crit-expected').checked=true;q('#calc-crit-expected').dispatchEvent(new Event('change',{bubbles:true}));
   for(const b of [...document.querySelectorAll('.calc-combo-item .calc-rm')])b.click();change('#calc-move',id);q('#calc-add').click();measure(id,'collapsed');q('.calc-move-select').click();measure(id,'conditions');
   const wound=q('[data-move-field="wound"] input');if(wound&&!wound.checked){wound.click();measure(id,'wound');}
   q('#calc-crit-expected').checked=false;q('#calc-crit-expected').dispatchEvent(new Event('change',{bubbles:true}));measure(id,'manual-critical');
  }
  return {moves:ids.length,states,issues};
 },weapon);moves+=report.moves;states+=report.states;issues.push(...report.issues);}
 reports.push({width,largeText:!!largeText,moves,states,issues,errors});console.log(JSON.stringify({width,largeText:!!largeText,moves,states,issues:issues.length,examples:issues.slice(0,3)}));
 if(!audit){
  assert.deepEqual(errors,[]);assert.deepEqual(issues,[]);
  await page.evaluate(()=>{const q=s=>document.querySelector(s),change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new Event('change',{bubbles:true}));};change('#calc-weapon','great_sword');q('#calc-crit-expected').checked=true;q('#calc-crit-expected').dispatchEvent(new Event('change',{bubbles:true}));for(const b of [...document.querySelectorAll('.calc-rm')])b.click();for(const id of ['gs_charged','gs_strong_charge','gs_true_charge','gs_pierce']){change('#calc-move',id);q('#calc-add').click();}});
  const focused=page.locator('.calc-combo-item').last();assert.equal(await focused.locator('.calc-move-damage-link').count(),0);assert.equal(await focused.locator('.calc-move-header .calc-move-expand').count(),0);
  if(width<900){assert.equal(await focused.locator('.calc-move-output .calc-move-expand').isVisible(),true);await focused.screenshot({path:fileURLToPath(new URL('./combo-focus-'+width+(largeText?'-large':'')+'.png',import.meta.url))});}
 }
 await page.close();
}}finally{await browser.close();fs.writeFileSync(new URL(audit?'./combo-control-audit-before.json':'./combo-control-audit-after.json',import.meta.url),JSON.stringify(reports,null,2)+'\n');}

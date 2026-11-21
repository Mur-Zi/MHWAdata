import fs from 'node:fs';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const{chromium}=createRequire(import.meta.url)('C:/Users/MSN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=new URL(process.argv[2]||'../app/',import.meta.url),browser=await chromium.launch({headless:true}),d={};new Function('window',fs.readFileSync(new URL('calc-data.js',root),'utf8'))(d);
const latest=fs.readFileSync(new URL('announcement.js',root),'utf8').match(/"id":\s*"([^"]+)"/)[1];
try{for(const width of [1440,412,320]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());await page.addInitScript(id=>localStorage.setItem('mhwa_announcement_dismissed',id),latest);await page.goto(new URL('index.html',root).href);await page.waitForFunction(()=>!!window.__MHWILD_DEBUG__);
 await page.evaluate(()=>{const q=s=>document.querySelector(s),change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new Event('change',{bubbles:true}));};q('#nav-calculator').click();change('#calc-weapon','great_sword');if(q('#calc-derive-toggle').checked)q('#calc-derive-toggle').click();for(const id of ['gs_charged','gs_strong_charge','gs_true_charge']){change('#calc-move',id);q('#calc-add').click();}});
 await page.locator('.calc-combo-item').nth(2).locator('.calc-move-damage-link').click();let editor=page.locator('.calc-editor-damage:visible');
 assert.equal(await editor.locator('.calc-critical-outcomes small,.calc-critical-outcomes p').count(),0);assert.equal(await editor.locator('.calc-critical-outcomes>div').count(),3);
 assert.deepEqual(await editor.locator('.calc-damage-hit-table tbody td:last-child').allTextContents(),['19.01','317.20']);
 const contrast=await editor.locator('.calc-damage-hit-table td').first().evaluate(e=>{const luminance=s=>{const c=s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;},fg=luminance(getComputedStyle(e).color),bg=luminance(getComputedStyle(e.closest('.calc-editor-damage')).backgroundColor);return(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});assert.ok(contrast>=10,'contrast '+contrast);
 assert.equal(await editor.locator('.calc-damage-extra .calc-subtable').isVisible(),false);await editor.locator('.calc-damage-extra>summary').first().click();assert.equal(await editor.locator('.calc-damage-extra .calc-subtable').isVisible(),true);
 assert.ok(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 if(width===412){await editor.locator('.calc-damage-extra>summary').first().click();await editor.screenshot({path:fileURLToPath(new URL('./damage-details-release-412.png',import.meta.url))});}
 for(const weapon of ['insect_glaive','gunlance','light_bowgun','heavy_bowgun']){
  const moves=d.MHWCALC.weaponMoves[weapon],move=weapon==='gunlance'?moves.find(m=>m.name==='全弹发射'):weapon.includes('bowgun')?moves.find(m=>m.bowgunPreview&&m.rangedRole==='shot'):moves.find(m=>m.hits?.length>1);
  assert.ok(move,weapon);await page.evaluate(({weapon,id})=>{const q=s=>document.querySelector(s),change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new Event('change',{bubbles:true}));};change('#calc-weapon',weapon);change('#calc-move',id);q('#calc-add').click();},{weapon,id:move.id});
  await page.locator('.calc-combo-item').last().locator('.calc-move-damage-link').click();editor=page.locator('.calc-editor-damage:visible');
  const result=await editor.evaluate(e=>({values:[...e.querySelectorAll('.calc-damage-hit-table tbody td:last-child')].map(n=>Number(n.textContent)),total:Number(e.querySelector('[data-crit-outcome="expected"] b')?.textContent)}));
  if(result.values.length)assert.ok(Math.abs(result.values.reduce((a,b)=>a+b,0)-result.total)<=result.values.length*.011,weapon+' per-hit total');
  if(weapon.includes('bowgun')){await editor.locator('.calc-magazine-extra>summary').click();assert.ok(await editor.locator('.calc-magazine tbody tr').count()>=6);assert.equal(await editor.locator('.calc-magazine td b+small').count(),0);}
 }
 assert.deepEqual(errors,[]);await page.close();console.log(width+'px: readable totals (contrast '+contrast.toFixed(1)+':1), collapsed detail, mixed hits, shelling and magazine checks passed');
}}finally{await browser.close();}

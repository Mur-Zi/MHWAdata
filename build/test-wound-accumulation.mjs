import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../app/calc-data.js',import.meta.url),'utf8'),ctx);
const d=ctx.window.MHWCALC,C=createRequire(import.meta.url)('../app/calculator.js');let count=0;
for(const [weapon,moves]of Object.entries(d.weaponMoves)){
 const move=moves.find(m=>m.woundBurst)||moves.find(m=>m.bowgunPreview&&m.rangedRole==='focus');if(!move)continue;
 const params={weaponId:weapon,moves,attack:200,element:0,affinity:0,skills:[],sharpness:d.sharpness.white,hitzones:{Slash:45,Blow:45,Shot:45},scarRaw:2,context:{wound:true}};
 const expected=weapon==='bow'?[50,132.5,264.5,401.2]:[30,80,160];
 for(let i=0;i<expected.length;i++){
  const r=C.calculateCombo({...params,combo:[{moveId:move.id,wound:true,woundCount:i+1,rangedWholeVersion:1}]});
  const bursts=r.hits.filter(h=>h.woundBurst),raw=bursts.reduce((a,h)=>a+h.raw,0);
  assert.ok(Math.abs(raw-expected[i]*2)<1e-8,weapon+' / '+(i+1)+' wounds: '+raw);count++;
 }
 if(move.woundBurst){
  const original=JSON.stringify(move);
  assert.deepEqual(JSON.parse(JSON.stringify(move.woundBurstSteps)),weapon==='bow'?{1:50,2:82.5,3:132,4:136.7}:{1:30,2:50,3:80});
  const legacy={...move,woundBurst:move.woundBurstSteps};delete legacy.woundBurstSteps;
  const r=C.calculateCombo({...params,moves:moves.map(m=>m.id===move.id?legacy:m),combo:[{moveId:move.id,wound:true,woundCount:2,rangedWholeVersion:1}]});
  assert.ok(Math.abs(r.hits.filter(h=>h.woundBurst).reduce((a,h)=>a+h.raw,0)-expected[1]*2)<1e-8);
  assert.equal(JSON.stringify(move),original);
 }
}
console.log(count+' wound accumulation checks passed across weapons');

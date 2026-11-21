import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire}from'node:module';
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../app/calc-data.js',import.meta.url),'utf8'),ctx);
const d=ctx.window.MHWCALC,C=createRequire(import.meta.url)('../app/calculator.js');
const calc=item=>C.calculateCombo({weaponId:'bow',moves:d.weaponMoves.bow,attack:200,element:300,elementType:'Fire',affinity:0,hitzones:{Shot:45,Slash:45,Fire:20},sharpness:d.sharpness.white,skills:[],scarRaw:2,combo:[{moveId:'bow_051',rangedWholeVersion:1,rangedVariant:2,wound:true,...item}]});
const base=calc({woundCount:0,rangedFollowHits:2});
assert.equal(base.hits.filter(h=>h.woundBurst).length,0);
for(const [count,expected]of [[1,100],[2,265],[3,529],[4,802.4]]){
 const r=calc({woundCount:count,rangedFollowHits:2});
 assert.ok(Math.abs(r.woundBurst.raw-expected)<1e-8);
 assert.equal(r.hits.filter(h=>!h.woundBurst).length,base.hits.length);
 assert.ok(Math.abs(r.totalDamage-base.totalDamage-expected)<.02);
}
const many=calc({woundCount:0,rangedFollowHits:100}),before=calc({woundCount:0,rangedFollowHits:99});
assert.equal(many.hits.length,before.hits.length+1);
assert.ok(many.totalDamage>before.totalDamage);
const off=calc({wound:false,woundCount:3,rangedFollowHits:100});
assert.equal(off.hits.length,5);assert.equal(off.woundBurst.raw,0);
console.log('Bow focus: independent wounds, zero-wound weakpoint, follow-up beyond 99, and disabled follow-up passed');

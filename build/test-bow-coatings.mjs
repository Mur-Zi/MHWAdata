import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../app/calc-data.js',import.meta.url),'utf8'),ctx);
const d=ctx.window.MHWCALC,C=createRequire(import.meta.url)('../app/calculator.js');
const p={weaponId:'bow',moves:d.weaponMoves.bow,weaponGroups:d.weaponGroups,attack:200,element:300,elementType:'Fire',status:0,statusType:'None',affinity:0,skills:[],sharpness:d.sharpness.white,hitzones:{Shot:45,Slash:45,Fire:20,Stun:100},isHead:true};
const item=(bowCoating,extra={})=>({moveId:'bow_001',rangedWholeVersion:1,rangedVariant:4,bowCoating,...extra});
const calc=(coating,extra={},options={})=>C.calculateCombo({...p,...options,combo:[item(coating,extra)]});
let checks=0;const near=(a,b)=>{assert.ok(Math.abs(a-b)<1e-8,a+' != '+b);checks++;};
const normal=calc('none');
for(const [id,mult]of [['power',1.35],['close',1.4]]){
 const r=calc(id);near(r.totalRaw,normal.totalRaw*mult);near(r.totalElement,normal.totalElement);near(r.panel.attackAfter,normal.panel.attackAfter);near(r.hits[0].mv,normal.hits[0].mv);
}
for(const id of ['poison','paralysis','sleep','blast']){
 const r=calc(id);near(r.totalRaw,normal.totalRaw);near(r.totalElement,0);near(r.totalStatus,15);
 near(calc(id,{rangedVariant:0}).totalStatus,2);near(calc(id,{rangedVariant:2}).totalStatus,11);
 near(calc(id,{}, {statusType:'Blast',status:999}).totalStatus,15);
}
const poison=d.skills.find(s=>s.id==='HunterSkill_010'),paralysis=d.skills.find(s=>s.id==='HunterSkill_011');
near(calc('poison',{}, {skills:[{skill:poison,level:3}]}).totalStatus,25.5);
near(calc('paralysis',{}, {skills:[{skill:poison,level:3}]}).totalStatus,15);
near(calc('paralysis',{}, {skills:[{skill:paralysis,level:3}]}).totalStatus,25.5);
const exhaust=calc('exhaust');near(exhaust.totalStatus,0);near(exhaust.totalExhaust,15);near(exhaust.totalStun,7.5);
near(calc('exhaust',{}, {isHead:false}).totalStun,0);
near(calc('exhaust',{}, {skills:[{skill:d.skills.find(s=>s.id==='HunterSkill_033'),level:3}]}).totalExhaust,21);
const blade=d.skills.find(s=>s.id==='custom_bladescale_loading');
near(calc('power',{}, {skills:[{skill:blade,level:1}]}).totalRaw,normal.totalRaw*1.35*1.25);
near(calc('none',{}, {skills:[{skill:blade,level:1}]}).totalRaw,normal.totalRaw);
const legacy=C.calculateCombo({...p,combo:[{moveId:'bow_001',rangedWholeVersion:1,rangedVariant:5,rangedHits:2}]}),pierce=calc('pierce',{rangedHits:2});
near(legacy.totalDamage,pierce.totalDamage);near(pierce.hits.length,6);
near(C.bowCoatingVariant(d.weaponMoves.bow[0],{rangedVariant:5},'power'),4);
const mixed=C.calculateCombo({...p,combo:[item('poison'),item('power'),item('sleep')]});
near(mixed.totalStatus,30);near(mixed.totalElement,normal.totalElement);
for(const m of p.moves.filter(m=>m.bowCoatings)){
 assert.equal(m.bowCoatings.length,9);
 for(const coating of m.bowCoatings){const r=C.calculateCombo({...p,combo:[{moveId:m.id,bowCoating:coating.id,rangedWholeVersion:1}]});assert.ok(Number.isFinite(r.totalDamage));}
}
const focus=C.calculateCombo({...p,combo:[{moveId:'bow_051',wound:true,woundCount:4,bowCoating:'power',rangedWholeVersion:1}],scarRaw:1});near(focus.woundBurst.raw,401.2);
console.log(checks+' coating checks plus all supported move/coating combinations passed');

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8'),w={};
for(const f of ['data.js','kuro-hzv.js','calc-data.js'])new Function('window',read('app/'+f))(w);
const source=JSON.parse(read('raw/kuro-monsters-20261120.json')),k=w.MHWILD_KURO_HZV,raw=w.MHWILD_RAW,el=['Slash','Blow','Shot','Fire','Water','Thunder','Ice','Dragon','Stun'];
let checks=0;const check=(v,msg)=>{assert.ok(v,msg);checks++;},eq=(a,b,msg)=>check(Math.abs(a-b)<1e-7,`${msg}: ${a} != ${b}`);
// Every source label, numeric row and phase must survive; equal values cannot hide a lost condition.
for(const r of source.rows){
 if(r.monster==='Guardian Arkveld'&&['頭','鎖翼刃'].includes(r.label))continue; // Explicit user replacements.
 const candidates=Object.values(k[r.monster]).flatMap(p=>[...Object.values(p.groups).flat(),...(p.at||[]),...(p.wounds||[])]);
 check(candidates.some(x=>x.sourceLabel===r.label&&x.sourceSection===r.section&&el.every((e,i)=>x.m[e]===r.values[i])&&x.extract===r.extract),r.monster+'/'+r.section+'/'+r.label);}
check(Object.keys(raw['Monster Data']).length===36,'36 monster records');check(w.MHWILD_META.monsterCount===36,'metadata monster count');check(!Object.values(raw['Monster Data']).some(d=>d.SourceOnly&&d.Zako),'small monster records removed');check(!k['Omega Micros']&&!k.Dalthydon,'small monster HZV removed');check(Object.keys(raw['Quest Data']).length===602,'602 quests');
const q=raw['Quest Data']['25425'];check(q?.Level===10&&Object.values(q.Targets).flat().every(t=>t.legendaryID===2&&raw.Difficulty._DifficultyRateArray._DataArray[t.diff]),'new arch-tempered task has valid difficulty');
eq(k.Chatacabra.Tongue.groups['普通'][0].m.Slash,85,'tongue slash');eq(k.Chatacabra.Tongue.groups['普通'][0].m.Shot,90,'tongue shot');
eq(k.Nerscylla['Leg Tip'].groups['普通'][0].m.Slash,28,'spider leg tip');
eq(k['Omega Planetes'].Head.groups['普通'][0].m.Slash,45,'omega before failure');eq(k['Omega Planetes'].Head.groups['克隆影蜘蛛讨伐失败后'][0].m.Slash,40,'omega after failure');
check(k['Zoh Shia'].Head.wounds.some(x=>x.m.Slash===70)&&k['Zoh Shia'].Head.wounds.some(x=>x.m.Slash===75),'state-specific wounds retained');
for(const n of w.MHWILD_META.monsterOrder){const d=raw['Monster Data'][raw['Monster Names'][n]];check(!!d,n+' reachable');check(fs.existsSync(new URL('app/'+w.MHWILD_META.imageMap[n].icon,root)),n+' icon exists');if(d.SourceOnly)check(!('BHP' in d)&&d.CantCap===null,n+' no fabricated thresholds');}
check(raw['Monster Data'][raw['Monster Names']['Guardian Arkveld']].CantCap,'guardian Arkveld not capturable');
const training=raw['Monster Data'][raw['Monster Names']['High Purrformance Barrel Puncher']];
for(const r of training.Hitzones.Rows){eq(r.Meat.Slash,r.Part==='Back Panel'?20:80,'training physical override');eq(r.Meat.Fire,r.Part==='Back Panel'?5:30,'training element override');if(!['Front Panel','Side Panel'].includes(r.Part))check(!r.ScarMeat&&!r.Wound,'training wounds only on front/side');}
const tp=k['High Purrformance Barrel Puncher'];check(Object.keys(tp).length===5,'five named training parts');
for(const [part,p]of Object.entries(tp)){const a=p.groups['软肉质'],b=p.groups['硬肉质'];check(!p.groups['普通'],'training modes use separate directories');eq(a[0].m.Slash,part==='Back Panel'?20:80,'soft remains default');check(a.length===1&&b.length===1,'one row per mode');for(const e of el.slice(0,3))eq(b[0].m[e],part==='Back Panel'?20:40,'hard physical');for(const e of el.slice(3,8))eq(b[0].m[e],part==='Back Panel'?5:15,'hard element');check(!!p.wound===['Front Panel','Side Panel'].includes(part),'training wound availability unchanged');}
const allRows=n=>Object.values(k[n]||{}).flatMap(p=>[...Object.values(p.groups).flat(),...(p.at||[]),...(p.wounds||[])]);
const rawReview=JSON.parse(read('raw/hzv-source-differences-20261120.json')),rawSource=JSON.parse(read('raw/robomeche-hzv-20261120.json'));
for(const [n,pp]of Object.entries(k))for(const [p,v]of Object.entries(pp)){
 check(!/^RoboHidden|^Unmatched|^HIDE$/.test(p),n+' no unconfirmed part in picker');
 check(!Object.keys(v.groups).some(g=>/原始数据库|原表破坏后/.test(g)),n+' no source directories');
 for(const x of [...Object.values(v.groups).flat(),...(v.wounds||[])])check(!/State [0-9]|状态 [0-9]|AT Wnd|RoboMechE·/.test(x.s),n+' no undecided state');
}
for(const part of ['Head','Torso','Belly'])check(!k.Nerscylla[part].groups['普通'].some(x=>x.s==='破坏后'),'Nerscylla '+part+' no speculative break mapping');
for(const n of ['Nerscylla','Nerscylla Clone'])check(k[n]['Leg Root']&&k[n]['Leg Tip']&&!k[n].Foreleg&&!k[n]['Hind Leg'],'spider anatomy follows Japanese classification');
eq(k.Chatacabra.Foreleg.groups['普通'].find(x=>x.reviewed).m.Blow,70,'confirmed frog broken foreleg');
check(k.Chatacabra.Foreleg.groups['普通'].some(x=>x.s==='缠石'&&x.m.Slash===50),'frog intact stone condition');
check(k.Chatacabra.Foreleg.groups['普通'].some(x=>x.s==='破坏后·缠石'&&x.m.Slash===55),'frog broken stone condition');
check(k.Chatacabra.Foreleg.groups['普通'].some(x=>x.s==='破坏后'&&x.m.Slash===75),'frog other broken HZV retained');
eq(k['Guardian Arkveld'].Head.groups['普通'][0].m.Fire,10,'guardian ordinary head replaced');
eq(k['Guardian Arkveld'].Chainblade.groups['普通'][0].m.Dragon,20,'guardian ordinary chainblade replaced');
for(const [n,parts]of [['Arkveld',['Head','Chainblade','Torso','Leg','Tail']],['Uth Duna',['Head','Torso','Foreleg','Hind Leg','Tail']]])for(const part of parts){
 const p=k[n][part],at=p.wounds.filter(x=>x.archTempered&&x.tempered);check(at.length===1,n+'/'+part+' one AT tempered wound');
 check(p.wounds.some(x=>!x.archTempered),n+'/'+part+' ordinary wound retained');
}
check(!k.Arkveld.Wing.wounds.some(x=>x.archTempered),'Arkveld other-parts mapping uses user list');
check(!k['Uth Duna'].Veil.wounds.some(x=>x.archTempered),'veil is not a wound target');
eq(k.Arkveld.Chainblade.wounds.find(x=>x.archTempered).m.Dragon,30,'AT chainblade dragon30');
eq(k['Uth Duna'].Head.wounds.find(x=>x.archTempered).m.Shot,70,'AT Uth head shot70');
eq(k.Gogmazios.Waist.groups['普通'][0].m.Slash,20,'Gog waist no longer conflated with back');
eq(k.Seregios.Neck.wound.Slash,60,'conflicting neck wound unchanged pending decision');
check(k['Omega Planetes']['Rear Power Unit'].wounds.some(x=>x.m.Slash===80&&x.m.Shot===20),'known rear power unit wound integrated');
const pending=JSON.parse(read('raw/hzv-pending-decisions-20261121.json'));
check(pending.states.length===83,'all 83 numbered/AT states listed for review');check(pending.unknown.length===50,'all unnamed and hidden rows listed');
check(pending.pending.map(r=>r.id).join(',')==='A54,A56,A58,A60,A62,A68,A70','only seven unmatched spider State2 rows need confirmation; IDs stable');
check(pending.pending.every(r=>!r.matchingExisting.length&&r.status==='pending'),'no covered rows in pending queue');
check(pending.resolved.some(r=>r.id==='A01'&&r.status==='covered')&&pending.resolved.some(r=>r.id==='A03'&&r.status==='covered'),'frog stone and Gog down matches need no reconfirmation');
const spiderBase={
 Head:[[50,65,50,15,0,0,5,0,100],[50,50,50,25,0,0,5,0,100]],
 Claw:[[20,30,20,5,0,10,5,0,0],[30,30,30,5,0,5,5,0,0]],
 Torso:[[36,36,40,25,0,0,5,0,0]],'Leg Root':[[35,35,25,20,0,0,5,0,0]],
 Mantle:[[45,45,35,20,0,0,5,0,0]],'Leg Tip':[[28,35,20,10,0,0,5,0,0]],
 Stinger:[[28,35,65,25,0,0,5,0,0],[30,30,30,25,0,0,5,0,0]],
 Belly:[[65,50,45,15,0,20,5,0,0],[45,45,45,25,0,10,5,0,0]]
};
for(const [ni,n]of ['Nerscylla','Nerscylla Clone'].entries()){
 check(Object.keys(k[n]).length===8,n+' exactly eight reviewed anatomical parts');
 for(const [part,vs]of Object.entries(spiderBase)){
  const p=k[n][part],v=vs[ni]||vs[0];check(el.every((e,i)=>p.groups['普通'][0].m[e]===v[i]),n+'/'+part+' ordinary values equal approved comparison');
  const wound=part==='Head'?[75,75,75,25,0,15,15,0,100]:[55,55,45,25,0,25,15,0,0];
  check(el.every((e,i)=>p.wound[e]===wound[i]),n+'/'+part+' wound equals approved comparison');
 }
}
const cloneFallback=raw['Monster Data'][raw['Monster Names']['Nerscylla Clone']].Hitzones.Rows;
check(cloneFallback.some(r=>r.Part==='Leg Root')&&!cloneFallback.some(r=>r.Part==='Leg'),'clone fallback uses reviewed anatomy');
check(cloneFallback.every(r=>r.ScarMeat),'clone fallback wound data retained');
for(const r of [...pending.states,...pending.unknown,...pending.conflicts]){const original=rawSource.monsters.find(d=>d.name===r.monster).rows[r.index][r.field];check(el.every((e,i)=>original[e]===r.values[i]),r.monster+' pending values match source');}
const C=createRequire(import.meta.url)('../app/calculator.js'),data=w.MHWCALC;
const calc=(wid,name,target={},extra={})=>C.calculateCombo({weaponId:wid,moves:data.weaponMoves[wid],weaponGroups:data.weaponGroups,attack:200,element:200,elementType:'Fire',statusType:'None',affinity:0,sharpness:data.sharpness.white,hitzones:{Slash:50,Blow:50,Shot:50,Fire:30,Dragon:30},mode:'expected',combo:[{moveId:data.weaponMoves[wid].find(m=>m.name===name).id,rangedHits:3}],target,...extra});
for(const wid of ['light_bowgun','heavy_bowgun'])for(const [ammo,t,mul]of [['Lv2火炎弹',{name:'Gogmazios'},.85],['Lv2灭龙弹',{name:'Gogmazios'},.35],['Lv2灭龙弹',{name:'Zoh Shia',questLevel:10},.7]]){
 const moves=data.weaponMoves[wid],chosen=moves.find(m=>m.name===ammo)||moves.find(m=>m.name.includes(ammo.replace('Lv2','')));check(!!chosen,ammo+' exists');
 const a=calc(wid,chosen.name),b=calc(wid,chosen.name,t);eq(a.totalRaw,b.totalRaw,'element resistance does not change raw');
 b.hits.forEach((h,i)=>eq(h.element,Math.round((a.hits[i].damageBeforeTarget.element*mul+1e-10)*10)/10,'element resistance before final rounding'));eq(b.totalDamage,b.hits.reduce((s,h)=>s+h.total,0),'damage summary matches hits');
}
const first=data.weaponMoves.great_sword.find(m=>m.hits?.length&&!m.hits[0].shelling);
const plain=calc('great_sword',first.name),veil=calc('great_sword',first.name,{name:'Uth Duna',part:'Veil'});
eq(veil.totalRaw,plain.totalRaw*.4,'veil physical reduction');eq(veil.totalElement,plain.totalElement,'veil does not reduce element');
const absorbed=calc('great_sword',first.name,{name:'Arkveld',label:'历战王·属性吸收状态',absorbFirst:true});eq(absorbed.hits[0].element,0,'first element absorbed');
const noAbsorb=calc('great_sword',first.name,{name:'Arkveld',label:'历战王·属性吸收状态',absorbFirst:false});eq(noAbsorb.totalElement,plain.totalElement,'absorption optional');
const stunMove=data.weaponMoves.hammer.find(m=>m.hits?.some(h=>h.stun>0));
const stunResult=v=>calc('hammer',stunMove.name,{}, {isHead:true,hitzones:{Slash:50,Blow:50,Fire:30,Stun:v}});
check(stunResult(100).totalStun>0,'stun fixture active');eq(stunResult(0).totalStun,0,'zero stun HZV prevents accumulation');eq(stunResult(30).totalStun,stunResult(100).totalStun*.3,'stun HZV scales accumulation');
const fire=data.weaponMoves.light_bowgun.find(m=>m.name==='Lv2火炎弹');eq(calc('light_bowgun',fire.name,{name:'Ajarakan',part:'Head',label:'红莲',headOn:true}).totalDamage,0,'head-on projectile immunity');
check(calc('light_bowgun',fire.name,{name:'Ajarakan',part:'Head',label:'普通',headOn:true}).totalDamage>0,'normal head not immune');
// Veil also affects HZV-ignoring physical damage, while wound bursts stay independent.
const gl=data.weaponMoves.gunlance.find(m=>m.id==='gl_shell');
const ga=calc('gunlance',gl.name,{}, {gunlance:{type:'normal',level:1},shellTable:data.gunlanceShell});
const gb=calc('gunlance',gl.name,{name:'Uth Duna',part:'Veil'}, {gunlance:{type:'normal',level:1},shellTable:data.gunlanceShell});
check(ga.hits.some(h=>h.shelling&&h.raw>0),'shell fixture has actual damage');eq(gb.totalRaw,ga.totalRaw*.4,'veil shell physical reduction');eq(gb.totalElement,ga.totalElement,'veil shell fire unchanged');eq(gb.shelling.raw,gb.hits.filter(h=>h.shelling).reduce((a,h)=>a+h.raw,0),'shell aggregate matches details');
console.log(`${checks} checks passed: all ${source.rows.length} source rows, task linkage, records, overrides and conditional damage.`);

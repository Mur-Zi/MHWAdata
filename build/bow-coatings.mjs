import fs from 'node:fs';import vm from 'node:vm';import {pathToFileURL}from'node:url';
const source=JSON.parse(fs.readFileSync(new URL('../raw/bow-coating-source-20261121.json',import.meta.url),'utf8'));
export function applyBowCoatings(data){
 const options=[{id:'none',label:'无瓶'},{id:'power',label:'强击瓶',physical:source.physical.power},{id:'close',label:'接击瓶',physical:source.physical.close},{id:'pierce',label:'贯通瓶'},...Object.entries({poison:['毒瓶','Poison'],paralysis:['麻痹瓶','Paralyze'],sleep:['睡眠瓶','Sleep'],blast:['爆破瓶','Blast'],exhaust:['减气瓶','Exhaust']}).map(([id,[label,statusType]])=>({id,label,statusType,status:source.baseStatus,...(id==='exhaust'?{stun:source.baseStun}:{})}))];
 for(const m of data.weaponMoves.bow){
  if(!['charge','quick','power','volley','dragon','thousand','flying','melee'].includes(m.rangedRole))continue;
  m.bowCoatings=structuredClone(options);m.bowCoatingMelee=m.id==='bow_067';
  for(const v of m.rangedVariants||[m]){
   if(m.bowCoatingMelee)v.hits.forEach(h=>h.type='SLASH');
   if(v.coatingType==='pierce')continue;
   const rates=source.statusRates[v.nameJa];
   if(rates)v.hits.forEach((h,i)=>h.statusRate=rates[i]??rates[0]);
  }
 }
 const skill=data.skills.find(s=>s.id==='custom_bladescale_loading');
 if(skill&&!skill.weapons.includes('bow')){skill.weapons.push('bow');skill.levels[0].explain='触发时弩的物理弹伤×1.4，弓的装瓶物理伤害×1.25。';}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const file=new URL('../app/calc-data.js',import.meta.url),src=fs.readFileSync(file,'utf8'),ctx={window:{}};vm.runInNewContext(src,ctx);applyBowCoatings(ctx.window.MHWCALC);
 fs.writeFileSync(file,src.slice(0,src.indexOf('window.MHWCALC = '))+'window.MHWCALC = '+JSON.stringify(ctx.window.MHWCALC)+';\n');console.log('Bow coatings updated');
}

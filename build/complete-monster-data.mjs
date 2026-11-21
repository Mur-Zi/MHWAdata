// Reconcile the reviewed 2026-11-20 source snapshot without replacing user overrides.
import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const w={};for(const f of ['data.js','kuro-hzv.js'])new Function('window',read('app/'+f))(w);
const src=JSON.parse(read('raw/kuro-monsters-20261120.json')),old=w.MHWILD_KURO_HZV;
const excludedSmall=new Set([...Object.keys(w.MHWILD_TR.small),'Ceratonoth (Female)']);
const {parts,groups,states,special,noteDelete}=src.mapping;
Object.assign(parts,{'脚先端':'Leg Tip','体':'Torso','全身':'Whole Body'});
Object.assign(states,{'防御態勢':'防御姿态','イベクエ「七色のかばね」':'活动任务「七色的尸骸」'});
const el=['Slash','Blow','Shot','Fire','Water','Thunder','Ice','Dragon','Stun'];
const phase={'肉質':'普通','怒り':'发怒','怒り(挑戦者用)':'发怒（挑战者判定）','最終形態':'最终形态','ネルスキュラ・クローン討伐失敗後':'克隆影蜘蛛讨伐失败后'};
const noteTranslations={
 '狭角もこの肉質です。':'铗角也采用此肉质。',
 '狭角による攻撃後に出現します。':'铗角攻击后出现。',
 '爪を破壊すると、左爪のみがなくなります。':'破坏爪后，仅左爪消失。',
 '第2形態のダウン時に出現します。':'第二形态倒地时出现。',
 '交戦状態になり、頭をこちらに向けた状態だとこの肉質になります。':'交战后面向猎人的防御姿态采用此肉质。',
 'イベントクエスト「七色のかばね」に登場するブブラチカはこの肉質になります。':'活动任务「七色的尸骸」中的血盗虫采用此肉质。',
 'ゴグマジオスは、ボウガンの火炎弾の属性ダメージを0.85倍に、滅龍弾の属性ダメージを0.35倍に軽減します。':'弩的火炎弹属性伤害×0.85，灭龙弹属性伤害×0.35。',
 '★10個体は滅龍弾の属性ダメージを0.7倍にします。ダメシミュで計算したい場合はモンスター名の右（全体防御率の左）にある★10ボタンを押してください。':'10★个体受到的灭龙弹属性伤害×0.7。',
 '頭の上部あたりに正面から弾を当てると無効化されます。（画像）':'正面射击头顶时，弹击无效。',
};
const result={};
for(const r of src.rows){
 if(excludedSmall.has(r.monster))continue;
 const n=r.monster,label=r.label,base=label.replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/^ダウン中の|^水中にいる時の/,'');
 // User correction: this source row does not represent an actual AT HZV.
 if(n==='Arkveld'&&label==='鎖翼刃[弱点](歴戦王)')continue;
 const sp=Object.entries(special).find(([k])=>label===k||label===k+'[傷]');
 const part=n==='Gogmazios'&&base==='腰'?'Waist':sp?sp[1].en:parts[base];if(!part)throw Error('Unmapped part '+n+': '+label);
 const words=[...label.matchAll(/\(([^)]*)\)/g)].flatMap(x=>x[1].split('、'));
 let group=phase[r.section]||r.section,state=sp?sp[1].state:words.filter(x=>!x.includes('歴戦王')).map(x=>states[x]||x).join('·')||'普通';
 const at=words.some(x=>x.includes('歴戦王')),wound=label.includes('[傷]'),weak=label.includes('弱');
 const override=words.find(x=>groups[n]?.[x]);if(override){group=groups[n][override];state=words.filter(x=>x!==override).map(x=>states[x]||x).join('·')||'普通';}
 if(n==='Omega Planetes'&&group==='普通')state=state==='普通'?'克隆影蜘蛛讨伐失败前':'克隆影蜘蛛讨伐失败前·'+state;
 if(label.startsWith('水中にいる時の')){group='水中';}
 if(label.startsWith('ダウン中の'))state='第二形态倒地'+(state==='普通'?'':'·'+state);
 if(weak){state=(group!=='普通'?group+'·':'')+(state==='普通'?'':state+'·')+(label.includes('遅め')?'临时弱点消失前命中':'普通');group='临时弱点';}
 const p=(result[n]||={})[part]||=( {groups:{},at:null,wound:null,wounds:[]} );
 const meat=Object.fromEntries(el.map((e,i)=>[e,r.values[i]]));
 const previous=old[n]?.[part]||old[n]?.[part==='Leg Tip'?'Leg':part];
 const oldRows=previous?[...Object.values(previous.groups||{}).flat(),...(previous.at||[])]:[];
 const match=oldRows.find(x=>el.every(e=>x.m[e]===meat[e]));
 let note=noteTranslations[r.note]??match?.note??'';
 if(/属性を吸収/.test(r.note))note='锁刃合为1根时，首hit可能吸收属性并使属性伤害无效；经过一定时间会恢复吸收。吸收足够属性伤害后进入锁刃解放状态。';
 const del=noteDelete[n];if(del===true||del?.parts?.includes(part)||del?.groups?.includes(group))note='';
 // Damage-relevant conditions remain visible even where old general notes were removed.
 if(n==='Ajarakan'&&part==='Head'&&group==='红莲')note='正面射击头顶时，弹击无效。';
 if(n==='Gogmazios'&&part==='Head'&&state==='普通')note=noteTranslations[Object.keys(noteTranslations).find(k=>k.startsWith('ゴグマジオス'))];
 if(n==='Zoh Shia'&&part==='Head'&&group==='普通'&&state==='普通')note=noteTranslations[Object.keys(noteTranslations).find(k=>k.startsWith('★10'))];
 const row={s:state,m:meat,extract:r.extract,note,source:'kuroyonhon',sourceLabel:label,sourceSection:r.section};
 if(wound){row.s=(at?'历战王·':'')+(group==='普通'?'':group+'·')+(state==='普通'?'':state);row.s=row.s.replace(/·$/,'');p.wounds.push(row);if(!p.wound)p.wound=meat;}
 else if(at)(p.at||=[]).push(row);
 else (p.groups[group]||=[]).push(row);
}
// Keep every condition, but remove repeated source rows with identical labels and values.
for(const pp of Object.values(result))for(const p of Object.values(pp)){
 const unique=arr=>arr.filter((r,i)=>arr.findIndex(x=>x.s===r.s&&x.sourceLabel===r.sourceLabel&&x.sourceSection===r.sourceSection&&JSON.stringify(x.m)===JSON.stringify(r.m))===i);
 for(const k of Object.keys(p.groups))p.groups[k]=unique(p.groups[k]);
 if(p.at)p.at=unique(p.at);p.wounds=unique(p.wounds);
}
const raw=w.MHWILD_RAW,tr=w.MHWILD_TR,meta=w.MHWILD_META;
for(const [id,d]of Object.entries(raw['Monster Data']))if(d.SourceOnly&&d.Zako){
 delete raw['Monster Data'][id];delete raw['Monster Names'][d.Name];delete tr.monster[d.Name];delete meta.imageMap[d.Name];
 meta.monsterOrder=meta.monsterOrder.filter(n=>n!==d.Name);
}
// RAW-only anatomical parts must not disappear when the preferred source omits them.
const supplemental=[];
for(const d of Object.values(raw['Monster Data'])){
 if(d.SourceOnly)continue;
 const pp=result[d.Name];if(!pp)continue;
 for(const r of d.Hitzones?.Rows||[]){
  if(d.Name==='Nerscylla'&&['Foreleg','Hind Leg'].includes(r.Part))continue;
  if(!r.Meat||pp[r.Part]||/^(HIDE|Unmatched|Weak Point|All Others|Others)/.test(r.Part))continue;
  const existing=Object.values(pp).flatMap(p=>[...Object.values(p.groups).flat(),...(p.at||[]),...(p.wounds||[])]);
  if(r.Part!=='Tongue'&&existing.some(x=>el.every(e=>x.m[e]===r.Meat[e])))continue;
  const rows=(d.Hitzones.Rows||[]).filter(x=>x.Part===r.Part&&x.Meat&&(!x.State||x.State==='Break*')).map(x=>({s:x.State==='Break*'?'破坏后':'普通',m:x.Meat,extract:({1:'赤',2:'白',3:'橙',4:'緑'})[x.KE]||'',note:'',source:'robomeche'}));
  pp[r.Part]={groups:{普通:rows},at:null,wound:r.ScarMeat||null,wounds:r.ScarMeat?[{s:'',m:r.ScarMeat}]:[]};supplemental.push(d.Name+'/'+r.Part);
 }
}
Object.assign(tr.monster,{'Nerscylla Clone':'克隆影蜘蛛'});Object.assign(tr.part,{'Leg Tip':'脚尖','Whole Body':'全身'});
// Merge only named, understood conditions. Unresolved states stay in the review report.
const rawSource=JSON.parse(read('raw/robomeche-hzv-20261120.json'));
let rawAdded=0,brokenAdded=0;
for(const d of rawSource.monsters){
 if(d.name==='High Purrformance Barrel Puncher'||excludedSmall.has(d.name)||!result[d.name])continue;
 for(const [index,r]of d.rows.entries()){
  if(/^(HIDE|Unmatched|Weak Point|All Others|Others)/.test(r.Part))continue;
  const p=result[d.name][r.Part];if(!p)continue;
  const equal=m=>Object.values(p.groups).flat().some(x=>el.every(e=>x.m[e]===m[e]));
  // Nerscylla follows the Japanese anatomical classification; raw break flags
  // are not evidence that the named anatomical part itself was broken.
  if(d.name!=='Nerscylla'&&r.State==='Break*'&&r.Meat&&!equal(r.Meat)){
   const existing=Object.values(p.groups).flat().filter(x=>/破坏|破壊|切断/.test(x.s));
   if(!existing.length){(p.groups['普通']||=[]).push({s:'破坏后',m:r.Meat,extract:({1:'赤',2:'白',3:'橙',4:'緑'})[r.KE]||'',note:'',source:'robomeche',sourceIndex:index,sourceField:'Meat'});rawAdded++;brokenAdded++;}
  }
  if(!r.State&&r.ScarMeat&&Number(r.Wound?.Number)>0&&!p.wounds.length&&!p.wound){
   const base=Object.entries(p.groups).flatMap(([g,rs])=>rs.filter(x=>el.every(e=>x.m[e]===r.Meat[e])).map(x=>({g,s:x.s})));
   const labels=[...new Set(base.map(x=>(x.g==='普通'?'':x.g+'·')+(x.s==='普通'?'':x.s)))];
   if(labels.length===1){p.wound=r.ScarMeat;p.wounds=[{s:labels[0],m:r.ScarMeat,extract:({1:'赤',2:'白',3:'橙',4:'緑'})[r.KE]||'',note:'',source:'robomeche',sourceIndex:index,sourceField:'ScarMeat'}];rawAdded++;}
  }
 }
}
// User-reviewed mappings, 2026-11-21. Keep provenance without exposing raw keys.
const reviewedRow=(name,index,label)=>{
 const r=rawSource.monsters.find(d=>d.name===name).rows[index];
 return {s:label,m:r.Meat,extract:({1:'赤',2:'白',3:'橙',4:'緑'})[r.KE]||'',note:'',source:'robomeche',sourceIndex:index,sourceField:'Meat',reviewed:true};
};
const frogRows=result.Chatacabra.Foreleg.groups['普通'];
for(const x of [...frogRows,...result.Chatacabra.Foreleg.wounds])x.s=x.s.replaceAll('粘着','缠石');
frogRows.find(x=>x.s==='破坏后').note='未缠石时的破坏后肉质；历战个体破坏前腿后不会变成此肉质。缠石时使用“破坏后·缠石”肉质。';
const brokenStone=reviewedRow('Chatacabra',6,'破坏后·缠石');
brokenStone.note='前腿已破坏且处于缠石状态时使用；未破坏的缠石前腿斩击肉质为50。';
frogRows.push(brokenStone);
for(const [part,index]of [['Head',1],['Chainblade',9]]){
 const p=result['Guardian Arkveld'][part],row=reviewedRow('Guardian Arkveld',index,'普通');
 row.extract=p.groups['普通'][0].extract;p.groups['普通'][0]=row;
}
// AT is the arch-tempered template; these are tempered wounds, not ordinary wounds.
for(const [name,indexes,otherParts]of [
 ['Arkveld',[12,13,14],['Torso','Leg','Tail']],
 ['Uth Duna',[15,16],Object.keys(result['Uth Duna']).filter(p=>!['Head','Veil'].includes(p))]
])for(const index of indexes){
 const r=rawSource.monsters.find(d=>d.name===name).rows[index];
 const targets=r.Part==='All Others'?otherParts:[r.Part];
 for(const part of targets){const p=result[name][part],row=reviewedRow(name,index,'历战王·历战伤口');row.extract=p.groups['普通']?.[0]?.extract||'';row.tempered=true;row.archTempered=true;p.wounds.push(row);}
}
// These names describe regions, not separate front/hind legs.
Object.assign(tr.part,{'Leg Tip':'脚尖'});
for(const name of ['Nerscylla','Nerscylla Clone']){
 const pp=result[name];pp['Leg Root']=pp.Leg;delete pp.Leg;
 for(const x of pp['Leg Root'].groups['普通'])x.note='腿的根部；后腿根部很难命中。';
 for(const x of pp.Mantle.groups['普通'])x.note=x.s==='普通'?'覆盖腿部的毒怪鸟皮。':'外套膜破坏后，腿部中段采用此肉质。';
 for(const x of pp['Leg Tip'].groups['普通'])x.note='没有外套膜覆盖的脚尖部分。';
 for(const x of pp.Belly.groups['普通'])x.note='吐丝的腹部；毒刺尚在时为无毒刺的腹部下侧，毒刺两阶段破坏后为整个腹部。';
 if(name==='Nerscylla Clone')for(const x of pp.Stinger.groups['普通'])x.note='毒刺一阶段破坏后肉质不变；两阶段破坏后消失，露出腹部。';
}
tr.part['Leg Root']='腿根';tr.part.Waist='腰部';
// The upstream Nerscylla entry contains two monsters, each with a paired
// intact/broken set. State 1 is the clone intact set, State 2 its broken set.
// Keep the break condition at monster scope, not as a claim that every part
// (for example the head) can be independently broken.
const spiderPairs=[['Head',1,3],['Torso',5,7],['Belly',9,11],['Claw',13,15],['Leg Root',18,20],['Mantle',22,24],['Leg Tip',30,32],['Stinger',34,36]];
for(const [part,normalIndex,cloneIndex]of spiderPairs)for(const [name,index]of [['Nerscylla',normalIndex],['Nerscylla Clone',cloneIndex]]){
 const p=result[name][part],row=reviewedRow('Nerscylla',index,'普通');
 row.extract=p.groups['普通'][0].extract;row.sourceMonster='Nerscylla';
 row.note='原始数据库将影蜘蛛与克隆影蜘蛛合并存储；此行为'+(name==='Nerscylla Clone'?'克隆影蜘蛛':'影蜘蛛')+'的整组破坏状态，不表示此部位可单独破坏。';
 p.groups['破坏后']=[row];
}
for(const key of Object.keys(tr.part))if(/^RoboHidden/.test(key))delete tr.part[key];
const cloneNames=new Set(['Nerscylla Clone']);
// Training target: user keeps soft HZV as default; hard mode is independently selectable.
const trainingName='High Purrformance Barrel Puncher',training=raw['Monster Data'][raw['Monster Names'][trainingName]];
if(training){
 result[trainingName]={};
 for(const r of training.Hitzones.Rows){
  if(!r.Meat)continue;
  const back=r.Part==='Back Panel',extract=({1:'赤',2:'白',3:'橙',4:'緑'})[r.KE]||'';
  const soft={s:'',m:r.Meat,extract,note:''};
  r.HardMeat={...r.Meat};if(!back){for(const e of el.slice(0,3))r.HardMeat[e]=40;for(const e of el.slice(3,8))r.HardMeat[e]=15;}
  result[trainingName][r.Part]={groups:{软肉质:[soft],硬肉质:[{s:'',m:r.HardMeat,extract,note:''}]},at:null,wound:r.ScarMeat||null,wounds:r.ScarMeat?[{s:'软／硬肉质共用',m:r.ScarMeat,extract,note:''}]:[]};
 }
}
// Collapse rage-only HZV directories only when every part, substate, value
// and kinsect extract equals the ordinary directory. Enrage damage modifiers
// remain independent of these HZV display groups.
const duplicateAudit=[];
const rowKey=r=>JSON.stringify([r.s,el.map(e=>r.m[e]),r.extract||'']);
const mergeSource=(keep,removed)=>{
 const aliases=[...(keep.sourceAliases||[]),{source:removed.source,sourceLabel:removed.sourceLabel,sourceSection:removed.sourceSection},...(removed.sourceAliases||[])];
 keep.sourceAliases=aliases.filter((r,i)=>r.sourceLabel&&aliases.findIndex(x=>JSON.stringify(x)===JSON.stringify(r))===i);
 if(removed.note&&removed.note!==keep.note)keep.note=[...new Set([keep.note,removed.note].filter(Boolean))].join('\n');
};
// Reviewed anatomy, version and state corrections (2026-11-21).
for(const p of Object.values(result['Gore Magala']))for(const rows of [...Object.values(p.groups),p.wounds])for(const r of rows){
 if(p===result['Gore Magala'].Wing)r.extract='白';
 if(p===result['Gore Magala'].Wingarm)r.s=r.s.replaceAll('特殊','狂龙');
 if(p===result['Gore Magala'].Antenna)r.s='狂龙';
}
for(const name of ['Gore Magala','Mizutsune','Xu Wu']){
 let removedRows=0;
 for(const p of Object.values(result[name])){
  for(const r of p.groups['发怒']||[]){
   const rows=p.groups['普通']||=[];const prior=rows.find(x=>rowKey(x)===rowKey(r));
   if(prior)mergeSource(prior,r);else rows.push(r);removedRows++;
  }
  delete p.groups['发怒'];
  for(const rows of [...Object.values(p.groups),p.wounds])for(const r of rows){
   if(r.s==='发怒')r.s='普通';
   else if(r.s.startsWith('发怒·'))r.s=r.s.slice('发怒·'.length);
  }
 }
 duplicateAudit.push({monster:name,monsterZh:tr.monster[name],removedGroup:'发怒',keptGroup:'普通',removedRows});
}
const frog=result.Chatacabra;
frog.Tongue.groups['临时弱点']=frog.Head.groups['临时弱点'];delete frog.Head.groups['临时弱点'];
for(const pp of Object.values(result))for(const p of Object.values(pp)){
 const weak=p.groups['临时弱点'];
 if(weak?.some(r=>/ver1\.02/.test(r.s))){
  p.groups['临时弱点']=weak.filter(r=>!el.slice(3,8).every(e=>r.m[e]===0));
  for(const r of p.groups['临时弱点'])r.s=r.s.split('·').filter(s=>!/^ver/.test(s)&&s!=='普通').join('·')||'普通';
 }
}
for(const p of Object.values(result['Omega Planetes']))for(const r of p.groups['普通']||[])r.s='普通';
for(const r of result.Quematrice.Head.groups['临时弱点']||[])r.s='普通';
// State-independent wound/weak-point HZV needs only one row per value set.
for(const pp of Object.values(result))for(const p of Object.values(pp))for(const rows of [p.wounds,p.groups['临时弱点']||[]]){
 const buckets=new Map();
 for(const r of rows){const key=JSON.stringify([el.map(e=>r.m[e]),r.extract||'',!!r.tempered,!!r.archTempered]);const list=buckets.get(key)||[];list.push(r);buckets.set(key,list);}
 const merged=[];
 for(const list of buckets.values()){
  const keep=list[0];
  if(list.length>1){for(const r of list.slice(1))mergeSource(keep,r);keep.s=keep.archTempered?'历战王·历战伤口':rows===p.wounds?'':'普通';}
  merged.push(keep);
 }
 rows.splice(0,rows.length,...merged);
}
for(const [name,pp]of Object.entries(result)){
 const groupKey=g=>JSON.stringify(Object.entries(pp).flatMap(([part,p])=>(p.groups[g]||[]).map(r=>JSON.stringify([part,rowKey(r)]))).sort());
 for(const group of ['发怒','发怒（挑战者判定）']){
  if(!Object.values(pp).some(p=>p.groups[group]?.length)||groupKey(group)!==groupKey('普通'))continue;
  let removedRows=0;
  for(const p of Object.values(pp)){
   for(const r of p.groups[group]||[]){mergeSource(p.groups['普通'].find(x=>rowKey(x)===rowKey(r)),r);removedRows++;}
   delete p.groups[group];
   for(const rows of [...Object.values(p.groups),p.wounds])for(const r of rows){
    const plain=r.s===group?'':r.s.startsWith(group+'·')?r.s.slice(group.length+1):null;
    if(plain!==null&&rows.some(x=>x!==r&&rowKey(x)===rowKey({...r,s:plain})))r.s=plain;
   }
  }
  duplicateAudit.push({monster:name,monsterZh:tr.monster[name]||name,removedGroup:group,keptGroup:'普通',removedRows});
 }
 for(const p of Object.values(pp))for(const rows of [...Object.values(p.groups),p.at||[],p.wounds]){
  const unique=[];
  for(const r of rows){const prior=unique.find(x=>rowKey(x)===rowKey(r));if(prior)mergeSource(prior,r);else unique.push(r);}
  rows.splice(0,rows.length,...unique);
 }
}
fs.writeFileSync(new URL('raw/hzv-duplicate-groups-20261121.json',root),JSON.stringify({checkedMonsters:Object.keys(result).length,removedGroups:duplicateAudit,removedInvalidRows:[{monster:'Arkveld',part:'Chainblade',sourceLabel:'鎖翼刃[弱点](歴戦王)',reason:'User correction: nonexistent AT row, physical50/50/45 and all elements12'}]},null,2));
for(const name of Object.keys(result))if(!raw['Monster Names'][name]){
 const id='kuro-'+src.rows.find(r=>r.monster===name).id;
 raw['Monster Names'][name]=id;
 raw['Monster Data'][id]={Name:name,Zako:!cloneNames.has(name),CantCap:null,SourceOnly:true,Hitzones:{Rows:Object.entries(result[name]).map(([Part,p])=>({Part,Meat:p.groups['普通']?.[0]?.m||Object.values(p.groups)[0]?.[0]?.m})),MultiPart:[]}};
 if(!meta.monsterOrder.includes(name))meta.monsterOrder.push(name);
 meta.imageMap[name]={slug:name.replaceAll(' ','_'),icon:cloneNames.has(name)?'img/icon/Nerscylla_Icon.png':'img/icon/Small_Monster.svg'};
}
// The source-only clone has no upstream threshold metadata. Its fallback HZV
// must use the same reviewed anatomy and conditions as the visible database.
for(const name of cloneNames){
 const d=raw['Monster Data'][raw['Monster Names'][name]];
 if(d.SourceOnly)d.Hitzones.Rows=Object.entries(result[name]).flatMap(([Part,p])=>
  Object.entries(p.groups).flatMap(([g,rows])=>rows.map(x=>({Part,State:g==='普通'?(x.s==='普通'?'':x.s):g+(x.s==='普通'?'':'·'+x.s),Meat:x.m,...(p.wound?{ScarMeat:p.wound}:{})})))
 );
}
raw['Quest Data']['25425']=JSON.parse(read('raw/quest-25425.json'));
meta.monsterCount=Object.keys(raw['Monster Data']).length;meta.questCount=Object.keys(raw['Quest Data']).length;meta.generatedAt='2026-11-20T00:00:00.000Z';
fs.writeFileSync(new URL('app/data.js',root),'/* Sources: RoboMechE + reviewed Kuroyonhon supplement; user overrides retained. */\n'+['RAW','TR','META'].map(k=>'window.MHWILD_'+k+' = '+JSON.stringify(w['MHWILD_'+k])+';').join('\n')+'\n');
fs.writeFileSync(new URL('app/kuro-hzv.js',root),'// groups: conditional HZV; wounds: state-specific wound HZV; extract: kinsect colour.\nwindow.MHWILD_KURO_HZV = '+JSON.stringify(result)+';\n');
console.log(JSON.stringify({monsters:meta.monsterCount,quests:meta.questCount,sourceRows:src.rows.length,supplemental,rawAdded,brokenAdded},null,2));

import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const w={};for(const f of ['data.js','kuro-hzv.js'])new Function('window',read('app/'+f))(w);
const source=JSON.parse(read('raw/robomeche-hzv-20261120.json')),audit=JSON.parse(read('raw/hzv-source-differences-20261120.json'));
const el=['Slash','Blow','Shot','Fire','Water','Thunder','Ice','Dragon','Stun'];
const flat=n=>Object.entries(w.MHWILD_KURO_HZV[n]||{}).flatMap(([part,p])=>[...Object.entries(p.groups).flatMap(([group,rows])=>rows.map(x=>({...x,part,group}))),...(p.at||[]).map(x=>({...x,part,group:'历战王'})),...(p.wounds||[]).map(x=>({...x,part,group:'伤口'}))]);
const same=(a,b)=>el.every(e=>a?.[e]===b?.[e]);
const label=x=>(w.MHWILD_TR.part[x.part]||x.part)+'·'+x.group+(x.s?'·'+x.s:'');
const applied=(n,i,f)=>flat(n).some(x=>x.sourceIndex===i&&x.sourceField===f);
const make=(n,r,i,f='Meat')=>{
 const own=flat(n).filter(x=>x.part===r.Part),pool=own.length?own:flat(n),m=r[f];let matches=pool.filter(x=>same(x.m,m)).map(x=>label(x)+(own.length?'':'（异名部位，仅同值）'));
 if(n==='Nerscylla')matches.push(...flat('Nerscylla Clone').filter(x=>x.part===r.Part&&same(x.m,m)).map(x=>'克隆影蜘蛛·'+label(x)+'（仅同值）'));
 const best=pool.map(x=>({...x,score:el.filter(e=>x.m[e]===m[e]).length})).sort((a,b)=>b.score-a.score).slice(0,2).map(x=>({label:label(x),values:el.map(e=>x.m[e])}));
 return {monster:n,monsterZh:w.MHWILD_TR.monster[n]||n,index:i,part:r.Part,partZh:r.Part==='HIDE'?'HIDE（部位待确认）':r.Part.startsWith('Unmatched')?r.Part+'（部位未辨识）':w.MHWILD_TR.part[r.Part]||r.Part,state:r.State||'（空白）',field:f,values:el.map(e=>m[e]),woundSlots:r.Wound?.Number??null,matchingExisting:[...new Set(matches)],reference:best};
};
const states=[],unknown=[],conflicts=[],added=[];
for(const d of source.monsters)for(const [i,r]of d.rows.entries()){
 if(!r.Meat)continue;
 if(d.name!=='High Purrformance Barrel Puncher'&&/^(State(?: \d+)?|AT Guardian|AT Wnd)$/.test(r.State||''))states.push(make(d.name,r,i));
 if(r.Part==='HIDE'||r.Part.startsWith('Unmatched'))unknown.push(make(d.name,r,i));
 for(const f of ['Meat','ScarMeat'])if(r[f]&&applied(d.name,i,f))added.push(make(d.name,r,i,f));
}
for(const a of audit.records){
 if(/^(State(?: \d+)?|AT Guardian|AT Wnd)$/.test(a.state||'')||a.part==='HIDE'||a.part.startsWith('Unmatched')||applied(a.monster,a.index,a.field))continue;
 const r=source.monsters.find(d=>d.name===a.monster).rows[a.index];conflicts.push({...make(a.monster,r,a.index,a.field),category:a.category});
}
const mapping=[...audit.rawPartKeysNotSeparatelyListed,['Nerscylla','Foreleg'],['Nerscylla','Hind Leg']].map(([monster,part])=>({monster,monsterZh:w.MHWILD_TR.monster[monster]||monster,part,partZh:w.MHWILD_TR.part[part]||part,rows:source.monsters.find(d=>d.name===monster).rows.flatMap((r,i)=>r.Part===part&&r.Meat?[make(monster,r,i)]:[])}));
const report={checkedAt:'2026-11-21',source:source.source,notes:['State/AT的中文匹配仅按数值提示，不代表已确认触发条件。','未确认条目和来源冲突不进入正式选择列表。','训练靶的软硬肉质和仅前板/侧板伤口设置按用户要求保留。'],counts:{states:states.length,unknown:unknown.length,conflicts:conflicts.length,mapping:mapping.length,added:added.length},states,unknown,conflicts,mapping,added};
fs.writeFileSync(new URL('raw/hzv-pending-decisions-20261121.json',root),JSON.stringify(report,null,2));
const esc=v=>String(v??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const vector=v=>v.slice(0,3).join(' / ')+'；'+v.slice(3,8).join(' / ')+'；'+v[8];
const table=(title,rows,prefix)=>`<section><h2>${title}（${rows.length}条）</h2><div class="scroll"><table><thead><tr><th>编号</th><th>怪物／部位</th><th>原标签／字段／行号</th><th>斩／打／弹</th><th>火／水／雷／冰／龙</th><th>昏厥</th><th>已有同值条目（仅供匹配）</th><th>现有参考值</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${prefix}${String(i+1).padStart(2,'0')}</td><td>${esc(r.monsterZh)}<br>${esc(r.partZh)}<small>${esc(r.part)}</small></td><td>${esc(r.state)}<br>${esc(r.field)} · 原表索引${r.index}</td><td>${esc(r.values.slice(0,3).join(' / '))}</td><td>${esc(r.values.slice(3,8).join(' / '))}</td><td>${esc(r.values[8])}</td><td>${r.matchingExisting.length?r.matchingExisting.map(esc).join('<br>'):'无完全同值匹配'}</td><td>${r.reference.map(x=>esc(x.label)+'<br>'+esc(vector(x.values))).join('<hr>')}</td></tr>`).join('')}</tbody></table></div></section>`;
const body=table('A. 需确认触发含义的 State／AT 标签',states,'A')+table('B. 未辨识部位／隐藏条目（训练靶两条仍按此前要求排除）',unknown,'B')+table('C. 来源冲突，等待选择数值或说明条件',conflicts,'C')+table('D. 已直接补入现有分类的明确缺项',added,'D')+mapping.map((r,i)=>table('E'+String(i+1).padStart(2,'0')+'. 部位键对应待确认：'+esc(r.monsterZh)+'／'+esc(r.partZh),r.rows,'E'+String(i+1).padStart(2,'0')+'-')).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MHWA肉质待确认清单 · 2026-11-21</title><style>body{font:15px/1.6 system-ui,sans-serif;margin:24px;color:#24201a;background:#faf8f3}h1{font-size:24px}h2{font-size:19px;margin-top:30px}small{display:block;color:#777}input{position:sticky;top:8px;padding:10px;width:min(520px,90%);border:1px solid #bbb;background:white;z-index:2}.scroll{overflow:auto}table{border-collapse:collapse;min-width:1200px;width:100%;background:white}th,td{padding:8px;border:1px solid #ddd;text-align:left;vertical-align:top}th{background:#eee5ce}td:nth-child(4),td:nth-child(5){white-space:nowrap}hr{border:0;border-top:1px solid #ddd}a{color:#705512}</style><h1>MHWA 肉质待确认清单</h1><p>2026-11-21。此表是审核清单，不是应用中的新目录。请按编号反馈，例如“A03对应……，C02采用……”。</p><p><b>数值顺序：</b>物理＝斩／打／弹；属性＝火／水／雷／冰／龙；最后一项为昏厥肉质。原表索引从0开始，仅用于追溯。Meat＝该状态肉质；ScarMeat＝伤口肉质。各表可能重复列出同一原始记录的不同问题，不能将条数直接相加。</p><p>“已有同值条目”只是数值匹配提示，不能据此认定 State 的实际含义。表B及E还需要确认实际部位或对应关系。未确认数据暂不进入正式选择列表。</p><input type="search" placeholder="筛选怪物、部位、State或编号" aria-label="筛选清单">${body}<script>document.querySelector('input').addEventListener('input',e=>{const s=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(s));});</script></html>`;
fs.writeFileSync(new URL('raw/hzv-pending-decisions-20261121.html',root),html);
console.log(JSON.stringify(report.counts));

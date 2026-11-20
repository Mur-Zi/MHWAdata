import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const w={};for(const f of ['data.js','kuro-hzv.js'])new Function('window',read('app/'+f))(w);
const source=JSON.parse(read('raw/robomeche-hzv-20261120.json')),audit=JSON.parse(read('raw/hzv-source-differences-20261120.json'));
const decisions=JSON.parse(read('raw/hzv-review-decisions-20261121.json'));
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
 if(a.monster==='Nerscylla'&&a.state==='Break*'&&['Head','Torso','Belly'].includes(a.part))continue;
 if(/^(State(?: \d+)?|AT Guardian|AT Wnd)$/.test(a.state||'')||a.part==='HIDE'||a.part.startsWith('Unmatched')||applied(a.monster,a.index,a.field))continue;
 const r=source.monsters.find(d=>d.name===a.monster).rows[a.index];conflicts.push({...make(a.monster,r,a.index,a.field),category:a.category});
}
const mapping=[...audit.rawPartKeysNotSeparatelyListed,['Nerscylla','Foreleg'],['Nerscylla','Hind Leg']].map(([monster,part])=>({monster,monsterZh:w.MHWILD_TR.monster[monster]||monster,part,partZh:w.MHWILD_TR.part[part]||part,rows:source.monsters.find(d=>d.name===monster).rows.flatMap((r,i)=>r.Part===part&&r.Meat?[make(monster,r,i)]:[])}));
states.forEach((r,i)=>{
 r.id='A'+String(i+1).padStart(2,'0');
 if(r.part==='HIDE'||r.part.startsWith('Unmatched')){r.status='excluded';r.decision=decisions.unknown;}
 else if(decisions.states[r.id]){r.status='resolved';r.decision=decisions.states[r.id];}
 else if(r.id==='A81'){r.status='superseded';r.decision='已按用户要求采用A82作为普通锁翼刃；旧普通值不再另行确认。';}
 else if(r.monster==='Nerscylla'){r.status='resolved';r.decision='原始目录混放两种怪物：'+(r.state==='State 2'?'克隆影蜘蛛·破坏后':'克隆影蜘蛛·普通')+'，已按整组关系归类，无需再次确认。';}
 else if(r.matchingExisting.length){r.status='covered';r.decision='现有数据库已覆盖，对应：'+r.matchingExisting.join('；')+'。无需再次确认，不新增重复状态。';}
 else {r.status='pending';r.decision='尚无对应的已命名条件，需说明实际触发状态。';}
});
const pending=states.filter(r=>r.status==='pending'),resolved=states.filter(r=>r.status!=='pending');
unknown.forEach(r=>r.decision=decisions.unknown);conflicts.forEach(r=>r.decision=decisions.conflicts);mapping.forEach((r,i)=>r.decision=decisions.mapping[i]);
const report={decisions,checkedAt:'2026-11-21',source:source.source,notes:['已有对应条件和已确认条目不再要求用户确认；原A编号保持不变。','两种影蜘蛛按整组成对状态归类；B组暂不收录，C组不处理。','影蜘蛛与克隆影蜘蛛的正式数据库采用本页已应用的日文分类对比数据。'],counts:{pending:pending.length,resolved:resolved.length,states:states.length,unknown:unknown.length,conflicts:conflicts.length,mapping:mapping.length,added:added.length},pending,resolved,states,unknown,conflicts,mapping,added};
fs.writeFileSync(new URL('raw/hzv-pending-decisions-20261121.json',root),JSON.stringify(report,null,2));
const esc=v=>String(v??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const vector=v=>v.slice(0,3).join(' / ')+'；'+v.slice(3,8).join(' / ')+'；'+v[8];
const table=(title,rows,prefix)=>`<section><h2>${title}（${rows.length}条）</h2><div class="scroll"><table><thead><tr><th>编号</th><th>怪物／部位</th><th>原标签／字段／行号</th><th>斩／打／弹</th><th>火／水／雷／冰／龙</th><th>昏厥</th><th>现有数据库对应条目</th><th>现有参考值</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.id||prefix+String(i+1).padStart(2,'0'))}<small>${esc(r.decision||'')}</small></td><td>${esc(r.monsterZh)}<br>${esc(r.partZh)}<small>${esc(r.part)}</small></td><td>${esc(r.state)}<br>${esc(r.field)} · 原表索引${r.index}</td><td>${esc(r.values.slice(0,3).join(' / '))}</td><td>${esc(r.values.slice(3,8).join(' / '))}</td><td>${esc(r.values[8])}</td><td>${r.matchingExisting.length?r.matchingExisting.map(esc).join('<br>'):'无完全同值匹配'}</td><td>${r.reference.map(x=>esc(x.label)+'<br>'+esc(vector(x.values))).join('<hr>')}</td></tr>`).join('')}</tbody></table></div></section>`;
const body=(pending.length?table('仅这些数据需要确认（保留原A编号）',pending,'A'):'<section><h2>当前没有需要再次确认的条目</h2><p>此前七条State 2属于原始数据库混放的克隆影蜘蛛破坏状态，已归入克隆影蜘蛛。</p></section>')+'<details><summary>已处理及已有对应的条目（无需再次确认）</summary>'+table('已有对应／已确认／已排除',resolved,'A')+table('B. 未辨识部位／隐藏条目：按用户要求暂不收录',unknown,'B')+table('C. 来源冲突：按用户要求不处理，保留现有数据',conflicts,'C')+table('D. 已直接补入现有分类的明确缺项',added,'D')+mapping.map((r,i)=>table('E'+String(i+1).padStart(2,'0')+'. 部位名称对应：'+esc(r.monsterZh)+'／'+esc(r.partZh)+'；'+esc(r.decision),r.rows,'E'+String(i+1).padStart(2,'0')+'-')).join('')+'</details>';
const spiderParts=['Head','Claw','Torso','Leg Root','Mantle','Leg Tip','Stinger','Belly'];
const spiderRows=spiderParts.map(part=>{const a=w.MHWILD_KURO_HZV.Nerscylla[part],b=w.MHWILD_KURO_HZV['Nerscylla Clone'][part],rows=p=>Object.entries(p.groups).flatMap(([g,rs])=>rs.map(x=>(g==='普通'?'':g+'·')+x.s+'：'+vector(el.map(e=>x.m[e]))));return '<tr><td>'+esc(w.MHWILD_TR.part[part])+'</td><td>'+rows(a).map(esc).join('<br>')+'</td><td>'+rows(b).map(esc).join('<br>')+'</td></tr>';}).join('');
const spider='<section><h2>影蜘蛛与克隆影蜘蛛：已应用到正式数据库</h2><p>'+esc(decisions.spiderPolicy)+'</p><p><a href="https://kuroyonhon.com/mhwilds/monster/22.php">影蜘蛛原页</a> · <a href="https://kuroyonhon.com/mhwilds/monster/57.php">克隆影蜘蛛原页</a></p><table><thead><tr><th>部位</th><th>影蜘蛛：斩/打/弹；火/水/雷/冰/龙；昏厥</th><th>克隆影蜘蛛：同顺序</th></tr></thead><tbody>'+spiderRows+'</tbody></table><p>普通伤口：头部75/75/75；25/0/15/15/0；昏厥100。其余七个部位55/55/45；25/0/25/15/0；昏厥0。两种影蜘蛛相同。临时弱点均为头部80/80/90；15/0/15/0/0；昏厥0，铗角攻击后出现。克隆毒刺一阶段破坏后肉质不变；两者毒刺两阶段破坏后消失，腹部整个暴露。</p></section>';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MHWA肉质待确认清单 · 2026-11-21</title><style>body{font:15px/1.6 system-ui,sans-serif;margin:24px;color:#24201a;background:#faf8f3}h1{font-size:24px}h2{font-size:19px;margin-top:30px}small{display:block;color:#777}input{position:sticky;top:8px;padding:10px;width:min(520px,90%);border:1px solid #bbb;background:white;z-index:2}.scroll{overflow:auto}table{border-collapse:collapse;min-width:1200px;width:100%;background:white}th,td{padding:8px;border:1px solid #ddd;text-align:left;vertical-align:top}th{background:#eee5ce}td:nth-child(4),td:nth-child(5){white-space:nowrap}hr{border:0;border-top:1px solid #ddd}a{color:#705512}details{margin-top:24px}summary{cursor:pointer;font-weight:600;padding:12px;background:#eee5ce}small{max-width:300px}</style><h1>MHWA 肉质待确认清单</h1><p>2026-11-21。此表只列出仍无对应的数据供确认，原A编号保持不变。已有对应、已确认和按要求不处理的条目移入下方折叠记录，不再要求确认。</p><p><b>数值顺序：</b>物理＝斩／打／弹；属性＝火／水／雷／冰／龙；最后一项为昏厥肉质。原表索引从0开始，仅用于追溯。Meat＝该状态肉质；ScarMeat＝伤口肉质。各表可能重复列出同一原始记录的不同问题，不能将条数直接相加。</p><p>已有对应的数据沿用现有具名条件，不重复新增状态。影蜘蛛与克隆影蜘蛛按下方已应用的对比表收录；原始表中的State 1／State 2按克隆影蜘蛛的成对状态归类。</p><input type="search" placeholder="筛选怪物、部位、State或编号" aria-label="筛选清单">${body}${spider}<script>document.querySelector('input').addEventListener('input',e=>{const s=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(s));});</script></html>`;
fs.writeFileSync(new URL('raw/hzv-pending-decisions-20261121.html',root),html);
console.log(JSON.stringify(report.counts));

/* MHWilds 离线数据库查看器 */
(function () {
  'use strict';

  const RAW = window.MHWILD_RAW;
  const TR = window.MHWILD_TR;
  const META = window.MHWILD_META;
  const TRAINING_TARGET = 'High Purrformance Barrel Puncher';

  // 用户确认的训练靶肉质也应用于在线缓存，避免旧数据覆盖内置修正。
  {
    const name = TRAINING_TARGET;
    const id = RAW['Monster Names'][name];
    const target = RAW['Monster Data'][String(id)];
    if (target && target.Hitzones && Array.isArray(target.Hitzones.Rows)) {
      const rows = target.Hitzones.Rows;
      target.Hitzones.Rows = ['Front Panel', 'Side Panel', 'Barrels', 'Arm/Bag', 'Back Panel'].flatMap(part => {
        const row = rows.find(r => r.Part === part && !r.State) || rows.find(r => r.Part === part);
        if (!row) return [];
        const corrected = { ...row, State: '', Meat: { ...row.Meat } };
        const back = part === 'Back Panel';
        ['Slash', 'Blow', 'Shot'].forEach(key => { corrected.Meat[key] = back ? 20 : 80; });
        ['Fire', 'Water', 'Thunder', 'Ice', 'Dragon'].forEach(key => { corrected.Meat[key] = back ? 5 : 30; });
        if (part !== 'Front Panel' && part !== 'Side Panel') {
          delete corrected.ScarMeat; delete corrected.Wound;
        }
        return [corrected];
      });
    }
  }

  // ---- 索引构建 ----
  const name2id = RAW['Monster Names'];
  const id2name = {};
  for (const [n, id] of Object.entries(name2id)) id2name[String(id)] = n;

  const monsters = META.monsterOrder.map((name) => {
    const id = name2id[name];
    return { name, zh: TR.monster[name] || name, id: String(id), data: RAW['Monster Data'][String(id)] };
  });

  const quests = Object.entries(RAW['Quest Data']).map(([qid, q]) => {
    const targets = [];
    for (const [mid, arr] of Object.entries(q.Targets || {})) {
      const mname = id2name[mid] || ('未知(' + mid + ')');
      for (const t of arr) targets.push({ monsterId: mid, monsterName: mname, diff: t.diff, diffAdjust: t.diffAdjust, legendaryID: t.legendaryID, roleID: t.roleID });
    }
    const difficulty = targets.reduce((mx, t) => Math.max(mx, t.legendaryID || 0), 0);
    // 调查任务名形如 "4★-3 XXX Investigation"：Level=星级(任务难度)，"-3"=个体强度
    const sm = (q.Name || '').match(/^(\d+)★-(\d+)\s/);
    const strength = sm ? parseInt(sm[2], 10) : null;
    return { id: qid, name: q.Name, level: q.Level, stage: q.Stage, env: q.Env, maxPlayer: q.MaxPlayer, type: q.Type, clearCond: q.ClearCond, targets, difficulty, strength };
  });

  const diffRates = RAW.Difficulty._DifficultyRateArray._DataArray;
  const multiTables = RAW.Difficulty._MultiRateTblArray._DataArray;
  const randomRateTbl = (RAW.Difficulty._RandomRateTblArray || [])[0] || {}; // 个体强度倍率表

  // 网站任务栏 Scar Raw = Difficulty._ScarRaw；Wound.RawScar 是部位伤口血量，不能用于此处。
  function questScarRawOf(monsterName, questId = '', targetIndex = 0, players = 1) {
    const fail = (reason) => ({ raw: 0, questRaw: 0, playerRate: 1, legendary: false, valid: false, reason, maxPlayers: 1 });
    if (monsterName === TRAINING_TARGET) return { raw: 1, questRaw: 1, playerRate: 1, legendary: false, valid: true, maxPlayers: 1 };
    if (!questId) {
      const raw = Number(RAW.Difficulty.DefaultRate && RAW.Difficulty.DefaultRate._ScarRaw);
      return Number.isFinite(raw) && raw > 0
        ? { raw, questRaw: raw, playerRate: 1, legendary: false, valid: true, maxPlayers: 1 }
        : fail('缺少基础 Scar Raw 数据');
    }
    const q = quests.find(q => q.id === String(questId));
    const mid = String(name2id[monsterName]);
    const targets = q ? q.targets.filter(t => String(t.monsterId) === mid) : [];
    const target = targets[Number(targetIndex)];
    if (!target) return fail('任务中没有对应怪物');
    const rate = diffRates[target.diff];
    const questRaw = Number(rate && rate._ScarRaw);
    if (!Number.isFinite(questRaw) || questRaw <= 0) return fail('该任务缺少 Scar Raw 数据');
    const maxPlayers = Math.min(4, Math.max(1, Number(q.maxPlayer) || 4));
    const count = Math.min(maxPlayers, Math.max(1, Math.round(Number(players) || 1)));
    let playerRate = 1;
    if (count > 1) {
      const table = multiTables[rate._MultiTableId];
      const multi = table && (table._MultiRateTbl || []).find(r => r._Count === count);
      playerRate = Number(multi && multi._ScarRaw);
      if (!Number.isFinite(playerRate) || playerRate <= 0) return fail('该任务缺少对应人数的 Scar Raw 倍率');
    }
    return { raw: questRaw * playerRate, questRaw, playerRate, legendary: Number(target.legendaryID) > 0, valid: true, maxPlayers };
  }

  // ---- 翻译辅助 ----
  function zh(map, key, fallback) {
    if (key === undefined || key === null || key === '') return fallback || '';
    return (map && map[key] !== undefined) ? map[key] : (fallback !== undefined ? fallback : String(key));
  }
  // 可更新配置（炸膛 + 部位名覆盖）：内置兜底由 config.js 提供，联网时 loader.js 用在线 data.json 覆盖 window.MHWILD_CONFIG
  const CONFIG = window.MHWILD_CONFIG || {};
  const PART_OVERRIDE = CONFIG.PART_OVERRIDE || {};
  const partName = (monName, key) => (PART_OVERRIDE[monName] && PART_OVERRIDE[monName][key]) || zh(TR.part, key, key);
  const ELEMENTS = ['Slash', 'Blow', 'Shot', 'Fire', 'Water', 'Thunder', 'Ice', 'Dragon', 'Stun'];
  // 历战王个体（仅 3 只，有独立历战王肉质变化）
  const AT_MONSTERS = ['Arkveld', 'Uth Duna', 'Jin Dahaad'];
  // 炸膛数据：见 config.js 的 BLOWOUT（内置兜底），在线更新可覆盖
  const BLOWOUT = CONFIG.BLOWOUT || {};
  const STATUS_COLS = ['Poison', 'Sleep', 'Paralyze', 'Blast', 'Stun', 'Exhaust', 'Mount', 'Parry', 'Flayer', 'ConEle'];
  const TOOL_COLS = ['Flash', 'Sonic', 'TrapFall', 'TrapIvy', 'TrapParalyze', 'TrapParalyzeOtomo'];

  // 肉质表表头图标（原版游戏图标，从原站提取的 SVG 文件）
  function elementIcon(e) {
    return `<img src="img/el/${e}.svg" class="ic" alt="${zh(TR.element, e)}">`;
  }

  // 状态图标（毒/睡眠/麻痹/爆破/晕厥/疲劳有图标，其余用文字）
  const STATUS_ICONS = ['Poison', 'Sleep', 'Paralyze', 'Blast', 'Stun', 'Exhaust'];
  function statusHead(s) {
    const label = zh(TR.status, s);
    if (STATUS_ICONS.includes(s)) return `<th title="${label}"><img src="img/st/${s}.svg" class="ic" alt="${label}"></th>`;
    return `<th>${label}</th>`;
  }

  // 某列是否「有数据」：只要该列任意一行的数值非 0 就算有
  function colHasData(rows, key) {
    return rows.some((r) => {
      const v = r[key];
      if (typeof v === 'number') return v !== 0;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.values(v).some((x) => typeof x === 'number' && x !== 0);
      }
      return false;
    });
  }
  // 过滤掉「无数据」的列
  function activeCols(rows, cols) {
    return cols.filter((c) => colHasData(rows, c));
  }

  // 任务名（中文优先，回退英文）
  function questName(q) {
    const tr = (TR.quest && TR.quest[q.id]);
    const name = tr || q.name;
    // 调查任务译名里的 "N★ " 前缀与星级列重复，去掉（星级+个体强度统一在 questLevelLabel 显示）
    if (q.strength != null) return String(name).replace(/^\s*\d+★\s*/, '');
    return name;
  }
  // 星级 + 个体强度标签（如 "4★" / "4★-3"）
  function questLevelLabel(q) {
    return `${q.level}★${q.strength != null ? '-' + q.strength : ''}`;
  }

  // 异常状态 ↔ 难度倍率键
  const STATUS_DIFF_KEY = { Poison: '_Poison', Paralyze: '_Paralyze', Sleep: '_Sleep', Blast: '_Explosion', Stun: '_Stun', Exhaust: '_Exhaust', Mount: '_Ride', Flayer: '_SkillStabbing', ConEle: '_SkillRyuki' };
  const STATUS_MULTI_KEY = { Poison: '_BadConditionAddLimit', Sleep: '_BadConditionAddLimit', Blast: '_BadConditionAddLimit', Paralyze: '_ParalyzeAddLimit', Stun: '_StunAddLimit', Exhaust: '_ExhaustAddLimit', Mount: '_RideAddLimit', Flayer: '_SkillStabbingAddLimit', ConEle: '_SkillRyukiAddLimit' };

  // 历战层级 → Legendary 字段后缀（0=普通 1=历战 2=历战王）
  const LEGENDARY_TIER = { 0: '', 1: '_Hard', 2: '_King_Hard' };
  function legendaryRate(m, key, legendaryID) {
    const L = m && m.data && m.data.Legendary;
    if (!L) return 1;
    const tier = LEGENDARY_TIER[legendaryID] || '';
    const v = L[key + tier];
    return (typeof v === 'number') ? v : 1;
  }

  // ---- 视图导航 ----
  const views = ['monsters', 'quests', 'monster-detail', 'quest-detail', 'calculator'];
  const navMonsters = document.getElementById('nav-monsters');
  const navQuests = document.getElementById('nav-quests');
  const navCalculator = document.getElementById('nav-calculator');
  const navBack = document.getElementById('nav-back');
  const titleEl = document.getElementById('topbar-title');
  const filterTrigger = document.getElementById('filter-trigger');

  function showView(name) {
    views.forEach((v) => {
      document.getElementById('view-' + v).hidden = (v !== name);
    });
    navMonsters.classList.toggle('active', name === 'monsters');
    navQuests.classList.toggle('active', name === 'quests');
    navCalculator.classList.toggle('active', name === 'calculator');
    navBack.style.display = (name === 'monster-detail' || name === 'quest-detail') ? '' : 'none';
    // 底部搜索栏：怪物页显示怪物搜索，任务页显示任务搜索，详情页/计算器隐藏
    monsterSearchEl.hidden = (name !== 'monsters');
    questSearchEl.hidden = (name !== 'quests');
    // 「筛选」按钮只在任务页显示
    filterTrigger.style.display = (name === 'quests') ? '' : 'none';
    window.scrollTo(0, 0);
    // 返回怪物列表时按最新查看次数实时重排（无需重进 app）
    if (name === 'monsters') renderMonsterList(monsterSearchEl.value);
  }
  navMonsters.addEventListener('click', () => { titleEl.textContent = 'MHWA数据库'; showView('monsters'); });
  navQuests.addEventListener('click', () => { titleEl.textContent = '任务列表'; showView('quests'); });
  navCalculator.addEventListener('click', () => { titleEl.textContent = '伤害计算器'; showView('calculator'); renderCalculatorView(); });
  navBack.addEventListener('click', () => { titleEl.textContent = 'MHWA数据库'; showView('monsters'); });

  // ---- 数值格式化 ----
  function fmt(v) {
    if (v === undefined || v === null) return '—';
    if (Array.isArray(v)) return v.map((x) => fmt(x)).join(' / ');
    if (typeof v === 'number') return (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
    return String(v);
  }
  function hzvClass(v) {
    if (typeof v !== 'number') return '';
    if (v >= 80) return 'hzv-5';
    if (v >= 60) return 'hzv-4';
    if (v >= 40) return 'hzv-3';
    if (v >= 20) return 'hzv-2';
    if (v > 0) return 'hzv-1';
    return 'hzv-0';
  }

  // ---- 怪物列表 ----
  const monsterListEl = document.getElementById('monster-list');
  const monsterSearchEl = document.getElementById('monster-search');

  // 查看次数（localStorage，用于把常查的怪排前面）
  function getViewCounts() {
    try { return JSON.parse(localStorage.getItem('mhwilds_views') || '{}'); } catch (e) { return {}; }
  }
  function bumpViewCount(name) {
    const c = getViewCounts();
    c[name] = (c[name] || 0) + 1;
    try { localStorage.setItem('mhwilds_views', JSON.stringify(c)); } catch (e) {}
  }

  function renderMonsterList(filter) {
    const f = (filter || '').trim().toLowerCase();
    let list = monsters.filter((m) => !f || m.name.toLowerCase().includes(f) || (m.zh && m.zh.includes(filter.trim())));
    if (!f) {
      const counts = getViewCounts();
      list = list.slice().sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0));
    }
    if (!list.length) { monsterListEl.innerHTML = '<div class="empty">没有匹配的怪物</div>'; return; }
    monsterListEl.innerHTML = list.map((m) => {
      const img = META.imageMap[m.name];
      return `<div class="monster-card" data-name="${m.name}">
        <img src="${img.icon}" alt="${m.zh}" loading="lazy">
        <div class="zh">${m.zh}</div>
        <div class="en">${m.name}</div>
      </div>`;
    }).join('');
    monsterListEl.querySelectorAll('.monster-card').forEach((el) => {
      el.addEventListener('click', () => openMonster(el.dataset.name));
    });
  }
  monsterSearchEl.addEventListener('input', () => renderMonsterList(monsterSearchEl.value));
  renderMonsterList('');

  // ---- 任务列表 ----
  const questListEl = document.getElementById('quest-list');
  const questSearchEl = document.getElementById('quest-search');
  const levelFilterEl = document.getElementById('level-filter');
  const difficultyFilterEl = document.getElementById('difficulty-filter');
  const monsterFilterEl = document.getElementById('monster-filter');
  const monsterDrawer = document.getElementById('monster-drawer');
  const monsterDrawerBackdrop = document.getElementById('monster-drawer-backdrop');
  const monsterDrawerClose = document.getElementById('monster-drawer-close');
  let levelFilter = '';
  let difficultyFilter = '';
  let monsterFilter = '';
  const DIFF_LABEL = { 0: '普通', 1: '历战', 2: '历战王' };

  // 星级筛选 chips
  levelFilterEl.innerHTML = '<button class="chip active" data-lv="">全部</button>' +
    Array.from({ length: 10 }, (_, i) => `<button class="chip" data-lv="${i + 1}">${i + 1}★</button>`).join('');
  // 难度筛选 chips
  difficultyFilterEl.innerHTML = '<button class="chip active" data-diff="">全部难度</button>' +
    Object.entries(DIFF_LABEL).map(([k, v]) => `<button class="chip" data-diff="${k}">${v}</button>`).join('');
  // 怪物筛选 chips（放在右侧抽屉里，每行两个 + 怪物图标）
  monsterFilterEl.innerHTML = '<button class="chip mchip all active" data-mon="">全部怪物</button>' +
    monsters.map((m) => `<button class="chip mchip" data-mon="${m.id}"><img src="${META.imageMap[m.name].icon}" alt=""><span>${m.zh}</span></button>`).join('');

  // 筛选抽屉（右侧抽拉，含星级/难度/怪物）
  function openMonsterDrawer() {
    monsterDrawer.hidden = false;
    monsterDrawerBackdrop.hidden = false;
    requestAnimationFrame(() => {
      monsterDrawer.classList.add('open');
      monsterDrawerBackdrop.classList.add('open');
    });
  }
  function closeMonsterDrawer() {
    monsterDrawer.classList.remove('open');
    monsterDrawerBackdrop.classList.remove('open');
    setTimeout(() => { monsterDrawer.hidden = true; monsterDrawerBackdrop.hidden = true; }, 260);
  }
  filterTrigger.addEventListener('click', openMonsterDrawer);
  monsterDrawerClose.addEventListener('click', closeMonsterDrawer);
  monsterDrawerBackdrop.addEventListener('click', closeMonsterDrawer);

  levelFilterEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lv]'); if (!b) return;
    levelFilter = b.dataset.lv;
    levelFilterEl.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    renderQuestList();
  });
  difficultyFilterEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-diff]'); if (!b) return;
    difficultyFilter = b.dataset.diff;
    difficultyFilterEl.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    renderQuestList();
  });
  monsterFilterEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mon]'); if (!b) return;
    monsterFilter = b.dataset.mon;
    monsterFilterEl.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    renderQuestList();
    closeMonsterDrawer();
  });

  function renderQuestList() {
    const f = questSearchEl.value.trim().toLowerCase();
    let list = quests.filter((q) => {
      if (f && !questName(q).toLowerCase().includes(f) && !q.name.toLowerCase().includes(f)) return false;
      if (levelFilter && String(q.level) !== levelFilter) return false;
      if (difficultyFilter && String(q.difficulty) !== difficultyFilter) return false;
      if (monsterFilter && !q.targets.some((t) => t.monsterId === monsterFilter)) return false;
      return true;
    });
    list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    if (!list.length) { questListEl.innerHTML = '<div class="empty">没有匹配的任务</div>'; return; }
    questListEl.innerHTML = list.map((q) => {
      const monstersIn = [...new Set(q.targets.map((t) => t.monsterName))].map((n) => zh(TR.monster, n, n)).join('、');
      const diffTag = q.difficulty > 0 ? `<span class="diff-tag">${DIFF_LABEL[q.difficulty]}</span>` : '';
      return `<div class="quest-row" data-id="${q.id}">
        <div class="star">${questLevelLabel(q)}</div>
        <div class="mid"><div class="name">${questName(q)}</div><div class="sub">${monstersIn || '—'}</div></div>
        <div class="type">${zh(TR.questType, q.type, '任务')}${diffTag}</div>
      </div>`;
    }).join('');
    questListEl.querySelectorAll('.quest-row').forEach((el) => {
      el.addEventListener('click', () => openQuest(el.dataset.id));
    });
  }
  questSearchEl.addEventListener('input', renderQuestList);
  renderQuestList();

  // ---- 打开详情 ----
  function openMonster(name) {
    const m = monsters.find((x) => x.name === name);
    bumpViewCount(name);
    titleEl.textContent = m.zh;
    showView('monster-detail');
    renderMonsterDetail(m);
  }
  function openQuest(qid) {
    const q = quests.find((x) => x.id === qid);
    titleEl.textContent = questName(q);
    showView('quest-detail');
    renderQuestDetail(q);
  }

  // ---- 怪物详情 ----
  function renderMonsterDetail(m) {
    const el = document.getElementById('view-monster-detail');
    const img = META.imageMap[m.name];
    const d = m.data;
    const chips = [];
    chips.push('血量 ' + fmt(d.BHP));
    chips.push(d.CantCap ? '不可捕获' : '可捕获');
    if (d.Zako) chips.push('小型怪物');
    const hzRows = d.Hitzones ? (d.Hitzones.Rows || []) : [];
    const condRows = d.ConditionTable ? (d.ConditionTable.Rows || []) : [];
    const toolRows = d.ToolTable ? (d.ToolTable.Rows || []) : [];

    let html = '';
    html += `<div class="detail-hero">
      <img src="${img.icon}" alt="${m.zh}">
      <div><div class="zh">${m.zh}</div><div class="en">${m.name}</div>
      <div class="meta-chips">${chips.map((c) => '<span class="chip">' + c + '</span>').join('')}</div></div>
    </div>`;

    // 肉质表 HZV：以 kuroyonhon 为主；普通/历战王 tab 分「状态」列（普通/伤痕/附油/带电等）
    const kuro = (window.MHWILD_KURO_HZV && window.MHWILD_KURO_HZV[m.name]) || null;
    if (kuro) {
      const kuroParts = Object.entries(kuro);
      const allMeats = kuroParts.flatMap(([, p]) => {
        const arr = [];
        for (const g of Object.values(p.groups)) arr.push(...g.map((x) => x.m));
        if (p.at) arr.push(...p.at.map((x) => x.m));
        if (p.wound) arr.push(p.wound);
        return arr;
      });
      const activeElements = ELEMENTS.filter((e) => allMeats.some((meat) => typeof meat[e] === 'number' && meat[e] !== 0));
      const isAT = AT_MONSTERS.includes(m.name);
      // 组 tab 顺序：普通 → 历战王 → 状态组 → 伤口
      const stateGroups = [];
      kuroParts.forEach(([, p]) => Object.keys(p.groups).forEach((g) => { if (g !== '普通' && !stateGroups.includes(g)) stateGroups.push(g); }));
      const groups = ['普通', ...(isAT ? ['历战王'] : []), ...stateGroups, '伤口'];
      const tabLabel = (g) => (g === '普通' ? '普通肉质' : g === '历战王' ? '历战王肉质' : g === '伤口' ? '伤口肉质' : g + '状态');
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const meatCell = (meat) => activeElements.map((e) => {
        const v = meat ? meat[e] : undefined;
        return `<td class="num ${hzvClass(v)}">${fmt(v)}</td>`;
      }).join('');
      const makeRow = (pn, s, meat, g, note) => {
        const hidden = g === '普通' ? '' : ' hidden';
        let out = `<tr data-hzv-row="${g}"${hidden}><td class="part-name fz1">${pn}${note ? '<span class="note-toggle" title="点击查看说明">ℹ</span>' : ''}</td><td class="state-tag fz2 state-col">${s}</td>${meatCell(meat)}</tr>`;
        if (note) out += `<tr class="note-row" data-hzv-row="${g}" hidden><td colspan="${activeElements.length + 2}" class="note-text">${esc(note)}</td></tr>`;
        return out;
      };
      html += `<section class="section"><h2>肉质（HZV）</h2>
        <div class="toggle-group">${groups.map((g, i) => `<button class="toggle-btn${i === 0 ? ' active' : ''}" data-hzv="${g}">${tabLabel(g)}</button>`).join('')}</div>
        <div class="tbl-wrap"><table><thead><tr><th class="fz1">部位</th><th class="fz2 state-col">状态</th>${activeElements.map((e) => `<th title="${zh(TR.element, e)}">${elementIcon(e)}</th>`).join('')}</tr></thead>
        <tbody>${kuroParts.map(([en, p]) => {
          const pn = partName(m.name, en);
          let rows = '';
          for (const g of Object.keys(p.groups)) rows += p.groups[g].map((x) => makeRow(pn, x.s, x.m, g, x.note)).join('');
          if (p.at) rows += p.at.map((x) => makeRow(pn, x.s, x.m, '历战王', x.note)).join('');
          if (p.wound) rows += makeRow(pn, '', p.wound, '伤口', '');
          return rows;
        }).join('')}</tbody></table></div></section>`;
    } else {
      // 回退：kuro 无数据（如训练木桶），用 database 的 Meat/ScarMeat
      const activeElements = ELEMENTS.filter((e) => hzRows.some((r) => {
        const mm = r.Meat ? r.Meat[e] : undefined;
        const s = r.ScarMeat ? r.ScarMeat[e] : undefined;
        return (typeof mm === 'number' && mm !== 0) || (typeof s === 'number' && s !== 0);
      }));
      const baseRows = [];
      { const seen = new Set(); for (const r of hzRows) {
        if ((r.State === undefined || r.State === null || r.State === '') && r.Meat) {
          if (!seen.has(r.Part)) { seen.add(r.Part); baseRows.push(r); }
        }
      }}
      html += `<section class="section"><h2>肉质（HZV）</h2>
        <div class="toggle-group">
          <button class="toggle-btn active" data-hzv="normal">普通肉质</button>
          <button class="toggle-btn" data-hzv="scar">伤口肉质</button>
        </div>
        <div class="tbl-wrap"><table><thead><tr><th class="fz1">部位</th>${activeElements.map((e) => `<th title="${zh(TR.element, e)}">${elementIcon(e)}</th>`).join('')}</tr></thead>
        <tbody>${baseRows.map((r) => {
          const part = partName(m.name, r.Part);
          const mCell = (src) => activeElements.map((e) => `<td class="num ${hzvClass(src ? src[e] : undefined)}">${fmt(src ? src[e] : undefined)}</td>`).join('');
          return `<tr data-hzv-row="normal"><td class="part-name fz1">${part}</td>${mCell(r.Meat)}</tr>
                  ${r.ScarMeat ? `<tr data-hzv-row="scar" hidden><td class="part-name fz1">${part}</td>${mCell(r.ScarMeat)}</tr>` : ''}`;
        }).join('')}</tbody></table></div></section>`;
    }

    // 任务难度换算（选择器前置，星级从高到低）
    html += `<section class="section"><h2>任务难度换算</h2>
      <div class="hint">选择任务与狩猎人数，下方四组数据自动按难度倍率换算；不选则显示基础数据。</div>
      <div class="scale-quest-picker" id="scale-quest-picker"></div>
      <div class="player-btns" id="scale-players">
        <button class="toggle-btn" data-p="1">1人</button>
        <button class="toggle-btn" data-p="2">2人</button>
        <button class="toggle-btn" data-p="3">3人</button>
        <button class="toggle-btn active" data-p="4">4人</button>
      </div>
    </section>`;
    // 四组数据（基础 / 换算，动态渲染）
    html += `<div id="data-groups"></div>`;

    el.innerHTML = html;

    // HZV 切换
    el.querySelectorAll('[data-hzv]').forEach((b) => {
      b.addEventListener('click', () => {
        el.querySelectorAll('[data-hzv]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const mode = b.dataset.hzv;
        el.querySelectorAll('[data-hzv-row]').forEach((tr) => {
          if (tr.classList.contains('note-row')) {
            // 补充说明行：切 tab 时只隐藏非当前 tab 的说明，不强制展开
            if (tr.dataset.hzvRow !== mode) tr.hidden = true;
          } else {
            tr.hidden = (tr.dataset.hzvRow !== mode);
          }
        });
        // 伤口肉质无「状态」维度，隐藏状态列
        const showState = mode !== '伤口';
        el.querySelectorAll('.state-col').forEach((c) => { c.hidden = !showState; });
      });
    });
    // 补充说明（note）点击展开
    el.querySelectorAll('.note-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const noteTr = btn.closest('tr').nextElementSibling;
        if (noteTr && noteTr.classList.contains('note-row')) noteTr.hidden = !noteTr.hidden;
      });
    });

    // 倍率换算（渲染四组数据 + 任务选择器）
    setupScaling(el, m);
  }

  // ---- 四组数据渲染（部位/异常/道具/疲劳怒，支持难度倍率换算） ----
  function renderDataGroups(m, f) {
    const d = m.data;
    const hzRows = d.Hitzones ? (d.Hitzones.Rows || []) : [];
    const condRows = d.ConditionTable ? (d.ConditionTable.Rows || []) : [];
    const toolRows = d.ToolTable ? (d.ToolTable.Rows || []) : [];
    const fParts = f ? f.fParts : 1;
    const fScarRaw = f ? f.fScarRaw : 1;
    const fScarNT = f ? f.fScarNT : 1;
    const fScarTear = f ? f.fScarTear : 1;
    const fTear = f ? f.fTear : 1;
    const fHealth = f ? f.fHealth : 1;
    const fHealthMin = f ? f.fHealthMin : 1;
    const fHealthMax = f ? f.fHealthMax : 1;
    const fStrength = f ? f.strength : 0;
    const sFac = (s) => (f && f.status && f.status[s]) || null;
    const scaleArr = (v, fac) => {
      if (Array.isArray(v)) return v.map((x) => Math.round(x * fac));
      if (typeof v === 'number') return Math.round(v * fac);
      return v;
    };
    // 疲劳/发怒数值取最大值显示
    const maxVal = (lo, hi) => {
      const a = (lo === undefined || lo === null) ? hi : lo;
      const b = (hi === undefined || hi === null) ? lo : hi;
      if (a === undefined || a === null) return '—';
      return fmt(Math.max(a, b));
    };
    let html = '';

    // 血量浮动（基础血量 × 所选任务难度倍率 × 人数倍率 × 历战倍率 × 个体强度）
    if (typeof d.BHP === 'number') {
      const hpBase = Math.round(d.BHP * fHealth);
      const hpLo = Math.round(hpBase * fHealthMin);
      const hpHi = Math.round(hpBase * fHealthMax);
      const hpRange = fStrength > 0 ? (hpLo + '~' + hpHi) : '固定';
      html += `<section class="section"><h2>血量浮动</h2>
        <div class="tbl-wrap"><table><thead><tr><th>基础血量</th><th>任务倍率</th><th>血量</th><th>浮动范围</th></tr></thead>
        <tbody><tr><td class="num">${fmt(d.BHP)}</td><td class="num">×${fmt(fHealth)}</td><td class="num">${hpBase}</td><td class="num">${hpRange}</td></tr></tbody></table></div></section>`;
    }

    // 部位硬直/破坏/伤口
    const hasVal = (v) => v !== undefined && v !== null;
    const partRows = hzRows.filter((r) => {
      if (r.Part === 'HIDE') return false;
      const w = r.Wound || {};
      return hasVal(r.Flinch) || hasVal(r.Break) || hasVal(w.Normal) || hasVal(w.RawScar) || hasVal(w.Tear) || hasVal(w.Number);
    });
    const partCols = [
      ['硬直', (r) => Array.isArray(r.Flinch) ? r.Flinch.some((x) => x) : r.Flinch],
      ['破坏', (r) => Array.isArray(r.Break) ? r.Break.some((x) => x) : r.Break],
      ['打出绽伤血量', (r) => { const w = r.Wound || {}; return Array.isArray(w.Normal) ? w.Normal.some((x) => x) : w.Normal; }],
      ['绽伤血量', (r) => { const w = r.Wound || {}; return Array.isArray(w.Tear) ? w.Tear.some((x) => x) : w.Tear; }],
      ['伤口血量', (r) => { const w = r.Wound || {}; return Array.isArray(w.RawScar) ? w.RawScar.some((x) => x) : w.RawScar; }],
      ['伤口数', (r) => { const w = r.Wound || {}; return w.Number; }],
    ].filter(([, fn]) => partRows.some(fn));
    const partVal = (r, label) => {
      const w = r.Wound || {};
      if (label === '硬直') return fmt(scaleArr(r.Flinch, fParts));
      if (label === '破坏') return fmt(scaleArr(r.Break, fParts));
      if (label === '打出绽伤血量') return fmt(scaleArr(w.Normal, fScarNT));
      if (label === '绽伤血量') return fmt(scaleArr(w.Tear, fTear));
      if (label === '伤口血量') return fmt(scaleArr(w.RawScar, fScarRaw));
      if (label === '伤口数') return fmt(w.Number);
      return '';
    };
    // 历战伤口（伤痕覆盖）：无「打出绽伤」阶段，只有绽伤→伤口；绽伤用历战专属倍率 TearVitalRateLegendaryScar（Scar Tear Legendary）
    // Legendary 有两种形状：对象（单部位）与数组（左右镜像部位，如翼/腿/腕），数组取首项合并展示
    const scarWound = (r) => {
      if (!r.Legendary) return null;
      if (Array.isArray(r.Legendary)) {
        const first = r.Legendary.find((x) => x && x.Wound) || r.Legendary[0];
        return first ? (first.Wound || null) : null;
      }
      return r.Legendary.Wound || null;
    };
    const seenScar = new Set();
    const scarRows = hzRows.filter((r) => {
      if (r.Part === 'HIDE') return false;
      if (!scarWound(r)) return false;
      if (seenScar.has(r.Part)) return false;
      seenScar.add(r.Part);
      return true;
    });
    const scarCols = [
      ['绽伤血量', (r) => { const w = scarWound(r); return Array.isArray(w.Tear) ? w.Tear.some((x) => x) : w.Tear; }],
      ['伤口血量', (r) => { const w = scarWound(r); return Array.isArray(w.RawScar) ? w.RawScar.some((x) => x) : w.RawScar; }],
      ['伤口数', (r) => { const w = scarWound(r); return w.Number; }],
    ].filter(([, fn]) => scarRows.some(fn));
    const scarVal = (r, label) => {
      const w = scarWound(r);
      if (label === '绽伤血量') return fmt(scaleArr(w.Tear, fScarTear));
      if (label === '伤口血量') return fmt(scaleArr(w.RawScar, fScarRaw));
      if (label === '伤口数') return fmt(w.Number);
      return '';
    };
    html += `<section class="section"><h2>部位硬直 / 破坏 / 伤口</h2>
      <div class="tbl-wrap"><table><thead><tr><th class="fz1">部位</th>${partCols.map(([l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${partRows.map((r) => {
        const part = partName(m.name, r.Part);
        return `<tr><td class="part-name fz1">${part}</td>${partCols.map(([l]) => `<td class="num">${partVal(r, l)}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
    if (scarRows.length) {
      html += `<div class="sub-title">历战伤口</div>
        <div class="tbl-wrap"><table><thead><tr><th class="fz1">部位</th>${scarCols.map(([l]) => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${scarRows.map((r) => {
          const part = partName(m.name, r.Part);
          return `<tr><td class="part-name fz1">${part}</td>${scarCols.map(([l]) => `<td class="num">${scarVal(r, l)}</td>`).join('')}</tr>`;
        }).join('')}</tbody></table></div>`;
    }
    html += `</section>`;

    // 炸膛（多部位爆破，血量随任务难度 ×fParts 缩放）
    const blowout = BLOWOUT[m.name];
    if (blowout && blowout.length) {
      const maxN = Math.max(...blowout.map((r) => r.vitals.length));
      html += `<section class="section"><h2>炸膛</h2>
        <div class="tbl-wrap"><table><thead><tr><th class="fz1">部位</th>${Array.from({ length: maxN }, (_, i) => `<th>炸膛${i + 1}</th>`).join('')}</tr></thead>
        <tbody>${blowout.map((r) => {
          const v = scaleArr(r.vitals, fParts);
          return `<tr><td class="part-name fz1">${r.label}</td>${Array.from({ length: maxN }, (_, i) => `<td class="num">${i < v.length ? fmt(v[i]) : '—'}</td>`).join('')}</tr>`;
        }).join('')}</tbody></table></div></section>`;
    }

    // 异常状态（耐性增量/上限按 add=_AddAndMaxLimit×人数 缩放；初始耐性/持续时间按 def=_DefaultLimit 缩放）
    const activeStatus = activeCols(condRows, STATUS_COLS);
    if (activeStatus.length) {
      html += `<section class="section"><h2>异常状态</h2>
        <div class="tbl-wrap"><table><thead><tr><th class="fz1">项目</th>${activeStatus.map((s) => statusHead(s)).join('')}</tr></thead>
        <tbody>${condRows.filter((r) => r.Stats !== 'Damage').map((r) => {
          const label = r.Stats === '' ? '有效度' : (r.Stats !== undefined ? zh(TR.conditionRow, r.Stats, r.Stats) : '');
          return `<tr><td class="row-label fz1">${label}</td>${activeStatus.map((s) => {
            let v = r[s];
            if (r.Stats === '') {
              const n = parseInt(v, 10) || 0;
              return '<td class="num">' + (n > 0 ? '★'.repeat(n) : '—') + '</td>';
            }
            const fac = sFac(s);
            if (fac) {
              if (r.Stats === 'Max Tolerance' || r.Stats === 'Tolerance Increase') v = scaleArr(v, fac.add);
              else if (r.Stats === 'Initial Tolerance') v = scaleArr(v, fac.def);
            }
            return '<td class="num">' + fmt(v) + '</td>';
          }).join('')}</tr>`;
        }).join('')}</tbody></table></div></section>`;
    }

    // 道具效果（不随难度缩放）
    const activeTools = toolRows.length ? activeCols(toolRows, TOOL_COLS) : [];
    if (activeTools.length) {
      html += `<section class="section"><h2>道具效果</h2>
        <div class="tbl-wrap"><table><thead><tr><th class="fz1">项目</th>${activeTools.map((s) => '<th>' + zh(TR.tool, s) + '</th>').join('')}</tr></thead>
        <tbody>${toolRows.map((r) => {
          const label = r.Label !== undefined ? zh(TR.toolRow, r.Label, r.Label) : '';
          return `<tr><td class="row-label fz1">${label}</td>${activeTools.map((s) => {
            const v = r[s];
            const val = (v && typeof v === 'object' && 'Normal' in v) ? v.Normal : v;
            return '<td class="num">' + fmt(val) + '</td>';
          }).join('')}</tr>`;
        }).join('')}</tbody></table></div></section>`;
    }

    // 疲劳 / 发怒（不随难度缩放）
    const angry = (d.AngryTable && d.AngryTable[0]) || {};
    const angryLower = angry.Lower || {};
    const angryUpper = angry.Upper || {};
    const hasAngry = Object.keys(angryLower).length > 0 || Object.keys(angryUpper).length > 0;
    const st = d.Stamina || {};
    const stLower = st.Lower || {};
    const stUpper = st.Upper || {};
    const hasStamina = ['Stamina', 'TiredTime', 'MotionRate'].some((k) => stLower[k] !== undefined || stUpper[k] !== undefined);
    if (hasStamina || hasAngry) {
      html += `<section class="section"><h2>疲劳 / 发怒</h2>`;
      if (hasStamina) {
        html += `<div class="tbl-wrap"><table><thead><tr><th>疲劳</th><th>疲劳时间</th><th>动作倍率</th></tr></thead>
          <tbody>
            <tr><td class="num">${maxVal(stLower.Stamina, stUpper.Stamina)}</td><td class="num">${maxVal(stLower.TiredTime, stUpper.TiredTime)}</td><td class="num">${maxVal(stLower.MotionRate, stUpper.MotionRate)}</td></tr>
          </tbody></table></div>`;
      }
      if (hasAngry) {
        html += `<div class="tbl-wrap"${hasStamina ? ' style="margin-top:10px"' : ''}><table><thead><tr><th>发怒阈值</th><th>攻击倍率</th><th>受击倍率</th><th>速度</th><th>持续时间</th></tr></thead>
          <tbody>
            <tr><td class="num">${maxVal(angryLower.Limit, angryUpper.Limit)}</td><td class="num">${maxVal(angryLower.MonDamage, angryUpper.MonDamage)}</td><td class="num">${maxVal(angryLower.PlDamage, angryUpper.PlDamage)}</td><td class="num">${maxVal(angryLower.Speed, angryUpper.Speed)}</td><td class="num">${maxVal(angryLower.Time, angryUpper.Time)}</td></tr>
          </tbody></table></div>`;
      }
      html += `</section>`;
    }

    return html;
  }

  // ---- 任务倍率换算 ----
  function setupScaling(el, m) {
    const questsWithMonster = quests.filter((q) => q.targets.some((t) => t.monsterId === m.id));
    const pickerEl = el.querySelector('#scale-quest-picker');
    const playerBtns = el.querySelector('#scale-players');
    const groupsEl = el.querySelector('#data-groups');
    let players = 4;
    let selectedId = null; // null = 基础数据

    groupsEl.innerHTML = renderDataGroups(m, null);

    if (!questsWithMonster.length) {
      pickerEl.innerHTML = '<div class="empty">该怪物没有可换算的任务</div>';
      return;
    }
    // 星级从高到低排序
    questsWithMonster.sort((a, b) => b.level - a.level || b.name.localeCompare(a.name));

    pickerEl.innerHTML = '<button class="quest-chip active" data-qid="">基础数据</button>' +
      questsWithMonster.map((q) => `
      <button class="quest-chip" data-qid="${q.id}">
        <span class="chip-star">${questLevelLabel(q)}</span><span class="chip-name">${questName(q)}</span>
      </button>`).join('');

    function getTarget(q) { return q.targets.find((x) => x.monsterId === m.id); }
    function getMulti(rate) {
      if (!rate || !rate._MultiTableId || !multiTables[rate._MultiTableId]) return null;
      const tbl = multiTables[rate._MultiTableId]._MultiRateTbl || [];
      if (players < 2) return null;
      return tbl.find((x) => x._Count === players) || tbl.find((x) => x._Count >= players) || null;
    }
    function computeFactors(q) {
      const t = getTarget(q);
      if (!t || !t.diff || !diffRates[t.diff]) return null;
      const rate = diffRates[t.diff];
      const multi = getMulti(rate);
      const lid = t.legendaryID || 0;
      const lParts = legendaryRate(m, 'PartsVitalRate', lid);
      const lNormal = legendaryRate(m, 'NormalVitalRate', lid);
      const lTear = legendaryRate(m, 'TearVitalRate', lid); // 普通绽伤 (Scar Tear)
      const lTearLeg = legendaryRate(m, 'TearVitalRateLegendaryScar', lid); // 伤痕覆盖绽伤 (Scar Tear Legendary)
      const lHealth = legendaryRate(m, 'HealthRate', lid); // 血量
      const status = {};
      for (const s of ['Poison', 'Paralyze', 'Sleep', 'Blast', 'Stun', 'Exhaust', 'Mount', 'Flayer', 'ConEle']) {
        const dk = STATUS_DIFF_KEY[s];
        const mk = STATUS_MULTI_KEY[s];
        if (dk && rate[dk]) status[s] = {
          add: rate[dk]._AddAndMaxLimit * (multi && mk ? (multi[mk] || 1) : 1),
          def: rate[dk]._DefaultLimit,
        };
      }
      // 个体强度（target.diffAdjust）：0 = 血量固定；N = 按 _RandomRateTblArray 浮动 ±ValueM{N}~ValueP{N}
      const strength = t.diffAdjust || 0;
      const fHealthMin = strength > 0 ? (randomRateTbl['_ValueM' + strength] || 1) : 1;
      const fHealthMax = strength > 0 ? (randomRateTbl['_ValueP' + strength] || 1) : 1;
      return {
        fParts: rate._PartsVital * lParts * (multi ? multi._PartsVital : 1),
        fScarRaw: rate._ScarRaw * (multi ? multi._ScarRaw : 1),
        fScarNT: rate._ScarNormalAndTear * lNormal * (multi ? multi._ScarNormalAndTear : 1),
        fScarTear: rate._ScarNormalAndTear * lTearLeg * (multi ? multi._ScarNormalAndTear : 1),
        fTear: rate._ScarNormalAndTear * lTear * (multi ? multi._ScarNormalAndTear : 1),
        fHealth: rate._Health * lHealth * (multi ? multi._Health : 1),
        fHealthMin,
        fHealthMax,
        strength,
        status,
      };
    }
    function renderPlayerBtns(maxP) {
      if (players > maxP) players = maxP;
      playerBtns.innerHTML = Array.from({ length: maxP }, (_, i) => i + 1)
        .map((p) => `<button class="toggle-btn${p === players ? ' active' : ''}" data-p="${p}">${p}人</button>`).join('');
    }
    function renderScale() {
      if (!selectedId) {
        renderPlayerBtns(4);
        groupsEl.innerHTML = renderDataGroups(m, null);
        return;
      }
      const q = questsWithMonster.find((x) => x.id === selectedId);
      if (q) renderPlayerBtns(q.maxPlayer || 4);
      const f = q ? computeFactors(q) : null;
      groupsEl.innerHTML = renderDataGroups(m, f);
    }

    pickerEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-qid]');
      if (!b) return;
      selectedId = b.dataset.qid || null;
      pickerEl.querySelectorAll('.quest-chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      renderScale();
    });
    playerBtns.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      players = parseInt(b.dataset.p, 10);
      playerBtns.querySelectorAll('.toggle-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      renderScale();
    });
  }

  // ---- 任务详情 ----
  function renderQuestDetail(q) {
    const el = document.getElementById('view-quest-detail');
    const targetNames = [...new Set(q.targets.map((t) => t.monsterName))];
    let html = `<div class="detail-hero" style="flex-direction:column;align-items:flex-start">
      <div class="zh" style="font-size:19px">${questLevelLabel(q)} ${questName(q)}</div>
      <div class="meta-chips">
        <span class="chip">${zh(TR.questType, q.type, '任务')}</span>
        <span class="chip">${zh(TR.questClear, q.clearCond, '完成条件')}</span>
        <span class="chip">${zh(TR.env, q.env, q.env)}</span>
        <span class="chip">${zh(TR.stage, q.stage, q.stage)}</span>
        <span class="chip">最多 ${q.maxPlayer} 人</span>
      </div>
    </div>`;

    html += `<section class="section"><h2>目标怪物</h2><div class="tbl-wrap"><table><thead><tr><th>怪物</th><th>难度倍率</th><th>历战</th></tr></thead><tbody>`;
    for (const t of q.targets) {
      const m = monsters.find((x) => x.id === t.monsterId);
      const rate = t.diff ? diffRates[t.diff] : null;
      html += `<tr><td class="part-name">${zh(TR.monster, t.monsterName, t.monsterName)}</td>
        <td class="num">${rate ? 'HP×' + fmt(rate._Health) + ' / 部位×' + fmt(rate._PartsVital) : '—'}</td>
        <td class="num">${t.legendaryID ? '是' : '—'}</td></tr>`;
    }
    html += '</tbody></table></div></section>';

    html += `<section class="section"><h2>说明</h2><div class="hint">在怪物详情页选择此任务，可查看该怪物在此任务难度下的血量、部位硬直/破坏/伤口与异常状态换算值。</div></section>`;

    // 提供跳转到怪物详情的按钮
    html += `<section class="section"><div class="toggle-group">`;
    for (const n of targetNames) {
      const m = monsters.find((x) => x.name === n);
      if (m) html += `<button class="toggle-btn" data-mon="${m.name}">查看 ${m.zh}</button>`;
    }
    html += '</div></section>';

    el.innerHTML = html;
    el.querySelectorAll('[data-mon]').forEach((b) => {
      b.addEventListener('click', () => openMonster(b.dataset.mon));
    });
  }

  // ---- 伤害计算器 ----
  function renderCalculatorView() {
    const el = document.getElementById('view-calculator');
    const CALC = window.MHWCALC;
    const KURO = window.MHWILD_KURO_HZV || {};
    if (!CALC || !window.MHCalculator) {
      el.innerHTML = '<div class="empty">计算器数据未加载（calc-data.js / calculator.js 缺失）</div>';
      return;
    }

    // 武器（14 种）：招式表按武器分组；操虫棍用逐条核对过的 ig_moves，其余武器来自用户动作值表
    const WEAPON_META = CALC.weaponMeta || {};
    const WEAPON_ORDER = ['great_sword', 'long_sword', 'sword_and_shield', 'dual_blades',
      'hammer', 'hunting_horn', 'lance', 'gunlance', 'switch_axe', 'charge_blade', 'insect_glaive', 'bow', 'heavy_bowgun', 'light_bowgun'];
    // 当前武器的招式表（所有读取招式的地方都走这里，避免混用别的武器）
    function currentMoves() {
      const all = CALC.weaponMoves || {};
      return all[state.weaponId] || CALC.moves || [];
    }
    // 蓄力/等级档位（大剑/大锤/狩猎笛）：表内逐档给了动作值，档位由用户选（用户拍板：0 蓄也存在）
    const levelsOf = (move) => (move && move.chargeLevels && move.chargeLevels.length ? move.chargeLevels : null);
    const levelUnitOf = (move) => (move && move.levelUnit) || '蓄';
    const maxLevelOf = (move) => { const l = levelsOf(move); return l ? l[l.length - 1].level : null; };
    const minLevelOf = (move) => { const l = levelsOf(move); return l ? l[0].level : null; };
    const aliasOf = (move, level) => {
      const l = levelsOf(move);
      const hit = l && l.find((x) => x.level === level);
      return hit && hit.alias ? hit.alias : null;
    };
    // 还没选过档位时默认给最高档（与「表内动作值 = 满蓄档」口径一致）；
    // 数据层可用 defaultLevel 指定默认档（狩猎笛响周波：默认 1 级，用户拍板）
    const defaultLevelOf = (move) => {
      const l = levelsOf(move);
      if (!l) return null;
      const d = move.defaultLevel;
      return (d != null && l.some((x) => x.level === d)) ? d : l[l.length - 1].level;
    };
    const chargeOf = (item, move) => {
      const l = levelsOf(move);
      if (!l) return item.charge;
      const want = item.charge;
      return l.some((x) => x.level === want) ? want : defaultLevelOf(move);
    };
    // 档位级改名（用户 2026-10-08）：太刀直斩系选红刃时显示「赤刃斩」（数据层 chargeLevels[].name）；
    //   没声明 name 的档位返回 null → 显示招式本名（其它武器行为完全不变）
    const levelNameOf = (move, item) => {
      const l = levelsOf(move);
      if (!l) return null;
      const want = (item && item.charge != null) ? chargeOf(item, move) : defaultLevelOf(move);
      const pick = l.find((x) => x.level === want);
      return pick && pick.name ? pick.name : null;
    };
    const moves = CALC.moves || [];   // 兼容：默认（操虫棍）招式表
    const skills = CALC.skills || [];
    const weaponGroups = CALC.weaponGroups || {};
    const sharpness = CALC.sharpness || {};
    const danceMultiplier = CALC.danceMultiplier || {};
    const chargeMultiplier = CALC.chargeMultiplier || {};
    const lamp = CALC.lamp || {};      // 三灯（操虫棍）：攻击力加算 + 部分招式动作值随灯态变
    const KINSECTS = CALC.kinsects || {};   // 猎虫（共斗虫）数据：虫种 + 威力曲线（来源 hasmine）
    const kinsects = (KINSECTS.kinsects || []).filter((k) => k.attackType);
    const kinsectPowerTable = KINSECTS.kinsectPowerMultiplierMasterData || {};
    const kinsectLevels = Array.from({ length: 10 }, (_, i) => i + 1);   // 猎虫等级 Lv1~Lv10
    // 双刀蓝鬼（鬼人闪身）：基础攻击力 ×1.15、属性 +基础属性×0.3（数据来自 dualblades_moves.json 的 blueDemon）
    const blueDemonCfg = CALC.blueDemon || { label: '蓝鬼', attackBaseMul: 1.15, elementBaseAdd: 0.3 };
    // 铳枪炮击表（三种炮击类型 × 等级 1~7）+ 招式级参数
    const GL_SHELL = CALC.gunlanceShell || {};
    const GL_TYPES = (GL_SHELL.types || []).filter(Boolean);
    const GL_TYPE_CN = GL_SHELL.typeLabelCn || {};
    // 默认按估算器：炮击类型 = 扩散型、炮击等级 = 较强（= 表内第 3 列；估算器 act_data!B2 把「较弱/普通/较强/强」映射到 lv1~lv4）
    const GL_DEFAULT_TYPE = (GL_SHELL.meta && GL_SHELL.meta.defaultType) || 'wide';
    const GL_DEFAULT_LEVEL = (GL_SHELL.meta && GL_SHELL.meta.defaultLevel) || 3;
    // 估算器的等级名（只覆盖 lv1~lv4 —— 它的下拉就只有这 4 档；lv5~lv7 表内有值但界面选不到）
    const GL_LEVEL_CN = { 1: '较弱', 2: '普通', 3: '较强', 4: '强' };
    const GL_LEVEL_LABEL = (lv) => (GL_LEVEL_CN[lv] ? `Lv${lv} ${GL_LEVEL_CN[lv]}` : `Lv${lv}`);
    const glShellCfg = GL_SHELL.typeConfig || { normal: { shellsDefault: 6 }, long: { shellsDefault: 3 }, wide: { shellsDefault: 2 } };
    // 炮弹装填（增弹）Lv2：铳枪装填数 +1（估算器 read me!I3）—— 与引擎同一判据（按武器过滤）
    //   全弹发射的「发炮数」上限 = 当前炮击类型的装填数 + 增弹；界面用的就是这个上限（显示值 = 生效值）
    const glShellCapAdd = () => {
      let add = 0;
      const lv = state.skillLevels || {};
      skills.forEach((s) => {
        const level = Number(lv[s.id] || 0);
        if (!level) return;
        (s.levels || []).forEach((L) => {
          if (Number(L.level) > level) return;
          (L.effects || []).forEach((e) => {
            if (e.type !== 'shellCapacityAdd') return;
            if (e.weapons && e.weapons.indexOf('gunlance') < 0) return;
            add += Number(e.value) || 0;
          });
        });
      });
      return add;
    };
    const glShellCapMax = () => {
      const cfg = glShellCfg[state.glType] || {};
      return Math.max(1, Number(cfg.shellsDefault || 0) + glShellCapAdd());
    };
    const POWER_CN = { poison: '毒粉', recovery: '回复粉', blast: '爆破粉', paralysis: '麻痹粉' };
    // 猎虫名用官方中文名（《猎虫数据1.0.xlsx》RodInsectData，nameZh）；匹配不到时退回日文原名
    const kinsectName = (k) => (k && (k.nameZh || k.name)) || '';
    const kinsectLabel = (k) => `${kinsectName(k)}（${k.attackType === 'SEVER' ? '斩击' : '打击'}·${POWER_CN[k.powderType] || k.powderType}）`;
    const sharpKeys = ['red', 'orange', 'yellow', 'green', 'blue', 'white']; // 荒野无紫斩
    const sharpCn = { red: '红', orange: '橙', yellow: '黄', green: '绿', blue: '蓝', white: '白' };
    const EL_CN = { None: '无', Fire: '火', Water: '水', Thunder: '雷', Ice: '冰', Dragon: '龙' };
    const EL_TYPES = ['None', 'Fire', 'Water', 'Thunder', 'Ice', 'Dragon'];   // 武器要么只有属性要么只有异常，故提供「无」
    const ST_TYPES = ['None', 'Poison', 'Sleep', 'Paralyze', 'Blast'];
    const ST_CN = { None: '无', Poison: '毒', Sleep: '睡眠', Paralyze: '麻痹', Blast: '爆破' };

    // 相关技能：某级有 effects 或 special
    // 技能池：只列有数值效果、且本计算器算得出来的技能（poolHidden 的见数据 note）
    const relevantSkills = skills.filter((s) => !s.poolHidden
      && s.levels.some((l) => (l.effects && l.effects.length) || l.special));
    // 招式索引按「当前武器」动态取（换武器后连段会清空，但渲染/派生判断仍需最新表）
    const moveById = new Map(moves.map((m) => [m.id, m]));   // 默认（操虫棍）招式索引
    const moveOf = (id) => {
      const m = currentMoves().find((x) => x.id === id);
      return m || moveById.get(id) || null;
    };
    const rd2 = (v) => Math.round(v * 100) / 100;            // 保留两位（耗斩/属补小计等）

    // 怪物/部位（保留 kuro 原始结构，以便展开各种肉质状态）
    const monsters = Object.keys(KURO).map((name) => ({
      name,
      zh: zh(TR.monster, name, name),
      parts: Object.keys(KURO[name] || {}).map((pk) => ({ key: pk, raw: KURO[name][pk] || {} }))
    }));
    // 训练靶没有KURO肉质，使用已修正的数据库部位与伤口数据。
    const training = RAW['Monster Data'][String(name2id[TRAINING_TARGET])];
    if (training && training.Hitzones && !monsters.some(m => m.name === TRAINING_TARGET)) {
      monsters.push({
        name: TRAINING_TARGET, zh: zh(TR.monster, TRAINING_TARGET, TRAINING_TARGET),
        parts: (training.Hitzones.Rows || []).filter(r => !r.State && r.Meat).map(r => ({
          key: r.Part, raw: { groups: { '普通': [{ s: '', m: r.Meat }] }, at: null, wound: r.ScarMeat || null }
        }))
      });
    }

    // 把某部位的肉质展开成「状态」选项：普通/伤痕/各状态组/历战王/历战伤痕/伤口
    function meatStates(raw) {
      const out = [];
      const groups = (raw && raw.groups) || {};
      Object.keys(groups).forEach((g) => {
        (groups[g] || []).forEach((e) => {
          if (!e || !e.m) return;
          const s = e.s || '';
          let label;
          if (g === '普通') label = s || '普通';
          else if (!s || s === g) label = g;
          else label = g + '·' + s;
          out.push({ label, meat: e.m });
        });
      });
      ((raw && raw.at) || []).forEach((e) => {
        if (!e || !e.m) return;
        out.push({ label: e.s ? '历战王·' + e.s : '历战王', meat: e.m });
      });
      if (raw && raw.wound) out.push({ label: '伤口', meat: raw.wound, isWound: true });
      if (!out.length) out.push({ label: '普通', meat: {} });
      return out;
    }

    const state = {
      weaponId: 'great_sword',
      // 默认是「无属性、无异常」的纯物理武器（用户拍板）：类型选「无」、对应数值 0
      attack: 200, element: 0, elementType: 'None', status: 0, statusType: 'None', affinity: 0,
      sharpness: 'white',
      monster: monsters[0] ? monsters[0].name : '',
      part: '', meatIdx: 0,
      quest: '', players: 1,
      mode: 'expected',
      weakSpot: false, monsterEnraged: false, fullHealth: true, wound: false, overcomeFrenzy: false, clash: false,
      ateMeat: false, dodgeEvade: false, festival: false, warCry: false,   // 套装技能条件：食用烤熟的肉 / 巧击中回避成功 / 祭典期间 / 咆哮后
      absorbHits: 1,
      threeLamp: true,    // 操虫棍三灯（红+白+橙）：攻击力加算 基础×0.15，移动斩/移动连斩 用三灯动作值
      mantle: false,      // 狂龙衣装（狂化装衣）：开启后把衣装给各招补的加段并入原招式
      // 盾斧（charge_blade）：开局选的四项状态 —— 瓶种 / 瓶状态 / 红盾 / 红剑
      cbPhial: 'impact',      // 'impact' = 榴弹瓶 / 'element' = 强属性瓶
      cbReinforced: false,    // 瓶状态：false = 普通瓶 / true = 强化瓶
      cbRedShield: false,     // 红盾（红斧）
      cbRedSword: false,      // 红剑
      // 斩击斧（switch_axe）：武器级开关（用户 2026-10-06 拍板）
      swaxAwakened: false,    // 开刃（觉醒）：剑形态攻击附带瓶爆
      swaxPhial: 'power',     // 'power' = 强击瓶（剑形态招式 +17% 基础攻击力）/ 'element' = 强属性瓶（+45% 基础属性）
      swaxRedAxe: false,      // 红斧（强化敲打开出）：斧形态基础攻击力 +10
      balladCount: 0,         // 狩猎笛：响玉数量（0~3，默认 0）—— 常态招式触发平A共鸣、演奏/奏击/重奏触发演奏共鸣
      // 双刀：蓝鬼（鬼人闪身）开关，默认关；只在选双刀时渲染，切走武器会复位
      blueDemon: false,
      dbMode: 'demon',
      // 铳枪：炮击类型 / 炮击等级（**默认按估算器**：扩散型 + 较强 = 表内 lv3）；只在选铳枪时渲染，切走武器会复位
      glType: 'wide',
      glLevel: 3,
      melodyIds: [],          // 旋律（可选多条；用户 2026-09-30：不是单选，可以多选）
      kinsectId: kinsects.length ? kinsects[0].id : '',
      kinsectLevel: 10,   // 猎虫等级（威力曲线 Lv1~Lv10）
      danceLevel: 0,
      deriveMode: true,   // 连段是否遵循派生逻辑
      itemPicks: {},      // effectGroup → 选中的道具/餐点 id
      combo: [],
      skillLevels: {}, // id -> level
      skillCoverage: {}, // id -> 覆盖率（整数 %，默认 100；只有防具/套装技能与心眼用）
      apexSoulReady:true,encouragement:false,ailment:false,
    };
    // 道具/餐点分组（同组互斥，单选）
    const itemGroups = (CALC.items && CALC.items.groups) || [];
    const PRESET_KEY = 'mhwa_calculator_presets_v1';
    const CONFIG_KEYS = ['weaponId', 'attack', 'affinity', 'element', 'elementType', 'status', 'statusType', 'sharpness',
      'fullHealth', 'overcomeFrenzy', 'clash', 'ateMeat', 'dodgeEvade', 'festival', 'warCry', 'absorbHits',
      'threeLamp', 'mantle', 'cbPhial', 'cbReinforced', 'cbRedShield', 'cbRedSword', 'swaxAwakened', 'swaxPhial','apexSoulReady','encouragement','ailment',
      'swaxRedAxe', 'balladCount', 'blueDemon', 'dbMode', 'glType', 'glLevel', 'melodyIds', 'kinsectId', 'kinsectLevel',
      'itemPicks', 'skillLevels', 'skillCoverage'];
    const clonePreset = value => JSON.parse(JSON.stringify(value));
    function readPresets() {
      try {
        const raw = JSON.parse(localStorage.getItem(PRESET_KEY) || 'null');
        if (!raw || raw.version !== 1) return { version: 1, settings: [], combos: [] };
        const valid = list => (Array.isArray(list) ? list : []).filter(p => p && typeof p.id === 'string'
          && typeof p.name === 'string' && p.name.trim() && p.data && typeof p.data === 'object' && WEAPON_META[p.weaponId]);
        return { version: 1, settings: valid(raw.settings), combos: valid(raw.combos) };
      } catch (e) { return { version: 1, settings: [], combos: [] }; }
    }
    const presetHtml = (kind, label) => `<div class="calc-presets" data-preset-kind="${kind}">
      <label class="calc-field"><span>${label}</span><select id="calc-${kind}-preset"></select></label>
      <div class="calc-preset-actions">
        <button type="button" class="calc-btn ghost" id="calc-${kind}-preset-load">读取</button>
        <button type="button" class="calc-btn ghost" id="calc-${kind}-preset-save">保存当前</button>
        <button type="button" class="calc-btn ghost" id="calc-${kind}-preset-rename">重命名</button>
        <button type="button" class="calc-btn ghost" id="calc-${kind}-preset-delete">删除</button>
      </div>
      <form class="calc-preset-editor" id="calc-${kind}-preset-editor" hidden>
        <label class="calc-field"><span id="calc-${kind}-preset-edit-label">预设名称</span><input id="calc-${kind}-preset-name" maxlength="80" required autocomplete="off"></label>
        <div class="calc-preset-actions"><button type="submit" class="calc-btn" id="calc-${kind}-preset-confirm">保存</button>
        <button type="button" class="calc-btn ghost" id="calc-${kind}-preset-cancel">取消</button></div>
      </form><div class="calc-hint calc-preset-message" id="calc-${kind}-preset-message" role="status" hidden></div>
    </div>`;

    function selectedMonster() { return monsters.find((m) => m.name === state.monster) || null; }
    function selectedPart() { return (selectedMonster()?.parts || []).find((p) => p.key === state.part) || null; }
    function currentMeat() {
      const p = selectedPart();
      if (!p) return {};
      const list = meatStates(p.raw);
      const i = Math.min(Math.max(state.meatIdx, 0), list.length - 1);
      return list[i] ? list[i].meat : {};
    }
    // 当前肉质状态是否「伤口」（选伤口肉质时自动应用伤口相关技能）
    function currentIsWound() {
      const p = selectedPart();
      if (!p) return false;
      const list = meatStates(p.raw);
      const i = Math.min(Math.max(state.meatIdx, 0), list.length - 1);
      return !!(list[i] && list[i].isWound);
    }
    // 当前肉质状态的显示名（普通 / 伤痕 / 历战王 / 历战王·伤痕 / 伤口）
    function currentMeatLabel() {
      const p = selectedPart();
      if (!p) return '';
      const list = meatStates(p.raw);
      const i = Math.min(Math.max(state.meatIdx, 0), list.length - 1);
      return (list[i] && list[i].label) || '';
    }
    // ===== 怪物发怒「受击倍率」（用户 2026-10-08）：数据库 AngryTable 的 PlDamage（player dmg）=====
    //   取 Lower / Upper 两档里的最大值（与「怪物图鉴 · 疲劳/发怒」表的显示口径一致）；
    //   数据库没有发怒表 / 未勾「怪物愤怒」时为 1（中性因子）
    function enrageRateOf(monsterName) {
      const id = name2id[monsterName];
      const d = (id != null) ? RAW['Monster Data'][String(id)] : null;
      const t = (d && d.AngryTable && d.AngryTable[0]) || null;
      if (!t) return null;
      const vals = ['Lower', 'Upper']
        .map((k) => (t[k] ? Number(t[k].PlDamage) : NaN))
        .filter((v) => isFinite(v));
      if (!vals.length) return null;
      return { max: Math.max.apply(null, vals) };
    }
    function currentEnrageMul() {
      if (!state.monsterEnraged) return 1;
      const r = enrageRateOf(state.monster);
      return r ? r.max : 1;
    }
    // 按任务和人数取 Scar Raw。历战伤口×1.3单独交给引擎，不混入字段数值。
    function scarRawOf() {
      const [id, index] = state.quest.split(':');
      const sc = questScarRawOf(state.monster, id, Number(index) || 0, state.players);
      return { ...sc, legendary: state.quest ? sc.legendary : /伤痕/.test(currentMeatLabel()) };
    }
    // 部位是否头部（只有头部累计晕厥）
    function currentIsHead() {
      const p = selectedPart();
      return !!(p && /head/i.test(p.key));
    }
    // 已选道具/餐点
    function currentItems() {
      return Object.keys(state.itemPicks)
        .map((k) => state.itemPicks[k])
        .filter(Boolean)
        .map((id) => {
          for (const g of itemGroups) { const o = g.options.find((x) => x.id === id); if (o) return o; }
          return null;
        })
        .filter(Boolean);
    }

    // ===== 飞燕（数据表列39 IsSkillHien）=====
    // 只有被标记的 hit 动作值吃飞燕加成；分母只算棍子 hit（猎虫 hit 本就不参与伤害计算）。
    // 注意：跳跃斩 / 跳跃突进斩这类「空中」招式并没有标记，不吃飞燕，需要显式告知用户。
    function hienInfo(move) {
      if (!move || !move.hits) return null;
      const blade = move.hits.filter((h) => h.type !== 'insect');
      const hit = blade.filter((h) => h.hien).length;
      return hit ? { hit: hit, total: blade.length, all: hit === blade.length } : null;
    }
    function hienTag(move) {
      const i = hienInfo(move);
      return i ? `<i class="calc-hien-tag">飞燕${i.all ? '' : ' ' + i.hit + '/' + i.total}</i>` : '';
    }
    // ===== 高速变形（盾斧/斩击斧）=====
    // 用户 2026-09-30 口径：**凡「打这一刀时剑斧形态变了」就吃**（不加任何手写白名单）。
    //   判据 = 上一招打完的形态 ≠ 这一招打完的形态 —— 所以 盾突刺/防御 之后派生的大解·超解（剑→斧）
    //   同样吃；超解自己（斧→剑）也吃。狂龙衣加段不吃（引擎侧按 isMantle 归零）。
    const isMorphMove = (move) => !!(move && move.morph);
    // 技能是否真的在生效（高速变形没勾就不亮标，避免误导）
    //   注意技能等级存在 state.skillLevels（{技能id: 等级}），不是数组
    function morphSkillOn() {
      return Number((state.skillLevels || {})['HunterSkill_047'] || 0) > 0;
    }
    // 连段里「打第 i 招时人在剑形态还是斧形态」（与引擎 cbFormPrev 同一套推导）
    function formStateAt(idx) {
      let f = null;
      for (let k = 0; k < idx; k++) {
        const mv = moveOf(state.combo[k].moveId);
        if (mv) f = formAfter(mv, state.combo[k]);
      }
      const cur = state.combo[idx] ? moveOf(state.combo[idx].moveId) : null;
      if (f) return f;
      // 第一招 / 上一次没记到形态：不限起手形态的招式（超解 swingForm）取「挥砍形态」
      return cur ? (cur.swingForm || cur.form || null) : null;
    }
    // 这一招会不会换形态（引擎按同一判据加成形倍率）：
    //   ① 进招时人在的形态 ≠ 挥砍形态（斧：变形斩 剑→斧、剑形态出的超解 剑→斧、斧形态出的集中二连斩 斧→剑…）
    //   ② 招式自身就是变形招式（morph）→ 整招都吃，但 autoReturn（超解演出收招回剑）不算
    function morphChangesAt(idx) {
      const item = state.combo[idx];
      const mv = item ? moveOf(item.moveId) : null;
      if (!mv) return false;
      return morphChanges(mv, formStateAt(idx));
    }
    // 通用判据：给定「进招时所在的形态」，这一招会不会造成形态变化（招式选择器/派生提示/连段行共用）
    function morphChanges(mv, fromForm) {
      if (!mv) return false;
      const from = fromForm || null;
      const swing = mv.swingForm || mv.form || null;
      const entryChange = !!(from && swing && from !== swing);
      const selfMorph = !!(mv.morph && !mv.autoReturn);
      return entryChange || selfMorph;
    }
    // 派生列表里的招式：这一招会不会发生形态变化（供「高速变形」亮标用，与引擎同一判据）
    function morphTagInList(move) {
      if (!move) return '';
      const lastItem = state.combo.length ? state.combo[state.combo.length - 1] : null;
      const lastMove = lastItem ? moveOf(lastItem.moveId) : null;
      const from = lastMove
        ? (formAfter(lastMove, lastItem) || lastMove.swingForm || lastMove.form || null)
        : null;
      return (morphSkillOn() && morphChanges(move, from)) ? '<i class="calc-morph-tag">高速变形</i>' : '';
    }
    // ===== 长枪力防（力量格挡的「力防层数」）=====
    // 用户拍板：力量格挡给 0/1/2/3 层选项（默认 3），1/2/3 层 → 紧接它之后派生出的那一招的**前 3 hit**
    //   动作值 ×1.1/1.3/1.7（表内 r116）。倍率与命中的 hit 数由引擎给出（forceGuardUsed），
    //   界面按引擎的实际生效结果标注 —— 显示值 = 生效值。
    const forceGuardLevelOf = (item, move) => {
      if (!move || !move.forceGuardBuff) return null;
      const fgb = move.forceGuardBuff;
      const raw = (item && item.forceGuard !== undefined) ? Number(item.forceGuard) : Number(fgb['default'] || 0);
      const lo = Number(fgb.min || 0), hi = Number(fgb.max || 3);
      if (!Number.isFinite(raw)) return lo;
      return Math.max(lo, Math.min(hi, raw));
    };
    function forceGuardTagAt(idx) {
      const hit = (state.forceGuardUsed || []).filter((x) => x.comboIndex === idx)[0];
      if (hit) {
        return `<i class="calc-force-tag" title="力防 ${hit.level} 层：本招前 ${hit.hits} hit 动作值 ×${hit.mul}`
          + `（表内 r116 力防 buff 派生加成倍率；只作用于紧接力量格挡之后的那一招）">`
          + `力防 ${hit.level} 层 ×${hit.mul} · 前 ${hit.hits} hit</i>`;
      }
      // 还没算出结果时（例如刚插入力量格挡）：按当前所选层数给个预告，标「待生效」
      if (idx > 0) {
        const prevItem = state.combo[idx - 1];
        const prevMove = prevItem ? moveOf(prevItem.moveId) : null;
        const lv = forceGuardLevelOf(prevItem, prevMove);
        const mul = lv != null ? (prevMove.forceGuardBuff.multipliers || [])[lv] : null;
        if (mul && mul !== 1) {
          const hs = Math.max(1, Number(prevMove.forceGuardBuff.hits) || 3);
          return `<i class="calc-force-tag" title="力防 ${lv} 层：本招前 ${hs} hit 动作值 ×${mul}（表内 r116）">`
            + `力防 ${lv} 层 ×${mul} · 前 ${hs} hit</i>`;
        }
      }
      return '';
    }

    // ===== 连段派生约束 =====
    // 规则（用户拍板）：**第一招任意招式都可以选**（自由态起手不受派生树限制），
    //   从第二招开始才按派生逻辑限制：空中只能接空中招式、落地后按派生招 + 通用派生招。
    //   招式数据里的 domain = 能否从该状态打出，endsIn = 打完后处于哪个状态
    // 盾斧：一招打完后处于剑形态还是斧形态（toForm；集中二连变形斩看「打完 / 不打完」选项）
    function formAfter(move, item) {
      if (!move) return null;
      if (move.recoveryOption) return (move.recoveryOption.variants[item?.recovery ?? move.recoveryOption.default] || move.recoveryOption.variants[0]).toForm;
      if (move.sequenceOptions) return item?.finish === false ? move.form : (move.sequenceOptions[item?.wound ? 'wound' : 'none'][item?.sequence ?? 0] || move.sequenceOptions[item?.wound ? 'wound' : 'none'][0]).toForm || move.form;
      if (move.energyOption && item && item.energy === false) return move.form;
      if (move.aimVariants) {
        const v = move.aimVariants[Math.min(Math.max(Number(item && item.aim) || 0, 0), move.aimVariants.length - 1)];
        if (v && v.toForm) return v.toForm;
      }
      if (move.finishOption) {
        const want = (item && item.finish !== undefined) ? !!item.finish : !!move.finishOption['default'];
        const v = (move.finishOption.variants || []).find((x) => x.value === want);
        if (v && v.toForm) return v.toForm;
      }
      return move.toForm || move.form || null;
    }
    const DB_MODE_NAMES = { normal: '普通', enhanced: '鬼人强化', demon: '鬼人化' };
    function dbModeOf(item, move) {
      const mode = item && item.dbMode || state.dbMode;
      return !move || !move.dbModes || move.dbModes.includes(mode) ? mode : move.dbModes[0];
    }
    function nextMoveOptions() {
      const mv = currentMoves();
      const meta = WEAPON_META[state.weaponId] || {};
      if(meta.rangedDerive){
        const allowed=window.MHCalculator.rangedNextMoves(state.weaponId,mv,state.combo),tags={};
        allowed.forEach(m=>tags[m.id]='派生');
        return {list:state.deriveMode?allowed:mv,tags,hint:''};
      }
      // 其他武器的派生表还没做（用户：先默认关闭派生逻辑，后面再逐把调整）→ 一律允许任意接招
      if (!meta.hasDerive) {
        return { list: mv, tags: {}, hint: `「${meta.nameCn || '本武器'}」派生逻辑待补充：当前可任意接招` };
      }
      // 关闭「遵循派生逻辑」→ 任意接招，但**派生树不清空**（用户 2026-10-01）：
      //   候选列表放开成全招式，上一招的派生关系仍然照常算出来、照常标注（「派生」/「通用」），
      //   提示里也保留「上一招打完后能派生什么」——只是不再限制只能选这些。
      const freeWrap = (r) => (state.deriveMode ? r : {
        list: mv,
        tags: r.tags,
        edgeTags: r.edgeTags,
        hint: r.hint
      });
      const airMoves = mv.filter((m) => m.domain === 'air');
      const byId = new Map(mv.map((m) => [m.id, m]));
      // 第一招：任意招式都可以起手（自由态）
      if (!state.combo.length) {
        const starters = mv.filter(m => !state.deriveMode || (state.weaponId !== 'switch_axe' || state.swaxAwakened || !m.requiresAwakened)
          && (state.weaponId !== 'dual_blades' || !m.dbModes || m.dbModes.includes(state.dbMode)));
        return { list: starters, tags: {}, hint: '' };
      }
      const last = byId.get(state.combo[state.combo.length - 1].moveId);
      if (!last) return { list: mv, tags: {}, hint: '' };
      const lastItem = state.combo[state.combo.length - 1];
      const dbMode = dbModeOf(lastItem, last);
      const dbBranchIds = last.branchesByDbMode && last.branchesByDbMode[dbMode];
      // 招式级伤口限制同时作用于显式后继和通用follower。
      const nextAllowed = (id) => {
        if (!lastItem.wound && (last.blockedNextWhenNoWound || []).includes(id)) return false;
        // 斩斧变形/处决后的接招以结束形态为准，避免源形态标签漏出旧形态招式。
        const candidate = byId.get(id);
        if (state.weaponId === 'dual_blades' && candidate && candidate.dbModes
          && !candidate.dbModes.includes(dbMode) && !(dbBranchIds || []).includes(id)) return false;
        if (candidate && candidate.requiresAwakened && !state.swaxAwakened) return false;
        if (state.weaponId === 'switch_axe' && (last.toForm || last.aimVariants || last.energyOption)
          && candidate && candidate.form && candidate.form !== formAfter(last, lastItem)) return false;
        return true;
      };

      // 上一招的直接派生：带 branchesWhenSpin 的（大锤回旋攻击）按「圈数」分支
      let branchIds = last.branches || [];
      if (last.recoveryOption) branchIds = (last.recoveryOption.variants[lastItem.recovery ?? last.recoveryOption.default] || last.recoveryOption.variants[0]).branches;
      if (dbBranchIds) branchIds = dbBranchIds;
      if (last.branchesByCharge) branchIds = last.branchesByCharge[chargeOf(lastItem, last)] || [];
      if (last.branchesByComboStep) {
        let step = null;
        state.combo.forEach(it => {
          const m = byId.get(it.moveId);
          if (m && m.comboStep != null) step = m.comboStep;
          else if (m && m.advanceComboStep) step = step == null ? null : Math.min(3, step + 1);
          else step = null;
        });
        if (step != null) branchIds = last.branchesByComboStep[step] || branchIds;
      }
      if (last.branchesByForm) branchIds = last.branchesByForm[formAfter(last, lastItem)] || [];
      if (last.branchesWhenReload && lastItem.energy === false) branchIds = last.branchesWhenReload;
      if (last.branchesWhenGp && lastItem.gp) branchIds = last.branchesWhenGp;
      if (last.branchesWhenCounter && lastItem.counter) branchIds = last.branchesWhenCounter;
      if (last.completionOption) {
        const opts = last.completionOption.variants;
        const pick = opts[lastItem.completion] || opts[last.completionOption.default];
        branchIds = pick.branches || [];
      }
      let spinRuleLabel = '';
      let prevRuleLabel = '';
      if (last.branchesWhenSpin) {
        const cur = lastItem.spin != null ? lastItem.spin : null;
        const rule = last.branchesWhenSpin.find((r) => (r.min == null || (cur != null && cur >= r.min)) && (r.max == null || (cur != null && cur <= r.max)));
        if (rule) { branchIds = rule.to; spinRuleLabel = rule.label; }
      }
      // 大剑「冲撞攻击」：后继由「冲撞前那一招」决定（用户口述里蓄力斩后 / 强蓄力斩后各不同）
      //   → 与招式自身的无条件后继**取并集**（冲撞攻击 → 上捞斩/抵消上捞斩 是无条件的）
      if (last.branchesWhenPrev) {
        const prevItem = state.combo.length >= 2 ? state.combo[state.combo.length - 2] : null;
        const prevId = prevItem ? prevItem.moveId : null;
        const extra = (prevId && last.branchesWhenPrev[prevId]) || [];
        branchIds = branchIds.concat(extra.filter((id) => branchIds.indexOf(id) < 0));
        if (!prevId) prevRuleLabel = '（没记录上一招 → 只给无条件后继）';
      }
      // 狩猎笛「奏击」连段状态机（用户 2026-09-30：奏击2 后不能再奏击了）
      //   链只有 无奏击 →(奏击I)→ 已有奏击I →(奏击II)→ 结束；演奏（tag pf）重新起链。
      //   状态由连段自动推导；奏击节点在数据里声明 beatState（进招所需状态）/ beatNext（打完后的状态）
      //   → 这里按状态过滤候选：既不会同时冒出奏击I/奏击II，也不会在奏击II 之后再出奏击
      //     （含经由响周波/其他旋律的间接派生 —— 状态跟着连段走，不是只看上一招）
      const beatChain = (CALC.hornUiRules && CALC.hornUiRules.beatChain) || null;
      const beatLabels = (beatChain && beatChain.labels) || {};
      const beatState = (() => {
        if (!beatChain) return null;
        const reset = beatChain.resetTags || [];
        const start = beatChain.start || 'none';
        let st = start;
        state.combo.forEach((it) => {
          const m = byId.get(it.moveId);
          if (!m) return;
          if (reset.length && (m.tags || []).some((t) => reset.indexOf(t) >= 0)) { st = start; return; }
          if (m.beatNext != null) st = m.beatNext;
        });
        return st;
      })();
      // 状态不匹配的奏击节点：从候选里拿掉，并记下当前状态（提示里解释为什么没给）
      let prevBeatNote = '';
      let beatHeld = false;
      const beatOk = (m) => {
        if (beatState == null || m.beatState == null) return true;
        if (m.beatState === beatState) return true;
        beatHeld = true;
        return false;
      };
      // 当前状态下还有没有可用的奏击节点（没有 = 链已结束 / 还没起链）
      const beatAvailable = beatState != null && mv.some((m) => m.beatState === beatState);
      // 「只能派生 …」白名单开关（盾斧二解 1 hit / 集中二连变形斩没打完 / 超解）—— 先声明，下面几处都要用
      let onlyBranch = false;
      if (last.branchesByTarget) {
        const target = last.bloomOption && lastItem.bloom ? 'bloom' : (lastItem.wound ? 'wound' : 'none');
        const rule = last.branchesByTarget[target];
        if (rule) { branchIds = rule.to; onlyBranch = !!rule.only; }
      }
      // 盾斧集中二连变形斩：打完 / 不打完 决定形态，也决定能派生什么（打完才接一解/上捞斩）
      if (last.branchesWhenFinish) {
        const fin = (lastItem.finish !== undefined) ? !!lastItem.finish : !!last.finishOption['default'];
        branchIds = last.branchesWhenFinish[String(fin)] || [];
        // 不打完 → 「只能派生 剑：变形斩」白名单（用户 2026-09-30：没打完只能派生剑变形斩）
        if (last.branchOnlyWhenFinish && last.branchOnlyWhenFinish[String(fin)]) onlyBranch = true;
      }
      // 盾斧二解：选了 1 hit 就只剩变形斩（用户口述）
      if (last.branchesWhenHits) {
        let curHits = lastItem.hits != null ? lastItem.hits : last.hitSelect ? last.hitSelect['default'] : null;
        let beforeIndex = state.combo.length - 2;
        if (last.accumulateHits) {
          while (beforeIndex >= 0 && state.combo[beforeIndex].moveId === last.id) {
            curHits += state.combo[beforeIndex].hits == null ? last.hitSelect.default : state.combo[beforeIndex].hits;
            beforeIndex--;
          }
        }
        const beforeId = state.combo[beforeIndex] && state.combo[beforeIndex].moveId;
        const rule = last.branchesWhenHits.find((r) => (r.min == null || curHits >= r.min)
          && (r.max == null || curHits <= r.max) && (!r.afterIds || r.afterIds.includes(beforeId)));
        if (rule) { branchIds = rule.to; onlyBranch = rule.only !== false; }
      }
      // 盾斧集中二连斩：勾了「命中伤口」就只剩集中二连变形斩（用户口述）
      if (last.branchesWhenWound && lastItem.wound) { branchIds = last.branchesWhenWound; onlyBranch = true; }
      if (last.branchesWhenNoWound && !lastItem.wound) { branchIds=last.branchesWhenNoWound; onlyBranch=false; }
      // 「只能派生 …」白名单（盾斧超解打完只剩 牵制斩/突进斩/防御）：不并入形态通用派生
      if (last.branchOnly) onlyBranch = true;
      // 奏击链状态机：上面那些规则定完候选之后再按状态过滤（换过候选的规则也不会漏出非法奏击）
      if (beatChain) branchIds = branchIds.filter((id) => { const m = byId.get(id); return !m || beatOk(m); });

      // 盾斧形态：当前形态由连段自动推导（第一招决定，之后按 toForm 走）。
      // 形态约束写在数据里：通用派生用 follower.forms 声明「只能在某形态之后接」，
      // 直接派生（branches）是显式链（如 回旋斩→大解 这种变形接法），不受形态过滤。
      // 注意：判定要用「上一招打完后」的形态（cbForm）——变形类招式打完后形态已换掉：
      //   剑：变形斩 = 剑→斧，斧：变形斩 = 斧→剑（用户拍板），后继必须按换完后的形态给。
      const cbForm = formAfter(last, lastItem);

      // 「可接在哪些招式之后」的通用规则（大锤：蓄力/敲打1/集中殴打/追击回旋敲打/回旋攻击）
      const followerOk = (m) => {
        if (!nextAllowed(m.id)) return false;
        if (state.weaponId === 'dual_blades' && m.dbModes && !m.dbModes.includes(dbMode)) return false;
        const f = m.follower;
        if (!f) return !!m.universalFollower;
        if (f.forms && cbForm && f.forms.indexOf(cbForm) < 0) return false;
        // 狩猎笛：这些招式之后也能接本招（震打之后可接常规招式）→ 在标签判据之前放行
        if (f.prevIds && f.prevIds.indexOf(last.id) >= 0) return true;
        // 狩猎笛：奏击连段状态机 —— 状态不匹配的奏击节点通用派生里也不能冒出来
        if (!beatOk(m)) return false;
        // 狩猎笛：按「上一招的类别标签」取后继（常态招式 / 演奏 / 奏击 / 重奏 / 旋律）
        if (f.onlyTags && !(last.tags || []).some((t) => f.onlyTags.indexOf(t) >= 0)) return false;
        // 狩猎笛：常态招式之间**排除自己**（用户 2026-09-30：笛子的常态招式不能派生自己）
        if (f.prevGroup && (last.tags || []).indexOf(f.prevGroup) >= 0 && last.id === m.id) return false;
        if (f.onlyIds && f.onlyIds.indexOf(last.id) < 0) return false;
        if (f.exceptIds && f.exceptIds.indexOf(last.id) >= 0) return false;
        // 狩猎笛：上一招是某类标签时也不给（柄击不能接在响周波/其他旋律之后 —— 用户 2026-09-30）
        if (f.exceptWhenPrevTags && (last.tags || []).some((t) => f.exceptWhenPrevTags.indexOf(t) >= 0)) return false;
        if (f.exceptTags && (last.tags || []).some((t) => f.exceptTags.indexOf(t) >= 0)) return false;
        return true;
      };

      // 打完上一招后人在哪：空中（飞天螺旋斩、跳跃突进斩）还是已落地
      const completedVariant = last.completionOption && (last.completionOption.variants[lastItem.completion]
        || last.completionOption.variants[last.completionOption.default]);
      const inAir = (completedVariant && completedVariant.endsIn || last.endsIn) === 'air';
      if (inAir) {
        // 空中默认列出所有空中招式；招式若用 airBranchesOnly 声明（大锤：空中回旋攻击 旋转 → 终结），
        // 再按它的 branches 收窄（其余武器的既有行为不变）
        const narrowed = last.airBranchesOnly && branchIds.length;
        const list = narrowed ? airMoves.filter((m) => branchIds.indexOf(m.id) >= 0) : airMoves;
        const tags = {};
        list.forEach((m) => { tags[m.id] = narrowed && branchIds.indexOf(m.id) >= 0 ? '派生' : '空中'; });
        const hint = `「${last.name}」打完后在空中：只能接空中招式（` + list.map((m) => m.name).join(' / ') + '）';
        return freeWrap({ list, tags, hint });
      }

      const tags = {};
      branchIds = branchIds.filter(nextAllowed);
      branchIds.forEach((id) => { tags[id] = '派生'; });
      // 边上的标签（铳枪：某些派生边带「加速」，用户 2026-10-01）→ 挂在「上一招 → 这一招」这条边上
      const edgeTags = Object.assign({}, last.branchTags || {});
      // 「只能派生 …」类规则（盾斧二解 1 hit / 集中二连斩命中伤口）：不再并入通用派生
      if (!onlyBranch) mv.filter(followerOk).forEach((m) => { if (!tags[m.id]) tags[m.id] = '通用'; });
      // 这一招打完回到自由态 → 又等于「第一招」，任意招式都可以接（空中招式仍需先起跳）
      if (last.returnsToFree) {
        const freeList = mv.filter((m) => m.domain !== 'air' && (!last.freeForms ||
          (last.freeForms.includes(m.form) && (m.starter || followerOk(m)))) && (!last.freeIds || last.freeIds.includes(m.id)) && nextAllowed(m.id));
        const freeTags = {};
        branchIds.forEach((id) => { if (byId.get(id) && byId.get(id).domain !== 'air') freeTags[id] = '派生'; });
        if (!onlyBranch) mv.filter((m) => followerOk(m) && m.domain !== 'air').forEach((m) => { if (!freeTags[m.id]) freeTags[m.id] = '通用'; });
        return freeWrap({ list: freeList, tags: freeTags, edgeTags, hint: '' });
      }
      // 落地后只能打地面招式（空中招式需要先起跳）
      const list = mv.filter((m) => tags[m.id] && (m.domain !== 'air' || (last.allowAirBranches && branchIds.includes(m.id))));
      // 狩猎笛：奏击链状态不匹配 → 说明为什么这个奏击没给（状态 → 原因文案，都写在数据层）
      //   ① 候选里有奏击被状态机挡掉（如演奏之后没给奏击II）
      //   ② 链已结束（奏击II 之后）而上一招本来属于奏击链上下文 → 也要说清「不能再奏击」
      if (beatState != null && beatLabels[beatState]
        && (beatHeld || (!beatAvailable && (last.tags || []).some((t) => (beatChain.contextTags || []).indexOf(t) >= 0)))) {
        prevBeatNote = beatLabels[beatState];
      }
      // 吃飞燕的招式在提示里打 ▴（选择器列表里有完整「飞燕」标签）
      // 狩猎笛：演奏 / 奏击 / 重奏 之后自动派生旋律 —— 其他旋律只写「旋律已生效」，响周波逐个列出数值
      const melodyNote = (last.tags || []).some((t) => ['pf', 'pf2', 'pf3'].indexOf(t) >= 0)
        ? '旋律已生效（其他旋律）　' : '';
      const hint = list.length
        ? melodyNote + (prevBeatNote ? prevBeatNote.trim() : '')
        : melodyNote + `「${last.name}」后无派生招式，请点「清空」重新起手`;
      return freeWrap({ list, tags, edgeTags, hint });
    }

    // 结果渲染
    function renderResults(r) {
      const grid = el.querySelector('#calc-result-grid');
      const tbl = el.querySelector('#calc-hit-table');
      const stat = (a, b, cls) => `<div class="calc-stat${cls ? ' ' + cls : ''}"><span>${a}</span><strong>${b}</strong></div>`;
      // 总伤害优先展示
      grid.innerHTML = [
        stat('总伤害', r.totalDamage.toFixed(2), 'primary'),
        stat('物理伤害', (r.totalPhysical??r.totalRaw).toFixed(2)),
        stat('属性伤害', r.totalElement.toFixed(2)),
        stat('固伤', (r.totalFixed||0).toFixed(2)),
        stat('连招总动作值', (r.totalMotionValue||0).toFixed(2)),
        stat('连招总属补', (r.totalElementRate||0).toFixed(2)),
        stat('异常累计(期望)', r.totalStatus.toFixed(2)),
        stat('晕厥累计', r.totalStun.toFixed(2)),
        stat('最终会心率', (r.affinityVsTarget != null ? r.affinityVsTarget : r.affinity).toFixed(1) + '%')
      ].join('');

      if (!r.hits.length) { tbl.innerHTML = '<div class="empty">请先添加招式。</div>'; return; }

      // 按招式分组：默认折叠，点招式行展开逐刀明细（十几刀的招式不会占一屏）
      const groups = [];
      r.hits.forEach((h) => {
        const last = groups[groups.length - 1];
        if (last && last.comboIndex === h.comboIndex) last.hits.push(h);
        else groups.push({comboIndex:h.comboIndex, moveId: h.moveId, moveName: h.moveName, charge: h.charge, chargeInherited: h.chargeInherited, dance: h.dance, hits: [h] });
      });

      let html = '';
      // 面板选「无」属性/「无」异常时，属补/异常补与对应伤害列一律不显示（无意义）
      const hasElem = !r.noElement;
      const hasStatus = !r.noStatus;
      // 飞燕：**勾了技能才亮标**（逐刀那一刀发绿 + 单元格淡绿底），不写文字；
      //   没勾技能时结果栏一个飞燕字样都不出现。
      const airMult = r.state && r.state.airborneMult ? r.state.airborneMult : 1;
      groups.forEach((g, gi) => {
        const contribution=r.moveContributions?.find(x=>x.comboIndex===g.comboIndex);
        const blade = g.hits.filter((h) => !h.kinsect && !h.hornSound && !h.shelling && !h.woundBurst);
        const insects = g.hits.filter((h) => h.kinsect);
        const sounds = g.hits.filter((h) => h.hornSound);   // 狩猎笛音波 / 响玉共鸣（固伤，单列展示）
        const shells = g.hits.filter((h) => h.shelling);    // 铳枪炮击系（固伤，单列展示：参考狩猎笛音波做法）
        const sum = blade.reduce((a, h) => ({
          raw: a.raw + h.raw, element: a.element + h.element, status: a.status + h.status, stun: a.stun + h.stun
        }), { raw: 0, element: 0, status: 0, stun: 0 });
        const tags = [];
        if(g.hits.some(h=>h.swaxPhial))tags.push('开刃瓶爆 '+g.hits.filter(h=>h.swaxPhial).length+' hit');
        if(state.weaponId==='switch_axe'&&moveOf(g.moveId)?.form==='sword')tags.push(state.swaxPhial==='power'?'强击瓶：剑形态基础攻击力×1.17':'强属性瓶：剑形态属性×1.45');
        const wyvern=shells.find(h=>h.shellMove==='wyvernfire');
        if(wyvern)tags.push((GL_TYPE_CN[wyvern.shellTypeKey]||wyvern.shellTypeKey)+' 龙击炮：每hit动作值'+rd2(wyvern.shellMv)+'／火属性'+rd2(wyvern.shellFire));
        // 边上的标签（铳枪「加速」）：这一招是经由上一条边的「加速」派生出来的 → 行内标出来
        const prevEdge = gi > 0 ? (() => {
          const pm = moveOf(state.combo[gi - 1] ? state.combo[gi - 1].moveId : null);
          const bt = pm && pm.branchTags;
          return bt ? bt[g.moveId] : null;
        })() : null;
        // 这一招被下一招的「打断上一个蓄力斩」整体取消：整招 0 伤害、不进动作值/耗斩合计
        if (blade.length && blade.every((h) => h.cancelled)) tags.push('已取消（被打断）');
        // 档位不写成文字（用户 2026-10-08）：选中的档位由行内档位按钮的高亮表示，行内不再出现「N蓄」这类标签
        if (g.dance) tags.push('舞踏' + g.dance);
        if (blade.some((h) => h.isWeak)) tags.push('弱点');
        const hienCt = blade.filter((h) => h.hien).length;
        // 飞燕：勾了技能才亮标，而且只写一个词（不写刀数、不写数值）
        if (hienCt && airMult !== 1) tags.push('飞燕');
        // 高速变形：这一招换了形态（剑↔斧）且技能在生效 → 同样只写一个词
        if (blade.some((h) => h.morph)) tags.push('高速变形');
        // 盾斧：瓶爆 / 电锯跳数（各自单独标注，与主命中区分）
        const phialHits = blade.filter((h) => h.phial);
        if (phialHits.length) {
          tags.push('瓶爆 ' + phialHits.length + ' hit（' + (phialHits[0].phialKind === 'element' ? '强属性瓶' : '榴弹瓶')
            + ' · 单次 ' + rd2(phialHits.reduce((a, h) => a + h.element + h.raw, 0) / phialHits.length)
            + (phialHits[0].phialMultiplier && Math.abs(phialHits[0].phialMultiplier - 1) > 0.001 ? ' · ×' + rd2(phialHits[0].phialMultiplier) : '') + '）');
        }
        const sawHits = blade.filter((h) => h.saw);
        if (sawHits.length) tags.push('电锯 ' + sawHits.length + '/' + (sawHits[0].sawMax || sawHits.length) + ' 跳');
        const sharpCt = blade.reduce((a, h) => a + (h.sharpCost || 0), 0);
        // 不耗斩味的 hit（表列58，如音波/瓶爆/柄击类）不进耗斩口径；「斩补是否仍生效」按表列59 区分
        const noSharpBlade = blade.filter((h) => h.noSharp && !h.phial);
        const noSharpNoBonus = noSharpBlade.filter((h) => !h.forceSharp).length;
        const noSharpNote = noSharpBlade.length
          ? '（' + noSharpBlade.length + ' hit 不耗斩味' + (noSharpNoBonus === noSharpBlade.length ? '且不吃斩味补正' : '') + '）'
          : '';
        // 耗斩单位是「刀」（斩味刀数），与 hit 数是两回事
        if (sharpCt) tags.push('耗斩 ' + rd2(sharpCt / 10) + '刀' + noSharpNote);
        // 猎虫 hit：伤害照算（hasmine 模型），但不进棍子的动作值/耗斩口径
        let insectTag = '';
        if (insects.length) {
          const imv = insects.reduce((a, h) => a + (Number(h.mv) || 0), 0);
          const ier = insects.reduce((a, h) => a + (Number(h.elemRate) || 0), 0);
          const iraw = insects.reduce((a, h) => a + h.raw, 0);
          const iele = insects.reduce((a, h) => a + h.element, 0);
          insectTag = `<i class="calc-insect-tag">猎虫 ${insects.length} hit · 动作值 ${imv}`
            + (hasElem ? ` · 属补 ${rd2(ier)}` : '')
            + ` · 物理 ${rd2(iraw)} · 属性 ${rd2(iele)}</i>`;
        }
        // 狩猎笛音波 / 响玉共鸣：固伤，像猎虫那样单独标注（伤害计入总伤害，动作值不并入武器合计）
        //   两者可能同时出现（演奏类招式同时触发音波与响玉共鸣）→ 各标各的
        let soundTag = '';
        if (sounds.length) {
          const mkSound = (label, list) => {
            const smv = list.reduce((a, h) => a + (Number(h.mv) || 0), 0);
            const ser = list.reduce((a, h) => a + (Number(h.elemRate) || 0), 0);
            const sraw = list.reduce((a, h) => a + h.raw, 0);
            const sele = list.reduce((a, h) => a + h.element, 0);
            // 晕厥：演奏音波自己带晕厥值（表内 r70 = 5）× 技能晕厥乘区；只打头部才累计 → 与非头部时一样显示实际生效值
            const sstun = list.reduce((a, h) => a + (Number(h.stun) || 0), 0);
            return `<i class="calc-insect-tag">${label} ${list.length} hit · 动作值 ${rd2(smv)}`
              + (hasElem ? ` · 属补 ${rd2(ser)}` : '')
              + ` · 物理 ${rd2(sraw)} · 属性 ${rd2(sele)} · 晕厥 ${rd2(sstun)}</i>`;
          };
          const waves = sounds.filter((h) => !h.ballad);
          const ballads = sounds.filter((h) => h.ballad);
          soundTag = (waves.length ? mkSound('音波', waves) : '') + (ballads.length ? mkSound('响玉共鸣', ballads) : '');
        }
        // 铳枪炮击系：**不再单列小字**（用户 2026-10-01：「炮击的伤害不要小字显示，还是显示在招式栏里面」）
        //   → 炮击的每一发都并进下面的招式表（动作值栏写炮击动作值 + 固伤标注）；
        //     结果卡里仍然单列一条炮击系汇总（那是用户更早要求的口径，保留）
        // 狂龙衣装加段：并进本招，但单独标出来（用户拍板：加段归到原招式里，不单独成招）
        // 加段是表内的独立 hit 行 —— 动作值 / 属补 / 自定义耗斩都是它自己的，这里一并显示出来
        const mantleHits = blade.filter((h) => h.mantle);
        if (mantleHits.length) {
          const mmv = mantleHits.reduce((a, h) => a + (Number(h.mv) || 0), 0);
          const mer = mantleHits.reduce((a, h) => a + (Number(h.elemRate) || 0), 0) / mantleHits.length;
          const msh = mantleHits.reduce((a, h) => a + (Number(h.sharpCost) || 0), 0);
          tags.push('狂龙衣加段 ' + mantleHits.length + ' hit（动作值 ' + rd2(mmv)
            + ' · 属补 ' + rd2(mer) + ' · 耗斩 ' + rd2(msh / 10) + '刀）');
        }
        // 命中伤口/绽伤时的追加 hit（大锤集中殴打）：选中「伤口」肉质时自动并入，标出来
        const woundHits = blade.filter((h) => h.wound);
        if (woundHits.length) {
          tags.push('伤口追加 ' + woundHits.length + ' hit（动作值 '
            + rd2(woundHits.reduce((a, h) => a + (Number(h.mv) || 0), 0)) + '）');
        }
        // 集中处决「爆伤口」（用户 2026-10-08）：命中伤口后按处数造成的额外伤害（计入总伤害，单列标注）
        const bursts = g.hits.filter((h) => h.woundBurst);
        if (bursts.length) {
          const braw = bursts.reduce((a, h) => a + h.raw, 0);
          tags.push('爆伤口 ' + bursts[0].woundCount + ' 处 ×' + bursts[0].woundCoeff
            + '（Scar Raw ' + Number(bursts[0].woundScarRaw).toFixed(2) + '）'
            + (bursts[0].woundLegendaryMul > 1 ? ' ×历战 ' + bursts[0].woundLegendaryMul : '')
            + '· 伤害 ' + rd2(braw));
        }
        // 圈数（大锤回旋攻击/追击回旋敲打）：把用户选的圈数标出来
        const spinHit = blade.find((h) => h.spin != null);
        if (spinHit) tags.push(spinHit.spin + ' 圈');
        const tagStr = tags.length ? `<i class="calc-hit-tags">${tags.join(' · ')}</i>` : '';
        // 可自选 hit 数 / 轮数的招式：把用户选的量标出来
        //   双刀回天突刺是「轮数」模型 → 标成「2 轮（6 刀）」；其余（飞天螺旋斩）标成「7/9 hit」
        const hl = blade.length ? (blade[0].loopRounds != null ? blade[0].loopRounds : blade[0].hitLimit) : null;
        const hmax = blade.length ? blade[0].hitMax : null;
        const hunit = blade.length ? blade[0].hitUnit : null;
        let bladeLabel;
        if (hunit && hl != null) bladeLabel = hl + ' ' + hunit + '（' + blade.length + ' 刀）';
        else if (hl != null && hmax != null && hl < hmax) bladeLabel = hl + '/' + hmax + ' hit';
        else bladeLabel = blade.length + ' hit';
        const hitsLabel = `${bladeLabel}${insects.length ? ' + 猎虫 ' + insects.length + ' hit' : ''}`
          + (shells.length ? ` + 炮击系 ${shells.length} hit` : '');

        // 列随面板类型裁剪：无属性 → 不显示属补/属性列；无异常 → 不显示异常列
        let head = '<th>#</th><th>动作值</th>';
        if (hasElem) head += '<th>属补</th>';
        head += '<th>物理</th>';
        if (hasElem) head += '<th>属性</th>';
        if (hasStatus) head += '<th>异常</th>';
        head += '<th>晕厥</th>';
        let body = `<table class="calc-subtable"><thead><tr>${head}</tr></thead><tbody>`;
        // 双刀：逐刀按刀分行，并标出这一刀是右手还是左手（表内 R/L 判定，生成期已守卫）
        const hasHand = blade.some((h) => h.hand === 'R' || h.hand === 'L');
        blade.forEach((h, hi) => {
          // 动作值：大字 = 实际生效值（含蓄力/舞踏/飞燕）；与表内原始值不同时小字标出原始值
          // 耗斩：表内逐 hit 的「自定义耗斩」（10 = 面板 1 刀）；不是 10 的 hit（如狂龙衣加段、上捞类）单独标出来
          const effMv = h.effectiveMv != null ? h.effectiveMv : h.mv;
          const mvChanged = Math.abs(effMv - (Number(h.mv) || 0)) > 0.005;
          const sharpNote = (!h.phial && !h.noSharp && h.sharpCost != null && h.sharpCost !== 10)
            ? `<i class="calc-mv-after">耗斩 ${Math.round(h.sharpCost) / 10}刀</i>` : '';
          // 飞燕：**勾了技能才亮标** —— 让这一刀的动作值自身发绿，不写多余的字
          const hienOn = h.hien && airMult !== 1;
          // 高速变形：换了形态的招式，勾了技能才亮标（同样只变色，不加字）
          const morphOn = !!h.morph;
          // 被「打断上一个蓄力斩」取消的刀：整刀归零，动作值与伤害都显示 0 + 「已取消」标注
          const cancelled = !!h.cancelled;
          // 长枪力防：这一刀吃了力量格挡的力防加成 → 标出实际倍率（数值本身已是大字生效值）
          const forceNote = (h.forceGuard && !cancelled ? `<i class="calc-mv-after calc-mv-force">力防 ×${h.forceGuardMul}</i>` : '');
          // 瓶爆：榴弹瓶有瓶动作值（写表内数值 + 小字固伤）；强属性瓶**没有动作值**（走属补 × 属性肉质）
          //   → 动作值栏留「—」，属补在右边的属补列里看
          const hm = h.phial
            ? (h.phialKind === 'element'
              ? `<b class="calc-mv-raw">—</b>`
              : `<b class="calc-mv-raw">${rd2(h.phialMv)}</b><i class="calc-mv-after">固伤</i>`)
            : `<b class="calc-mv-raw${hienOn ? ' calc-mv-hien' : ''}${morphOn ? ' calc-mv-morph' : ''}">${rd2(effMv)}</b>`
              + (mvChanged ? `<i class="calc-mv-after">表内 ${h.mv}${h.tickDecay != null ? ' ×' + (Math.round(h.tickDecay * 1000) / 1000) : ''}</i>` : '')
              + sharpNote
              + forceNote;
          body += `<tr${cancelled ? ' class="calc-row-cancelled"' : ''}><td class="num">${hi + 1}</td>`
            + `<td class="num${hienOn ? ' calc-hien-cell' : ''}${morphOn ? ' calc-morph-cell' : ''}">${hm}`
            + (hasHand ? `<i class="calc-hand-tag calc-hand-${h.hand === 'R' ? 'r' : 'l'}">${h.hand === 'R' ? '右手' : '左手'}</i>` : '')
            + (cancelled ? `<i class="calc-mv-cancelled">已取消（被打断）</i>` : '') + '</td>'
            + (hasElem ? `<td class="num">${h.elemRate}</td>` : '')
            + `<td class="num">${h.raw.toFixed(2)}</td>`
            + (hasElem ? `<td class="num">${h.element.toFixed(2)}</td>` : '')
            + (hasStatus ? `<td class="num">${h.status.toFixed(2)}</td>` : '')
            + `<td class="num">${h.stun.toFixed(2)}</td>`
            + '</tr>';
        });
        // 铳枪炮击系：写进**招式行**的动作值栏（用户 2026-10-01：炮击的伤害不要小字显示，显示在招式栏里）
        //   —— 每发一行：动作值栏写炮击动作值 + 「固伤」标注，物理列写固伤伤害、属性列写附带属性
        shells.forEach((h, si) => {
          const per = Number(h.shellCount) || 1;
          const one = per > 1 ? (h.raw / per) : h.raw;
          const oneElem = per > 1 ? (h.element / per) : h.element;
          const fireOne = Number(h.shellFire) || 0;
          const CN = { shot: '炮击', chargeShot: '蓄力炮', fullBurst: '全弹', wyvernfire: '龙击炮', wyrmstake: '龙杭爆炸', wyrmstakeSpark: '龙杭火花' };
          // 单位口径：火花按「段」、其余按「发」（命中与消耗各用其词）
          const unit = h.shellMove === 'wyrmstakeSpark' ? ' 段' : ' 发';
          body += `<tr class="calc-row-shell"><td class="num">${blade.length + si + 1}</td>`
            + `<td class="num"><b class="calc-mv-raw">${rd2(h.shellMv)}</b>`
            + `<i class="calc-mv-after">${CN[h.shellMove] || '炮击'}固伤${per > 1 ? ' × ' + per + unit : ''}`
            + `${fireOne ? ' · 附带火 ' + rd2(fireOne) : ''}</i></td>`
            + (hasElem ? `<td class="num">—</td>` : '')
            + `<td class="num">${one.toFixed(2)}</td>`
            + (hasElem ? `<td class="num">${oneElem.toFixed(2)}</td>` : '')
            + (hasStatus ? '<td class="num">—</td>' : '')
            + `<td class="num">—</td>`
            + '</tr>';
        });
        body += '</tbody></table>';

        html += `<div class="calc-hit-group">
          <button type="button" class="calc-hit-head" data-hit-group="${gi}">
            <span class="calc-hit-name">${g.moveName}${prevEdge ? '<i class="calc-branch-tag">' + prevEdge + '</i>' : ''}${tagStr}<em>${hitsLabel}</em></span>
            <span class="calc-hit-nums">总伤害 <b>${(contribution?.damage??sum.raw+sum.element).toFixed(2)}</b> · 占比 <b>${(contribution?.share??0).toFixed(2)}%</b><br>物理 <b>${(contribution?.physical??sum.raw).toFixed(2)}</b> · 属性 <b>${(contribution?.element??sum.element).toFixed(2)}</b> · 固伤 <b>${(contribution?.fixed??0).toFixed(2)}</b></span>
            <span class="calc-hit-caret">▸</span>
          </button>
          <div class="calc-hit-body" data-hit-body="${gi}" hidden>${insectTag}${soundTag}${body}</div>
        </div>`;
      });
      tbl.innerHTML = html;

      tbl.querySelectorAll('[data-hit-group]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const body = tbl.querySelector('[data-hit-body="' + btn.dataset.hitGroup + '"]');
          if (!body) return;
          body.hidden = !body.hidden;
          btn.classList.toggle('open', !body.hidden);
        });
      });
    }

    function recalc() {
      const meat = currentMeat();
      const isIG = state.weaponId === 'insect_glaive';   // 三灯/猎虫/舞踏都是操虫棍独有
      const isCB = state.weaponId === 'charge_blade';    // 盾斧：剑/斧形态 + 瓶爆 + 电锯
      const isHH = state.weaponId === 'hunting_horn';    // 狩猎笛：响玉数量 + 音波/响玉共鸣
      const isDB = state.weaponId === 'dual_blades';     // 双刀：蓝鬼（鬼人闪身）
      const isGL = state.weaponId === 'gunlance';        // 铳枪：炮击类型/等级 + 炮击系
      const skillsSelected = Object.keys(state.skillLevels)
        .filter((id) => state.skillLevels[id] > 0)
        .map((id) => {
          const sk = skills.find((s) => s.id === id);
          const item = { skill: sk, level: state.skillLevels[id] };
          // 覆盖率（防具/套装技能 + 心眼）：以期望值折算进面板数值，默认 100%
          if (sk && sk.coverage) item.coverage = skillCoverage(id);
          return item;
        });
      const r = window.MHCalculator.calculateCombo({
        moves: currentMoves(),
        weaponId: state.weaponId,
        weaponGroups,
        danceMultiplier, chargeMultiplier,
        lamp: isIG ? lamp : null,       // 三灯攻击倍率与随灯态变化的招式（操虫棍独有）
        kinsect: {                      // 猎虫（共斗虫）：虫种 + 等级 → 威力倍率（操虫棍独有）
          kinsect: isIG ? (kinsects.find((k) => k.id === state.kinsectId) || null) : null,
          level: state.kinsectLevel,
          powerTable: kinsectPowerTable
        },
        skills: skillsSelected,
        items: currentItems(),          // 道具/餐点
        attack: state.attack, element: state.element, elementType: state.elementType,
        status: state.status, statusType: state.statusType, affinity: state.affinity,
        sharpness: sharpness[state.sharpness] || { raw: 1, element: 1 },
        sharpGreen: sharpness.green || null,   // 狩猎笛响周波：斩味固定绿斩（用户拍板）
        hitzones: meat,
        isHead: currentIsHead(),        // 只有头部累计晕厥
        // 怪物发怒受击倍率（用户 2026-10-08）：数据库 AngryTable.PlDamage —— 作用最终伤害
        enrageMul: currentEnrageMul(),
        // 任务Difficulty._ScarRaw × 人数倍率；历战伤口加成用独立标记。
        scarRaw: scarRawOf().raw,
        scarLegendary: scarRawOf().legendary,
        mode: state.mode,
        combo: state.combo,
        mantle: !!state.mantle,         // 狂龙衣装：开启后把衣装的加段并入对应招式
        // 盾斧：瓶种 / 瓶状态 / 红盾 / 红剑（开局就选；其他武器一律不吃）
        cb: isCB ? {
          phial: state.cbPhial, reinforced: !!state.cbReinforced,
          redShield: !!state.cbRedShield, redSword: !!state.cbRedSword
        } : null,
        // 斩击斧（用户 2026-10-06 拍板）：开刃 / 瓶种（强击瓶·强属性瓶）/ 红斧 —— 武器级开关
        swax: state.weaponId === 'switch_axe' ? {
          awakened: !!state.swaxAwakened,
          phial: state.swaxPhial,
          redAxe: !!state.swaxRedAxe
        } : null,
        phialTable: (CALC.cbPhials || null),
        // 狩猎笛：响玉数量（0~3，默认 0）+ 响玉共鸣表（平A / 演奏）
        balladCount: isHH ? state.balladCount : 0,
        balladTable: (CALC.hornBallads || null),
        // 双刀：蓝鬼（鬼人闪身）—— 只有双刀会生效（引擎侧按 weaponId 硬拦截，其他武器传了也忽略）
        blueDemon: isDB
          ? { on: !!state.blueDemon, attackBaseMul: blueDemonCfg.attackBaseMul, elementBaseAdd: blueDemonCfg.elementBaseAdd }
          : null,
        // 铳枪：炮击类型 / 等级 + 炮击表（同样只在铳枪生效）
        gunlance: isGL ? { type: state.glType, level: state.glLevel } : null,
        shellTable: isGL ? GL_SHELL : null,
        // 旋律（所有武器都有，可多选；自我强化按数据层 weapons 过滤，非笛子不会出现）
        melodies: (CALC.melodies || []).filter((m) => state.melodyIds.indexOf(m.id) >= 0),
        context: {
          monsterEnraged: state.monsterEnraged,
          fullHealth: state.fullHealth,
          wound: currentIsWound(),   // 自动：选中「伤口」肉质状态时应用伤口相关技能
          overcomeFrenzy: state.overcomeFrenzy,
          clash: state.clash,            // 角力/抵消成功（辟兽之力、冻峰龙之反叛）
          ateMeat: state.ateMeat,        // 食用烤熟的肉等道具（暗器蛸之力）
          apexSoulReady:state.apexSoulReady,encouragement:state.encouragement,ailment:state.ailment,
          dodgeEvade: state.dodgeEvade,  // 巧击发动中回避成功（千刃龙的斗志）
          festival: state.festival,      // 祭典期间（大地之恩惠）
          warCry: state.warCry,          // 肢体动作「咆哮」后（雪狮子王之斗志）
          absorbHits: state.absorbHits,
          threeLamp: isIG ? state.threeLamp : false   // 操虫棍：是否三灯（其他武器强制关闭）
        }
      });
      // 长枪力防：把引擎算出的「哪一招吃到了力防加成」记下来，连段行与逐刀表都按它标注
      state.forceGuardUsed = r.forceGuardUsed || [];
      renderResults(r);
      renderPanel(r.panel, r.skillNotes);
      renderComboSum(r);
      // 蓝鬼等效值提示（开了才写「A → B」，关了回到倍率说明）
      if (isDB) updateBlueDemonNote();
      // 舞踏为自动派生：打完几次跳跃突进斩就是几层（操虫棍独有）
      const dn = el.querySelector('#calc-dance-note');
      if (dn) dn.textContent = (isIG && r.danceStacks > 0) ? `舞踏 ${r.danceStacks} 层（自动）` : '';
    }

    // 连段汇总：总动作值（含飞燕/蓄力/舞踏；舞踏只作用物理）/ 总属补 / 总异常补 / 耗斩；猎虫 hit 单列
    function renderComboSum(r) {
      const box = el.querySelector('#calc-combo-sum');
      if (!box) return;
      if (!r.hits.length) { box.innerHTML = ''; return; }
      const rd = rd2;
      // 猎虫 hit 与棍子不同源（动作值/耗斩/属补都不并入棍子口径），伤害已计入总伤害故单列展示
      // 狩猎笛音波/响玉共鸣同理（固伤，单列展示）
      const blade = r.hits.filter((h) => !h.kinsect && !h.hornSound);
      const insect = r.insect || { hits: 0, mv: 0, elemRate: 0 };
      const sound = r.sound || { hits: 0, mv: 0, damage: 0, raw: 0, element: 0 };
      const er = blade.reduce((a, h) => a + (h.elemRate || 0), 0);
      const sr = blade.reduce((a, h) => a + (h.statusRate || 0), 0);
      const hienHits = blade.filter((h) => h.hien).length;
      // 不耗斩味的 hit（表列58）：只写「不耗斩味」；「且不吃斩味补正」只在全部都不吃斩补时才写（列59 区分）
      const noSharpBlade = blade.filter((h) => h.noSharp && !h.phial);
      const noSharpHits = noSharpBlade.length;
      const noSharpNoBonus = noSharpBlade.filter((h) => !h.forceSharp).length;
      const airMult = r.state && r.state.airborneMult ? r.state.airborneMult : 1;
      const knives = r.sharpKnives != null ? r.sharpKnives : blade.reduce((a, h) => a + (h.sharpCost || 0), 0) / 10;
      // 动作值：大字 = 实际生效值（含蓄力/舞踏/飞燕）；与表内原始值不同时用小字标出原始值
      // （用户拍板：界面显示值必须等于实际生效值 —— 操虫棍 0蓄/1蓄 以前显示的都是 2蓄 的表内值）
      const mvRaw = r.totalMv != null ? r.totalMv : blade.reduce((a, h) => a + (Number(h.mv) || 0), 0);
      const mvEff = r.totalMvEffective != null ? r.totalMvEffective
        : blade.reduce((a, h) => a + (h.effectiveMv || 0), 0);
      const mvDiffers = Math.abs(mvEff - mvRaw) > 0.005;
      // 面板选「无」属性/「无」异常 → 不显示属补/异常补（没有该属性就没有这项）
      const hasElem = !r.noElement;
      const hasStatus = !r.noStatus;
      box.innerHTML = `<span class="calc-combo-sum-mv">总动作值 <b${hienHits && airMult !== 1 ? ' class="calc-mv-hien"' : ''}>${rd(mvEff)}</b>`
        + (mvDiffers ? `<i class="calc-mv-eff">表内原始 ${rd(mvRaw)}</i>` : '')
        + `</span>`
        + (hasElem ? `<span>总属补 <b>${rd(er)}</b></span>` : '')
        + (hasStatus ? `<span>总异常补 <b>${rd(sr)}</b></span>` : '')
        + `<span>${blade.length} hit</span>`
        + `<span class="calc-combo-sum-sharp">耗斩 <b>${rd(knives)}</b> 刀</span>`
        // 飞燕：勾了技能才亮标（只一个词）；选了技能但这段连段吃不到，才给一句提示
        + (hienHits && airMult !== 1 ? `<span class="calc-combo-sum-hien">飞燕</span>` : '')
        + (noSharpHits ? `<span class="calc-combo-sum-note">其中 ${noSharpHits} hit 不耗斩味` + (noSharpNoBonus === noSharpHits ? '且不吃斩味补正' : '') + '</span>' : '')
        // 猎虫：动作值与伤害单独列出（伤害已计入总伤害，但不进棍子的动作值/耗斩）
        + (insect.hits
          ? `<span class="calc-combo-sum-insect">猎虫 ${insect.hits} hit · 动作值 <b>${rd(insect.mv)}</b>`
            + ` · 伤害 <b>${rd(insect.damage)}</b>`
            + (hasElem ? `（物理 ${rd(insect.raw)} / 属性 ${rd(insect.element)}）` : '')
            + (insect.kinsectName ? `　<i class="calc-panel-note">${insect.kinsectName} Lv${insect.kinsectLevel} · 威力×${rd(insect.powerMult)}</i>` : '')
            + '</span>'
          : '')
        // 狩猎笛音波 / 响玉共鸣：固伤单列（伤害已计入总伤害，动作值不并入武器合计）
        + (sound.hits
          ? `<span class="calc-combo-sum-insect">音波/响玉 ${sound.hits} hit · 动作值 <b>${rd(sound.mv)}</b>`
            + ` · 伤害 <b>${rd(sound.damage)}</b>`
            + (hasElem ? `（物理 ${rd(sound.raw)} / 属性 ${rd(sound.element)}）` : '')
            + (sound.stun > 0 ? ` · 晕厥 <b>${rd(sound.stun)}</b>` : '')
            + '</span>'
          : '')
        // 铳枪炮击系：单列（伤害已计入总伤害；火花吃肉质/会心、附带属性吃属性吸收，都不吃斩味，动作值不并入武器合计）
        + (r.shelling && r.shelling.hits
          ? `<span class="calc-combo-sum-insect calc-combo-sum-shell">炮击系 ${r.shelling.hits} hit · 动作值 <b>${rd(r.shelling.mv)}</b>`
            + ` · 固伤 <b>${rd(r.shelling.raw)}</b>`
            + (r.shelling.element ? ` · 属性 <b>${rd(r.shelling.element)}</b>` : '')
            + (r.shelling.fire ? ` · 表内附带火属性 ${rd(r.shelling.fire)}` : '')
            + `　<i class="calc-panel-note">${(GL_TYPE_CN[r.shelling.type] || r.shelling.type)} ${GL_LEVEL_LABEL(r.shelling.level)}`
            + ` · 系数 ${rd(r.shelling.coefficient)}（基础攻击力×${r.shelling.artyMul}+${r.shelling.artyAdd}）</i>`
            + '</span>'
          : '')
        // 双刀蓝鬼：等效值单列（写出倍率后的数值，不只标倍率）
        + (r.blueDemon && r.blueDemon.enabled
          ? `<span class="calc-combo-sum-note calc-bluedemon-sum">蓝鬼：基础攻击力 <b>${rd(r.blueDemon.baseAttackBefore)}</b> → <b>${rd(r.blueDemon.baseAttackAfter)}</b>`
            + `（×${r.blueDemon.attackBaseMul}）`
            + (r.blueDemon.elementBase > 0
              ? ` · 属性 <b>${rd(r.blueDemon.elementBase)}</b> → <b>${rd(r.blueDemon.elementAfter)}</b>` : '')
            + '</span>'
          : '')
        + (airMult !== 1 && !hienHits && blade.length
          ? `<span class="calc-combo-sum-note">飞燕未生效</span>` : '')
        + `<span class="calc-combo-sum-note">耗斩的「刀」= 武器面板 1 斩味（历代 1 刀）</span>`;
    }

    // 连段列表渲染
    function renderCombo() {
      const list = el.querySelector('#calc-combo-list');
      list.innerHTML = '';
      state.combo.forEach((item, i) => {
        const move = moveOf(item.moveId);
        const prevForCharge = i > 0 ? state.combo[i - 1] : null;
        const forcedChargeRule = state.deriveMode && prevForCharge && move && (move.entryChargeRules || []).find(r =>
          r.ids.includes(prevForCharge.moveId) && (r.completion == null || r.completion === prevForCharge.completion));
        if (forcedChargeRule) item.charge = forcedChargeRule.charge;
        const row = document.createElement('div');
        row.className = 'calc-combo-item';
        const name = document.createElement('span');
        name.className = 'calc-move-name';
        // 吃飞燕的招式在连段里直接标出来（部分吃飞燕的显示 x/y hit）
        // 铳枪「加速」：这一招是经由上一条边（branchTags）派生出来的 → 连段行里也标出来（用户 2026-10-01）
        const prevMove = i > 0 ? moveOf(state.combo[i - 1].moveId) : null;
        const edgeLabel = (prevMove && prevMove.branchTags && move) ? prevMove.branchTags[move.id] : null;
        name.innerHTML = `${i + 1}. ${levelNameOf(move, item) || (move ? move.name : item.moveId)}`
          + (edgeLabel ? '<i class="calc-branch-tag">' + edgeLabel + '</i>' : '')
          + (move ? hienTag(move) : '')
          + (morphSkillOn() && morphChangesAt(i) ? '<i class="calc-morph-tag">高速变形</i>' : '')
          // 长枪力防：紧接在力量格挡之后的那一招 → 标出实际生效的倍率与前几 hit（显示值 = 生效值）
          + forceGuardTagAt(i);
        row.appendChild(name);
        if (state.weaponId === 'dual_blades' && move && move.dbModes) {
          item.dbMode = dbModeOf(item, move);
          if (move.id === 'db_up') item.charge = item.dbMode === 'demon' ? 2 : 1;
          if (move.dbModes.length > 1) {
            const label = document.createElement('label'); label.className = 'calc-field calc-field-inline';
            const select = document.createElement('select'); select.className = 'calc-db-mode';
            move.dbModes.forEach(mode => { const option = document.createElement('option'); option.value = mode; option.textContent = DB_MODE_NAMES[mode]; select.appendChild(option); });
            select.value = item.dbMode;
            select.addEventListener('change', () => { item.dbMode = select.value; refreshComboUI(); });
            label.appendChild(select); row.appendChild(label);
          }
        }
        // 档位招式（大剑蓄力斩 0~3 蓄 / 大锤跳跃蓄力攻击 1~3 蓄 / 狩猎笛响周波 1~3 级）：
        // 表内逐档的实测动作值 → 分段按钮选档位，档位名用表内的说法（蓄 / 级）
        const lvs = move ? levelsOf(move) : null;
        if (lvs && !(state.weaponId === 'dual_blades' && move.id === 'db_up')) {
          const unit = levelUnitOf(move);
          const cur = chargeOf(item, move);
          const seg = document.createElement('div');
          seg.className = 'seg-group';
          lvs.forEach((l) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'seg-btn' + (cur === l.level ? ' active' : '');
            // 档位按钮文字：数据层给了 label 就用 label（双刀上捞斩 = 普通 / 鬼人），
            //   没给 label 的旧招式行为完全不变（仍是「1蓄 / 2档 / 3级」）
            b.textContent = l.label || (l.level + unit);
            if (forcedChargeRule && l.level !== forcedChargeRule.charge) b.disabled = true;
            b.addEventListener('click', () => {
              state.combo[i].charge = l.level;
              refreshComboUI();
            });
            seg.appendChild(b);
          });
          row.appendChild(seg);
        } else if (move && move.chargeable) {
          // 蓄力等级：分段按钮（比原生下拉直观、也更贴合深色主题）
          const seg = document.createElement('div');
          seg.className = 'seg-group';
          [0, 1, 2].forEach((c) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'seg-btn' + (item.charge === c ? ' active' : '');
            b.textContent = c + '蓄';
            b.addEventListener('click', () => {
              state.combo[i].charge = c;
              seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
              b.classList.add('active');
              refreshComboUI();
            });
            seg.appendChild(b);
          });
          row.appendChild(seg);
        } else if (move && move.inheritCharge) {
          // 飞天螺旋斩：蓄力等级继承派生它的强化急袭斩，不可自选
          const tag = document.createElement('span');
          tag.className = 'calc-tag';
          tag.textContent = '蓄力继承前招';
          row.appendChild(tag);
        }
        if (move && move.hitSelect && (!move.hitSelect.requiresWound || (!(move.bloomOption && item.bloom) && (move.woundOption ? !!item.wound : currentIsWound())))) {
          // 可自选段数 / 轮数（操虫棍飞天螺旋斩 = hit 数；双刀回天突刺 = 轮数，unit「轮」）
          // 铳枪集中龙杭突刺（用户 2026-10-01）：勾「命中伤口」后段数范围随档换（1~7 → 7~13），
          //   与引擎同一套覆盖口径（woundHitSelect 覆盖 hitSelect），并把当前值钳进新范围
          const hs = (item.wound && move.woundHitSelect)
            ? Object.assign({}, move.hitSelect, move.woundHitSelect)
            : move.hitSelect;
          const cur = Math.min(Math.max(Number(item.hits != null ? item.hits : hs['default']) || hs['default'], hs.min), hs.max);
          const unit = hs.unit || 'hit';
          const sel = document.createElement('select');
          sel.className = 'calc-native-select calc-hitselect';
          for (let v = hs.min; v <= hs.max; v++) {
            const o = document.createElement('option');
            o.value = String(v);
            o.textContent = v + ' ' + unit;
            if (v === cur) o.selected = true;
            sel.appendChild(o);
          }
          sel.value = String(cur);
          sel.addEventListener('change', () => {
            state.combo[i].hits = Number(sel.value) || hs['default'];
            refreshComboUI();
          });
          row.appendChild(sel);
          // 用户 2026-10-07：选择器不挂任何说明文字
          enhanceSelect(sel, '');
        }
        // 圈数可自选的招式（大锤 回旋攻击 / 追击回旋敲打）：自绘选择器
        if (move && move.spin) {
          const sp = move.spin;
          const cur = item.spin != null ? item.spin : sp['default'];
          const sel = document.createElement('select');
          sel.className = 'calc-native-select calc-hitselect';
          for (let v = sp.min; v <= sp.max; v++) {
            const o = document.createElement('option');
            o.value = String(v);
            o.textContent = v + ' 圈';
            if (v === cur) o.selected = true;
            sel.appendChild(o);
          }
          sel.value = String(cur);
          sel.addEventListener('change', () => {
            state.combo[i].spin = Number(sel.value) || sp['default'];
            refreshComboUI();
          });
          row.appendChild(sel);
          enhanceSelect(sel, move.name + ' · ' + (sp.label || '圈数'));
        }
        // ===== 招式选项（数据驱动 + 通用渲染：新增同类变体只需在下面加一条描述，不复制渲染逻辑）=====
        //   每条 = { key: 数据层字段名, has(move): 这一招有没有该选项, render(...) }
        //   已接入：大锤/盾斧集中二连斩「命中伤口」、盾斧电锯跳数 / 瓶爆次数 / 打完、
        //          大剑冲撞攻击「打断上一个蓄力斩」
        const cbSel = (unit, min, max, cur, def, field, tip) => {
          const sel = document.createElement('select');
          sel.className = 'calc-native-select calc-hitselect';
          for (let v = min; v <= max; v++) {
            const o = document.createElement('option');
            o.value = String(v);
            o.textContent = v + ' ' + unit;
            if (v === cur) o.selected = true;
            sel.appendChild(o);
          }
          sel.value = String(cur);
          sel.addEventListener('change', () => { state.combo[i][field] = Number(sel.value); refreshComboUI(); });
          row.appendChild(sel);
          enhanceSelect(sel, tip || (move.name + ' · ' + unit));
        };
        // 斩击斧集中处决：变化点自选（用户 2026-10-06 拍板）—— 形态可在倒数两招或最后一招改变，
        //   含「变过去再变回来」；沿用既有原生下拉渲染路径（与连打/圈数选择器同一控件模式，不另建一套）
        const cbPick = (opts, cur, field, tip) => {
          const sel = document.createElement('select');
          sel.className = 'calc-native-select calc-hitselect';
          (opts || []).forEach((o, idx) => {
            const el = document.createElement('option');
            el.value = String(o.value ?? idx);
            el.textContent = o.label;
            if ((o.value ?? idx) === cur) el.selected = true;
            sel.appendChild(el);
          });
          sel.value = String(cur);
          sel.addEventListener('change', () => { state.combo[i][field==='soundCountPick'?'soundCount':field] = Number(sel.value)+(field==='soundCountPick'?1:0); refreshComboUI(); });
          row.appendChild(sel);
          enhanceSelect(sel, tip);
        };
        const cbCheck = (opt, cur, field, title) => {
          const lab = document.createElement('label');
          lab.className = 'calc-check calc-inline-check';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!cur;
          cb.addEventListener('change', () => {
            state.combo[i][field] = cb.checked;
            if (field === 'wound' && (move.sequenceOptions || move.chargeLevels?.some(lv=>lv.sequenceOptions))) {
              state.combo[i].sequence = 0;
              delete state.combo[i].hits;
            }
            if (cb.checked && move.bloomOption) {
              if (field === 'bloom') state.combo[i].wound = false;
              if (field === 'wound') state.combo[i].bloom = false;
            }
            refreshComboUI();
          });
          const sp = document.createElement('span');
          sp.textContent = opt.label;
          if (title) lab.title = title;
          lab.appendChild(cb);
          lab.appendChild(sp);
          row.appendChild(lab);
        };
        const MOVE_OPTION_RENDERERS = [
          {key:'ranged',has:m=>!!(m.rangedVariants||m.rangedStages),render:()=>{
            item.rangedWholeVersion=1;
            if(move.rangedVariants){
              const choices=state.deriveMode?window.MHCalculator.rangedVariantChoices(state.weaponId,currentMoves(),state.combo.slice(0,i),move.id):move.rangedVariants.map((_,j)=>j);
              if(choices.length&&!choices.includes(item.rangedVariant??0))item.rangedVariant=choices[0];
              const opts=move.rangedVariants.map((v,j)=>({label:v.label,value:j})).filter(v=>!state.deriveMode||choices.includes(v.value));
              if(opts.length>1)cbPick(opts,item.rangedVariant??0,'rangedVariant',move.name+' · 类型');
            }
            const v=move.rangedVariants?.[item.rangedVariant??0]||move;
            for(const [model,field]of [[v.rangedStages,'rangedHits'],[item.wound&&v.rangedFollow,'rangedFollowHits'],[v.rangedExtra,'rangedExtraHits']])if(model){
              item[field]=Math.min(Math.max(item[field]??model.default,model.min),model.max);
              cbSel(model.label,model.min,model.max,item[field],model.default,field);
            }
          }},
          { key:'sequence', has:m=>!!(m.sequenceOptions || m.chargeLevels?.some(lv=>lv.sequenceOptions)), render:()=>{
            const opts=(move.chargeLevels?.[chargeOf(item,move)]?.sequenceOptions || move.sequenceOptions)[item.wound?'wound':'none'];
            const index=Math.min(Math.max(Number(item.sequence)||0,0),opts.length-1);
            item.sequence=index;
            if(opts.length>1)cbPick(opts,index,'sequence',move.name+' · 命中方式');
            const hs=opts[index].hitSelect;
            if(hs)cbSel(hs.unit||'hit',hs.min,hs.max,Math.min(Math.max(item.hits??hs.default,hs.min),hs.max),hs.default,'hits');
          } },
          { key:'recovery',has:m=>!!m.recoveryOption,render:()=>cbPick(move.recoveryOption.variants,item.recovery??move.recoveryOption.default,'recovery',move.name+' · 收招') },
          { key:'sound',has:m=>!!m.soundOption,render:()=>{
            if (!Number.isInteger(item.sound) || !move.soundOption.variants[item.sound]) item.sound=move.soundOption.default;
            cbPick(move.soundOption.variants,item.sound,'sound',move.name+' · 旋律');
          } },
          {key:'soundCount',has:m=>!!m.soundCountOption,render:()=>{
            if(item.sound===1)return;
            const o=move.soundCountOption;cbPick(Array.from({length:o.max-o.min+1},(_,j)=>({label:String(j+o.min)})),(item.soundCount??o.default)-o.min,'soundCountPick',o.label);
          }},
          {key:'precise',has:m=>!!m.preciseOption,render:()=>cbCheck(move.preciseOption,item.precise!==false,'precise')},
          { key: 'counter', has: (m) => !!m.counterOption,
            render: () => cbCheck(move.counterOption, !!item.counter, 'counter') },
          { key: 'completion', has: (m) => !!m.completionOption,
            render: () => cbPick(move.completionOption.variants,
              item.completion == null ? move.completionOption.default : item.completion,
              'completion', move.name + ' · 完成段数') },
          { key: 'bloom', has: (m) => !!m.bloomOption,
            render: () => cbCheck(move.bloomOption, !!item.bloom, 'bloom') },
          // 长枪力防：力量格挡的「力防层数」0/1/2/3（默认 3）—— 只影响紧接其后派生出的那一招的前 3 hit
          { key: 'forceGuard', has: (m) => !!m.forceGuardBuff,
            render: () => {
              const fgb = move.forceGuardBuff;
              const lv = forceGuardLevelOf(item, move);
              cbSel('层', Number(fgb.min || 0), Number(fgb.max || 3), lv, Number(fgb['default'] || 0), 'forceGuard', '力量格挡 · 层数');
            } },
          { key: 'saw', has: (m) => !!m.sawOption,
            render: () => cbSel('跳电锯', move.sawOption.min, move.sawOption.max,
              item.saw != null ? item.saw : move.sawOption['default'], move.sawOption['default'], 'saw') },
          { key: 'phial', has: (m) => !!m.phialOption,
            render: () => cbSel('次瓶爆', move.phialOption.min, move.phialOption.max,
              item.phial != null ? item.phial : move.phialOption['default'], move.phialOption['default'], 'phial') },
          { key: 'shells', has: (m) => !!m.shellCountOption,
            render: () => {
              // 发炮数（用户 2026-10-01）：上限 = 当前炮击类型的装填数 + 增弹；默认满装填
              const option = move.shellCountOption;
              const max = option.max != null ? option.max : glShellCapMax();
              const def = typeof option.default === 'number' ? option.default : max;
              const cur = Math.min(Math.max(Number(item.shells != null ? item.shells : def) || def, 1), max);
              cbSel('发', 1, max, cur, def, 'shells', move.name + ' · 发炮数');
            } },
          { key: 'wound', has: (m) => !!m.woundOption || !!m.woundBurst,
            render: () => {
              // 带「命中伤口」选项的招（勾选驱动）／没有选项的集中招（靠「肉质状态 = 伤口」自动驱动）
              if (move.woundOption) cbCheck({ label: move.woundOption.label || '命中伤口' }, !!item.wound, 'wound');
              const burstOn = !(move.bloomOption && item.bloom) && (move.woundOption ? !!item.wound : currentIsWound());
              const sc = scarRawOf();
              const legendary = typeof item.woundLegendary === 'boolean' ? item.woundLegendary : sc.legendary;
              if (burstOn && move.woundBurst) cbCheck({ label: '历战伤口' }, legendary, 'woundLegendary', '普通伤口不勾选；历战伤口爆伤口伤害 ×1.3');
              // 命中伤口数（用户 2026-10-08）：1~3 处（默认 1）
              //   爆伤口伤害 = 伤口系数（1 处 30 / 2 处 50 / 3 处 80）× 表内 Scar Raw × 破坏王
              if (burstOn && move.woundCountOption) {
                const wo = move.woundCountOption;
                const cur = Math.min(Math.max(Number(item.woundCount != null ? item.woundCount : wo['default']) || 1, wo.min), wo.max);
                cbSel(wo.unit || '处', wo.min, wo.max, cur, wo['default'], 'woundCount', move.name + ' · 命中伤口数');
              }
            } },
          // 斩击斧（用户 2026-10-06 拍板）：变形斩的「能量是否充足」——不足时该变形动作变为装瓶动作
          { key: 'energy', has: (m) => !!m.energyOption,
            render: () => cbCheck({ label: move.energyOption.label || '能量是否充足' },
              item.energy !== false, 'energy',
              '') },
          // 斩击斧：抵消上捞斩（GP）「当身成功」——成功走当身成立的两段（r36+r72）
          { key: 'gp', has: (m) => !!m.gpOption,
            render: () => cbCheck({ label: move.gpOption.label || 'GP 当身成功' },
              !!item.gp, 'gp', '当身成功 → 自动打出反击二连斩（r36 + r72）') },
          // 斩击斧集中处决：变化点自选（用户 2026-10-06 拍板）—— 形态可在倒数两招或最后一招改变
          { key: 'aim', has: (m) => !!(m.aimVariants && m.aimVariants.length),
            render: () => cbPick(move.aimVariants, Math.min(Math.max(Number(item.aim) || 0, 0), move.aimVariants.length - 1), 'aim',
              move.name + ' · 变化点（形态可在倒数两招或最后一招改变，含「变过去再变回来」；含变形的分支吃高速变形）') },
          // 太刀：招式级「有气」（表内 col81 有气动作值，默认有气）
          { key: 'qi', has: (m) => !!m.qiOption,
            render: () => cbCheck({ label: move.qiOption.label || '有气' }, item.qi !== false, 'qi') },
          { key: 'finish', has: (m) => !!m.finishOption,
            render: () => cbCheck({ label: move.finishOption.label || '打完' },
              (item.finish !== undefined) ? !!item.finish : !!move.finishOption['default'], 'finish',
              '') },
          // 大剑冲撞攻击：勾了 → 紧邻在它前面的那一刀若是蓄力斩/强蓄力斩/真蓄力斩，该刀整体取消
          //   标签带上「上一刀叫什么」：上一刀不是可打断的招式时，标出它实际是谁，避免误以为勾了没生效
          { key: 'cancelPrev', has: (m) => !!m.cancelPrevOption,
            render: () => {
              const prevItem = i > 0 ? state.combo[i - 1] : null;
              const prevMove = prevItem ? moveOf(prevItem.moveId) : null;
              const canCancel = !!(prevMove && prevMove.cancelMovable);
              const label = move.cancelPrevOption.label || '打断上一招';
              const tip = canCancel
                ? '勾选后：紧邻在「' + move.name + '」前面的那一刀「' + prevMove.name
                  + '」整体取消（伤害归零、动作值不计入合计、不耗斩）'
                : '勾选后：只有当紧邻在「' + move.name + '」前面的那一刀是蓄力斩 / 强蓄力斩 / 真蓄力斩时才会取消'
                  + '（现在的前一刀是「' + (prevMove ? prevMove.name : '（无）') + '」，勾了也不会取消）';
              cbCheck({
                label: label + '（前一刀：' + (prevMove ? prevMove.name : '无') + '）'
              }, (item.cancelPrev !== undefined) ? !!item.cancelPrev : !!move.cancelPrevOption['default'], 'cancelPrev', tip);
            } }
        ];
        MOVE_OPTION_RENDERERS.forEach((r) => { if (move && r.has(move)) r.render(); });
        const rm = document.createElement('button');
        rm.className = 'calc-rm'; rm.textContent = '×';
        rm.addEventListener('click', () => { state.combo.splice(i, 1); refreshComboUI(); });
        row.appendChild(rm);
        // 狂龙衣装开启时：该招带加段的话行内标一下（加段已并入本招，不单独成招）
        if (move && state.mantle) {
          const extra = [].concat(move.mantleHits || [],
            (levelsOf(move) ? (levelsOf(move).find((l) => l.level === chargeOf(item, move)) || {}).mantleHits : null) || []);
          if (extra.length) {
            const tag = document.createElement('span');
            tag.className = 'calc-tag';
            tag.textContent = '狂龙衣加段 ' + extra.map((h) => h.mv).join('+');
            // 用户 2026-10-07：不加提示文字
            row.appendChild(tag);
          }
        }
        list.appendChild(row);
      });
    }

    // 按派生约束刷新「可添加招式」下拉 + 提示
    function refreshMoveOptions() {
      const sel = el.querySelector('#calc-move');
      const hintEl = el.querySelector('#calc-derive-hint');
      const { list, tags, edgeTags, hint } = nextMoveOptions();
      const et = edgeTags || {};
      // 招式名就是招式名（用户 2026-10-08）：不在名字后面拼「· 0~3蓄 / · 可蓄」这类档位说明，
      //   档位由连段行上的档位按钮选（大剑 0~3 蓄、太刀无/白/黄/红刃），名字与行内都不再出现「蓄」字样
      sel.innerHTML = list.map((m) => `<option value="${m.id}">${levelNameOf(m, null) || m.name}${et[m.id] ? '［' + et[m.id] + '］' : ''}${tags[m.id] && tags[m.id] !== '派生' && tags[m.id] !== '空中' ? '（' + tags[m.id] + '）' : ''}</option>`).join('');
      sel.disabled = !list.length;
      el.querySelector('#calc-add').disabled = !list.length;
      hintEl.textContent = hint;
      syncPicker(sel);
    }
    function refreshComboUI() { renderCombo(); refreshMoveOptions(); recalc(); }

    // 已选技能摘要
    function renderSkillChips() {
      const box = el.querySelector('#calc-skill-chips');
      const count = el.querySelector('#calc-skill-count');
      const picked = Object.keys(state.skillLevels).filter((id) => state.skillLevels[id] > 0);
      count.textContent = picked.length ? `已选 ${picked.length} 个` : '未选技能';
      box.innerHTML = picked.map((id) => {
        const s = skills.find((x) => x.id === id);
        const paired=s?.coverageMode==='complementary'&&(id!=='HunterSkill_183'||state.skillLevels[id]===4);
        return s ? `<span class="calc-skill-chip">${s.name}<b>Lv${state.skillLevels[id]}</b>${(s.coverage && (paired||skillCoverage(id) < 100)) ? `<i class="calc-chip-cov">${paired?(id==='HunterSkill_114'?'二段 ':'克服 '):''}${skillCoverage(id)}%</i>` : ''}</span>` : '';
      }).join('');
      updateCondSummary();
    }

    // ===== 自绘选择器（系统原生 select 弹窗是白底直角，与深色主题割裂，全部替换） =====
    let pickerOpen = false;
    function openPicker(sel, title) {
      const sheet = el.querySelector('#calc-picker-sheet');
      const backdrop = el.querySelector('#calc-picker-backdrop');
      const list = el.querySelector('#calc-picker-list');
      el.querySelector('#calc-picker-title').textContent = title || '请选择';
      // 招式选择器：吃飞燕的招式挂「飞燕」标签；**会在这一招发生形态变化的挂「高速变形」**
      //   （用户 2026-09-30：盾突刺/防御 派生列表里的大解也要显示吃高速变形 → 按当前连段形态逐条判）
      const isMoveSel = sel.id === 'calc-move';
      list.innerHTML = Array.from(sel.options).map((o, i) => {
        const m = isMoveSel ? moveOf(o.value) : null;
        return `<button type="button" class="picker-item${o.selected ? ' active' : ''}" data-idx="${i}"><span>${o.textContent}${m ? hienTag(m) + morphTagInList(m) : ''}</span>${o.selected ? '<span class="picker-check">✓</span>' : ''}</button>`;
      }).join('');
      list.querySelectorAll('.picker-item').forEach((b) => {
        b.addEventListener('click', () => {
          const opt = sel.options[Number(b.dataset.idx)];
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
          closePicker();
        });
      });
      pickerOpen = true;
      sheet.hidden = false; backdrop.hidden = false;
      requestAnimationFrame(() => { sheet.classList.add('open'); backdrop.classList.add('open'); });
    }
    function closePicker() {
      const sheet = el.querySelector('#calc-picker-sheet');
      const backdrop = el.querySelector('#calc-picker-backdrop');
      if (!sheet) return;
      pickerOpen = false;
      sheet.classList.remove('open'); backdrop.classList.remove('open');
      setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 240);
    }
    // 把原生 select 藏起来，前面插入「深色按钮」，点击开自绘选择器
    function enhanceSelect(sel, title) {
      // 用户 2026-10-07：界面不放解释性文字（选项/招式说明一律不上界面），这里不再挂任何提示
      if (!sel || sel.dataset.enhanced) return;
      sel.dataset.enhanced = '1';
      sel.classList.add('calc-native-select');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-btn';
      btn.innerHTML = '<span class="picker-btn-text"></span><span class="picker-btn-caret">▾</span>';
      sel.parentNode.insertBefore(btn, sel);
      const sync = () => {
        const o = sel.options[sel.selectedIndex];
        btn.querySelector('.picker-btn-text').textContent = o ? o.textContent : '—';
        btn.disabled = !!sel.disabled;
      };
      sel._syncPicker = sync;
      sel.addEventListener('change', sync);
      btn.addEventListener('click', () => { if (!sel.disabled) openPicker(sel, title); });
      sync();
    }
    function syncPicker(sel) { if (sel && sel._syncPicker) sel._syncPicker(); }

    // 技能列表：按当前属性/异常类型过滤后重建（切换类型时刷新）
    // 技能覆盖率（用户 2026-10-06）：整数百分比，默认 100；只有数据层标了 coverage 的技能才渲染滑块
    const skillCoverage = (id) => {
      const v = state.skillCoverage[id];
      return v == null ? 100 : Math.max(0, Math.min(100, Math.round(v)));
    };
    // 分组按用户提供的技能表 SkillCommonData.skillCategory：武器专属 / 防具 / 套装 / 群组
    const SKILL_CAT_CN = { WEAPON: '武器技能', EQUIP: '防具技能', SERIES: '套装技能', GROUP: '群组技能' };
    const SKILL_CAT_ORDER = ['WEAPON', 'EQUIP', 'SERIES', 'GROUP'];
    function buildSkillList() {
      const box = el.querySelector('#calc-skill-list');
      if (!box) return;
      const list = relevantSkills.filter(skillVisible);
      const rowHtml = (s) => {
        const maxLv = s.levels.length ? Math.max.apply(null, s.levels.map((l) => l.level)) : 0;
        const cur = state.skillLevels[s.id] || 0;
        // 套装技能的「等级」其实是件数（2件/4件），显示成 N件 更准确
        const lvUnit = (v) => (s.skillCategory === 'SERIES' ? v + '件' : 'Lv' + v);
        const opts = s.levels.map((l) => `<option value="${l.level}"${l.level === cur ? ' selected' : ''}>${lvUnit(l.level)}</option>`).join('');
        // 套装技能只有 2/4 档：步进器要按「可选档位」走，不能按 +1 走（否则会停在没有效果的 Lv1/Lv3）
        const lvList = s.levels.map((l) => l.level).join(',');
        return `<div class="calc-skill-row" data-name="${s.name}"${s.skillCategory === 'SERIES' ? ' data-set-skill="1"' : ''}>
          <span class="calc-skill-name">${s.name}</span>
          <div class="calc-stepper">
            <button type="button" class="step-btn" data-skill-step="${s.id}" data-step="-1">−</button>
            <span class="step-val${cur > 0 ? ' on' : ''}" data-skill-val="${s.id}">${lvUnit(cur)}</span>
            <button type="button" class="step-btn" data-skill-step="${s.id}" data-step="1">+</button>
          </div>
          <select class="calc-native-select" data-skill="${s.id}" data-max="${maxLv}" data-levels="${lvList}"><option value="0">${lvUnit(0)}</option>${opts}</select>
          ${(cur > 0 && s.coverage) ? covRowHtml(s) : ''}
        </div>`;
      };
      // 覆盖率条（用户 2026-10-06）：选了等级才出现，整数百分比，左右带 −/+ 微调
      //   只给标了 coverage 的技能（防具技能 / 套装技能 / 心眼）；以期望值折算进面板数值
      const covRowHtml = (s) => {
        const cov = skillCoverage(s.id);
        const paired=s.coverageMode==='complementary'&&(s.id!=='HunterSkill_183'||state.skillLevels[s.id]===4);
        const first=s.id==='HunterSkill_114'?'一段':'狂龙症状态';
        const second=s.id==='HunterSkill_114'?'二段':'克服狂龙症';
        return `<div class="calc-skill-cov" data-cov-row="${s.id}">
          ${paired?`<span class="calc-cov-label" data-cov-first="${s.id}">${first} ${100-cov}%</span>`:''}
          <span class="calc-cov-label">${paired?second+'覆盖率':'覆盖率'}</span>
          <button type="button" class="step-btn calc-cov-btn" data-cov-step="${s.id}" data-step="-1">−</button>
          <input type="range" class="calc-cov-range" data-cov-range="${s.id}" min="0" max="100" step="1" value="${cov}" aria-label="${s.name} ${paired?second+'覆盖率':'覆盖率'}">
          <span class="calc-cov-val" data-cov-val="${s.id}">${cov}%</span>
          <button type="button" class="step-btn calc-cov-btn" data-cov-step="${s.id}" data-step="1">+</button>
        </div>`;
      };
      // 按分类分组渲染（没有分类的归到「其他」）
      const groups = new Map();
      list.forEach((s) => {
        const c = SKILL_CAT_ORDER.indexOf(s.skillCategory) >= 0 ? s.skillCategory : 'OTHER';
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(s);
      });
      const order = SKILL_CAT_ORDER.concat(['OTHER']);
      box.innerHTML = order.filter((c) => groups.has(c)).map((c) => {
        const label = SKILL_CAT_CN[c] || '其他技能';
        return `<div class="calc-skill-group" data-group="${c}">`
          + `<div class="calc-skill-group-head">${label}<i>${groups.get(c).length}</i></div>`
          + groups.get(c).map(rowHtml).join('')
          + '</div>';
      }).join('');

      // 技能行的等级显示（直接沿用选项文案：普通技能是 LvN、套装技能是 N件）
      const syncSkillRow = (sel) => {
        const val = box.querySelector('[data-skill-val="' + sel.dataset.skill + '"]');
        if (!val) return;
        const opt = sel.options[sel.selectedIndex];
        val.textContent = opt ? opt.textContent : 'Lv' + sel.value;
        val.classList.toggle('on', Number(sel.value) > 0);
      };
      // 互斥技能组（同一套装备的两种护甲，如欧米茄共鸣【远】/【近】）：选了一个就把同组其它清零
      const enforceExclusive = (skillId) => {
        const me = relevantSkills.find((s) => s.id === skillId);
        const grp = me && me.exclusiveGroup;
        if (!grp || !(state.skillLevels[skillId] > 0)) return;
        relevantSkills.forEach((s) => {
          if (s.id === skillId || s.exclusiveGroup !== grp || !(state.skillLevels[s.id] > 0)) return;
          state.skillLevels[s.id] = 0;
          const other = box.querySelector('select[data-skill="' + s.id + '"]');
          if (other) { other.value = '0'; syncSkillRow(other); }
        });
      };
      box.querySelectorAll('[data-skill]').forEach((sel) => {
        sel.value = String(state.skillLevels[sel.dataset.skill] || 0);
        sel.addEventListener('change', () => {
          state.skillLevels[sel.dataset.skill] = Number(sel.value);
          syncSkillRow(sel);
          enforceExclusive(sel.dataset.skill);
          renderSkillChips(); recalc();
          // 用户 2026-10-07：改等级后必须重渲染技能列表 —— 覆盖率条只在「该技能 level>0 且有覆盖率」时渲染，
          //   只刷数值不重建 DOM 的话，覆盖率条永远不会出现（选了等级也看不到）
          buildSkillList();
        });
      });
      box.querySelectorAll('[data-skill-step]').forEach((b) => {
        b.addEventListener('click', () => {
          const sel = box.querySelector('select[data-skill="' + b.dataset.skillStep + '"]');
          if (!sel) return;
          // 按实际可选档位步进（普通技能 = 1..N；套装技能 = 2/4 件）
          const avail = String(sel.dataset.levels || '').split(',').map(Number).filter((x) => x > 0);
          const cur = Number(sel.value) || 0;
          const step = Number(b.dataset.step);
          let next;
          if (step > 0) next = avail.find((lv) => lv > cur);
          else {
            const lower = avail.filter((lv) => lv < cur);
            next = lower.length ? lower[lower.length - 1] : 0;
          }
          if (next === undefined) next = cur;
          if (next === cur) return;
          sel.value = String(next);
          sel.dispatchEvent(new Event('change'));
        });
      });
      // 覆盖率条：拖动 + 左右 ±1%（整数，只有 coverage 技能才渲染）
      const setCov = (id, v) => {
        const next = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
        state.skillCoverage[id] = next;
        box.querySelectorAll('[data-cov-range="' + id + '"]').forEach((r) => { r.value = String(next); });
        box.querySelectorAll('[data-cov-val="' + id + '"]').forEach((s) => { s.textContent = next + '%'; });
        box.querySelectorAll('[data-cov-first="' + id + '"]').forEach((s) => { s.textContent=(id==='HunterSkill_114'?'一段':'狂龙症状态')+' '+(100-next)+'%'; });
        renderSkillChips(); recalc();
      };
      box.querySelectorAll('[data-cov-range]').forEach((r) => {
        r.addEventListener('input', () => setCov(r.dataset.covRange, r.value));
        r.addEventListener('change', () => setCov(r.dataset.covRange, r.value));
      });
      box.querySelectorAll('[data-cov-step]').forEach((b) => {
        b.addEventListener('click', () => {
          const id = b.dataset.covStep;
          setCov(id, skillCoverage(id) + Number(b.dataset.step || 0));
        });
      });
      applySkillSearch();
    }
    // 过滤后清掉已选中但当前类型不匹配的技能
    function pruneSkillLevels() {
      relevantSkills.forEach((s) => {
        if (!skillVisible(s) && state.skillLevels[s.id] > 0) state.skillLevels[s.id] = 0;
      });
    }
    function applySkillSearch() {
      const inp = el.querySelector('#calc-skill-search');
      const f = inp ? inp.value.trim().toLowerCase() : '';
      el.querySelectorAll('#calc-skill-list .calc-skill-row').forEach((row) => {
        row.hidden = !!f && !(row.dataset.name || '').toLowerCase().includes(f);
      });
      // 分类标题：该组全被搜掉时一起隐藏
      el.querySelectorAll('#calc-skill-list .calc-skill-group').forEach((g) => {
        // 注意：querySelectorAll 返回的是 NodeList（没有 some/map），必须转成数组再判空
        const anyVisible = Array.from(g.querySelectorAll('.calc-skill-row')).some((r) => !r.hidden);
        g.hidden = !anyVisible;
      });
    }

    // 技能/道具后的数值面板（技能卡下方）
    function renderPanel(p, skillNotes) {
      const box = el.querySelector('#calc-panel');
      if (!box) return;
      if (!p) { box.innerHTML = ''; return; }
      const num = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
      const row = (label, base, after, unit) => {
        const changed = Math.abs(after - base) > 1e-6;
        return `<div class="calc-panel-row"><span>${label}</span><b class="${changed ? 'up' : ''}">${num(base)}${unit || ''}${changed ? ' → ' + num(after) + (unit || '') : ''}</b></div>`;
      };
      let html = '<div class="calc-panel-title">技能 / 道具后数值</div>';
      // 旋律（可多选）：列出生效的旋律名，否则看不出伤害是按哪几条旋律算的
      const melOn = (CALC.melodies || []).filter((m) => state.melodyIds.indexOf(m.id) >= 0);
      if (melOn.length) {
        html += `<div class="calc-panel-row"><span>旋律</span><b class="up">${melOn.map((m) => m.name).join(' · ')}</b></div>`;
      }
      // 基础攻击力：面板输入 → 含「攻击」技能（其他技能不算基础攻击力）
      const baseAtk = p.baseAttackAfter != null ? p.baseAttackAfter : p.attackBase;
      html += row('基础攻击力', p.attackBase, baseAtk);
      // 最终攻击力：基础攻击力 × 其他技能乘算 + Σ加算（其他技能/道具 + 三灯加值）
      // 说明里把「基础攻击力那一档的加成」也写出来（如「攻击」技能的 +9），否则看不出最终值是怎么来的
      const atkParts = [];
      const baseDelta = baseAtk - p.attackBase;
      if (Math.abs(baseDelta) > 1e-6) atkParts.push('基础 ' + (baseDelta > 0 ? '+' : '') + num(baseDelta));
      if (Math.abs((p.attackOtherPct || 1) - 1) > 1e-6) atkParts.push('×' + num(p.attackOtherPct));
      if (p.attackLampFlat) atkParts.push('三灯 +' + num(p.attackLampFlat));
      const otherFlat = Math.abs((p.attackOtherFlat || 0)) > 1e-6 ? '其他技能/道具 +' + num(p.attackOtherFlat) : '';
      if (otherFlat) atkParts.push(otherFlat);
      html += `<div class="calc-panel-row"><span>最终攻击力</span><b class="${Math.abs(p.attackAfter - baseAtk) > 1e-6 ? 'up' : ''}">${num(p.attackAfter)}`
        + (atkParts.length ? `　<i class="calc-panel-note">${atkParts.join(' · ')}</i>` : '') + '</b></div>';
      html += row('面板属性值', p.elementBase, p.elementAfter);
      if (p.elementCapped) html += '<div class="calc-panel-row"><span>属性上限</span><b class="cap">已触上限（基础×2.3 或 400 取高）</b></div>';
      html += row('面板异常值', p.statusBase, p.statusAfter);
      // 会心率：含技能加成，并按当前所选部位自动应用弱点特效 / 伤口（弱电 = 该武器物理类型肉质 > 45）
      const aff = p.affinityVsTarget != null ? p.affinityVsTarget : p.affinityAfter;
      html += row('会心率', p.affinityBase, aff, '%');
      html += `<div class="calc-panel-row"><span>会心倍率</span><b>${num(p.critMult)}×</b></div>`;
      if (p.weakSpotAffinity) {
        html += `<div class="calc-panel-row"><span>弱点特效</span><b class="${p.affinityTargetIsWeak ? 'up' : ''}">`
          + (p.affinityTargetIsWeak
            ? `已生效 +${num(p.weakSpotAffinity)}%（当前部位${p.affinityTargetType === 'Blow' ? '打击' : '斩击'}肉质 ${p.affinityTargetRaw} > 45）`
            : `未生效（当前部位肉质 ${p.affinityTargetRaw} ≤ 45）`)
          + '</b></div>';
      }
      if (p.woundAffinity) {
        html += `<div class="calc-panel-row"><span>伤口加成</span><b class="${currentIsWound() ? 'up' : ''}">`
          + (currentIsWound() ? `已生效 +${num(p.woundAffinity)}%（当前肉质状态为伤口）` : `未生效（肉质状态没选伤口）`)
          + '</b></div>';
      }
      // 选了、但本计算器算不出来的技能：明确列出来，避免误以为已经计入
      const notes = skillNotes || [];
      if (notes.length) {
        html += '<div class="calc-panel-title warned">未计入伤害的技能</div>';
        notes.forEach((n) => {
          html += `<div class="calc-panel-row"><span>${n.name}</span><b class="warn">${n.reason}</b></div>`;
        });
      }
      box.innerHTML = html;
    }

    // 道具 / 餐点（同组互斥，单选）：走右侧抽拉式抽屉（用户 2026-09-30）
    function itemLabel(g) {
      const pick = state.itemPicks[g.key];
      const o = pick ? (g.options || []).find((x) => x.id === pick) : null;
      return o ? o.name : null;
    }
    function updateItemSummary() {
      const span = $('span#calc-item-summary');
      if (!span) return;
      const on = itemGroups.map((g) => itemLabel(g)).filter(Boolean);
      span.textContent = on.length ? on.join(' · ') : '未使用道具/餐点';
      span.classList.toggle('on', on.length > 0);
      const btn = $('button#calc-item-open');
      if (btn) btn.textContent = on.length ? `道具 / 餐点（${on.length}）` : '道具 / 餐点';
    }
    function buildItemSelectors() {
      const box = el.querySelector('#calc-item-list');
      if (!box) return;
      if (!itemGroups.length) { box.innerHTML = '<div class="empty">无道具数据</div>'; return; }
      box.innerHTML = itemGroups.map((g) => {
        const opts = ['<option value="">不使用</option>'].concat(
          g.options.map((o) => {
            const v = o.effects.map((e) => (e.type === 'add' ? '+' : '×') + e.value).join(' ');
            return `<option value="${o.id}"${state.itemPicks[g.key] === o.id ? ' selected' : ''}>${o.name}${v ? '（' + v + '）' : ''}</option>`;
          })
        ).join('');
        return `<label class="calc-field"><span>${g.name}</span><select data-item-group="${g.key}">${opts}</select></label>`;
      }).join('');
      box.querySelectorAll('[data-item-group]').forEach((sel) => {
        sel.addEventListener('change', () => {
          state.itemPicks[sel.dataset.itemGroup] = sel.value;
          updateItemSummary();
          recalc();
        });
        const g = itemGroups.find((x) => x.key === sel.dataset.itemGroup);
        enhanceSelect(sel, (g ? g.name : '道具') + ' 选择');
      });
      updateItemSummary();
    }

    // ===== 构建 DOM =====
    // 技能可见性（与引擎 applySkills 的过滤口径一致，双层落地）：
    //   1) 属性/异常强化技能只在面板所选类型一致时出现（火武器不显示冰属性强化、属性变换只对龙）
    //   2) 需要面板有属性/有异常才生效的技能（会心击【属性】/属性吸收要属性、会心击【特殊】要异常）
    //   3) 武器专属技能只在支持的武器下出现（攻击守势要格挡、蓄击强化只有大锤）
    function skillVisible(s) {
      if (s.elementType && s.elementType !== state.elementType) return false;
      if (s.statusType && s.statusType !== state.statusType) return false;
      if (s.requireElement && state.elementType === 'None') return false;
      if (s.requireStatus && state.statusType === 'None') return false;
      if (Array.isArray(s.weapons) && s.weapons.indexOf(state.weaponId) < 0) return false;
      return true;
    }

    const condHtml = `
      <label class="calc-check"><input type="checkbox" data-cond="fullHealth"${state.fullHealth ? ' checked' : ''}>满体力</label>
      <label class="calc-check"><input type="checkbox" data-cond="overcomeFrenzy"${state.overcomeFrenzy ? ' checked' : ''}>克服狂龙症</label>
      <label class="calc-check"><input type="checkbox" data-cond="clash"${state.clash ? ' checked' : ''}>角力/抵消成功</label>
      <label class="calc-check"><input type="checkbox" data-cond="ateMeat"${state.ateMeat ? ' checked' : ''}>食用烤熟的肉</label>
      <label class="calc-check"><input type="checkbox" data-cond="dodgeEvade"${state.dodgeEvade ? ' checked' : ''}>巧击发动中回避成功</label>
      <label class="calc-check"><input type="checkbox" data-cond="festival"${state.festival ? ' checked' : ''}>祭典期间</label>
      <label class="calc-check"><input type="checkbox" data-cond="warCry"${state.warCry ? ' checked' : ''}>动作「咆哮」后</label>
      <label class="calc-check"><input type="checkbox" data-cond="apexSoulReady"${state.apexSoulReady ? ' checked' : ''}>毅力【果敢】未触发</label>
      <label class="calc-check"><input type="checkbox" data-cond="encouragement"${state.encouragement ? ' checked' : ''}>激励发动中</label>
      <label class="calc-check"><input type="checkbox" data-cond="ailment"${state.ailment ? ' checked' : ''}>处于状态异常</label>
      <label class="calc-check calc-check-field">属性吸收受击<select id="calc-absorb">${[1, 2, 3].map((n) => `<option value="${n}"${n === state.absorbHits ? ' selected' : ''}>${n}次</option>`).join('')}</select></label>`;
    // 条件清单（界面摘要与抽屉共用同一份定义，避免两处文案漂移）
    const COND_LABELS = [
      ['monsterEnraged', '怪物愤怒'], ['fullHealth', '满体力'], ['overcomeFrenzy', '克服狂龙症'],
      ['clash', '角力成功'], ['ateMeat', '食用烤肉'], ['dodgeEvade', '巧击回避'],
      ['festival', '祭典期间'], ['warCry', '咆哮后'],['apexSoulReady','毅力【果敢】未触发'],['encouragement','激励发动中'],['ailment','状态异常中']
    ];

    // 三灯（红+白+橙）/ 猎虫（共斗虫）：**操虫棍独有**（用户拍板：不能混进别的武器）
    // 做法：标记与控件始终渲染，靠外层容器 hidden 按武器显隐 —— 换武器时不用整页重渲染
    // （重渲染会重建 state，用户已填的数值会被清掉）
    const lampHtml = `<label class="calc-check calc-lamp-toggle"><input type="checkbox" id="calc-lamp"${state.threeLamp ? ' checked' : ''}>三灯</label>`;
    const kinsectHtml = `<div class="calc-grid" id="calc-kinsect-row" style="margin-top:8px">
          <label class="calc-field"><span>猎虫</span><select id="calc-kinsect">${kinsects.map((k) => `<option value="${k.id}"${k.id === state.kinsectId ? ' selected' : ''}>${kinsectLabel(k)}</option>`).join('')}</select></label>
          <label class="calc-field"><span>猎虫等级</span><select id="calc-kinsect-level">${kinsectLevels.map((l) => `<option value="${l}"${l === state.kinsectLevel ? ' selected' : ''}>Lv${l}</option>`).join('')}</select></label>
        </div>`;
    const isIGNow = state.weaponId === 'insect_glaive';
    // 狂龙衣装（狂化装衣）：开启后把衣装给各招补的加段并入原招式（数据里已按招式挂好）
    // 只有「当前武器确实有加段数据」时才显示这个选项（按可触发性过滤，和技能池同一套口径）
    const mantleMoves = () => currentMoves().filter((m) => m.mantleHits || (m.chargeLevels || []).some((l) => l.mantleHits));
    const mantleAvailable = mantleMoves().length > 0;

    const monsterOpts = monsters.map((m) => `<option value="${m.name}">${m.zh}</option>`).join('');
    // 武器选择器（最上方）：招式表 / 技能池 / 专属强化都跟着武器走
    const weaponOpts = WEAPON_ORDER.filter((w) => (CALC.weaponMoves || {})[w])
      .map((w) => {
        const meta = WEAPON_META[w] || {};
        return `<option value="${w}"${w === state.weaponId ? ' selected' : ''}>${meta.nameCn || w}</option>`;
      }).join('');
    // 旋律（多选）：武器卡里只放「入口按钮 + 当前生效摘要」，勾选清单走右侧抽拉式抽屉
    // （用户 2026-09-30：开始的旋律不是单选，可以多选；做成右侧抽拉式）
    // 自我强化按用户要求只有狩猎笛才有 → 数据层 weapons 声明 + 这里按武器过滤（可触发性过滤）
    const melodyAvailable = () => (CALC.melodies || []).filter((m) => !m.weapons || m.weapons.indexOf(state.weaponId) >= 0);
    const melodyRowHtml = `<div class="calc-cond-bar" id="calc-melody-row">
          <button id="calc-melody-open" class="calc-btn ghost">旋律</button>
          <span class="calc-cond-summary" id="calc-melody-summary"></span>
        </div>`;
    const melodyDrawerHtml = `
      <div class="drawer-backdrop" id="calc-melody-backdrop" hidden></div>
      <aside class="drawer" id="calc-melody-drawer" hidden>
        <div class="drawer-head">
          <span class="drawer-title">旋律</span>
          <button class="drawer-close" id="calc-melody-close">✕</button>
        </div>
        <div class="drawer-body">
          <p class="calc-drawer-note">可多选：攻击力 / 属性强化作用在基础值上，会心强化加在会心率上</p>
          <button id="calc-melody-clear" class="calc-btn ghost calc-drawer-clear">清空旋律</button>
          <div class="calc-cond-list" id="calc-melody-list"></div>
        </div>
      </aside>`;
    const weaponNote = '';   // 用户 2026-10-07：武器页不放说明文字

    el.innerHTML = `
      <div class="calc-header"><h1>伤害计算器</h1></div>

      <section class="calc-card calc-weapon-card">
        <h2>武器</h2>
        ${presetHtml('settings', '配置预设（武器 / 基础数值 / 技能）')}
        <div class="calc-grid">
          <label class="calc-field" style="grid-column:1 / -1"><span>武器种类</span><select id="calc-weapon">${weaponOpts}</select></label>
        </div>
        <!-- 三灯 / 猎虫：操虫棍专属子选项 —— 跟武器种类放同一组（用户 2026-09-30），靠 hidden 按武器显隐 -->
        <div class="calc-checks" id="calc-lamp-row"${isIGNow ? '' : ' hidden'}>${lampHtml}</div>
        ${kinsectHtml.replace('id="calc-kinsect-row"', 'id="calc-kinsect-row"' + (isIGNow ? '' : ' hidden'))}
        ${melodyRowHtml}
        <div class="calc-checks" id="calc-mantle-row"${mantleAvailable ? '' : ' hidden'}>
          <label class="calc-check"><input type="checkbox" id="calc-mantle"${state.mantle ? ' checked' : ''}>狂龙衣装</label>
          <span class="calc-check-note"></span>
        </div>
        <div class="calc-checks" id="calc-cb-row" hidden>
          <label class="calc-field calc-field-inline"><span>瓶</span>
            <select id="calc-cb-phial">
              <option value="impact"${state.cbPhial === 'impact' ? ' selected' : ''}>榴弹瓶</option>
              <option value="element"${state.cbPhial === 'element' ? ' selected' : ''}>强属性瓶</option>
            </select>
          </label>
          <label class="calc-field calc-field-inline"><span>瓶状态</span>
            <select id="calc-cb-reinforced">
              <option value="0"${state.cbReinforced ? '' : ' selected'}>普通瓶</option>
              <option value="1"${state.cbReinforced ? ' selected' : ''}>强化瓶</option>
            </select>
          </label>
          <label class="calc-check"><input type="checkbox" id="calc-cb-redshield"${state.cbRedShield ? ' checked' : ''}>红盾</label>
          <label class="calc-check"><input type="checkbox" id="calc-cb-redsword"${state.cbRedSword ? ' checked' : ''}>红剑</label>
        </div>
        <div class="calc-checks" id="calc-swax-row" hidden>
          <label class="calc-field calc-field-inline"><span>瓶种</span>
            <select id="calc-swax-phial">
              <option value="power"${state.swaxPhial === 'power' ? ' selected' : ''}>强击瓶</option>
              <option value="element"${state.swaxPhial === 'element' ? ' selected' : ''}>强属性瓶</option>
            </select>
          </label>
          <label class="calc-check"><input type="checkbox" id="calc-swax-awakened"${state.swaxAwakened ? ' checked' : ''}>开刃</label>
          <label class="calc-check"><input type="checkbox" id="calc-swax-redaxe"${state.swaxRedAxe ? ' checked' : ''}>红斧</label>
        </div>
        <div class="calc-checks" id="calc-horn-row" hidden>
          <label class="calc-field calc-field-inline"><span>响玉</span>
            <select id="calc-horn-ballad">
              <option value="0"${state.balladCount === 0 ? ' selected' : ''}>0 颗</option>
              <option value="1"${state.balladCount === 1 ? ' selected' : ''}>1 颗</option>
              <option value="2"${state.balladCount === 2 ? ' selected' : ''}>2 颗</option>
              <option value="3"${state.balladCount === 3 ? ' selected' : ''}>3 颗</option>
            </select>
          </label>
        </div>
        <div class="calc-checks" id="calc-db-row" hidden>
          <label class="calc-field calc-field-inline"><span>起始模式</span><select id="calc-db-mode">
            <option value="normal"${state.dbMode === 'normal' ? ' selected' : ''}>普通</option>
            <option value="enhanced"${state.dbMode === 'enhanced' ? ' selected' : ''}>鬼人强化</option>
            <option value="demon"${state.dbMode === 'demon' ? ' selected' : ''}>鬼人化</option>
          </select></label>
          <label class="calc-check"><input type="checkbox" id="calc-bluedemon"${state.blueDemon ? ' checked' : ''}>蓝鬼</label>
          <span class="calc-check-note" id="calc-bluedemon-note"></span>
        </div>
        <div class="calc-checks" id="calc-gl-row" hidden>
          <label class="calc-field calc-field-inline"><span>炮击类型</span>
            <select id="calc-gl-type">
              ${(GL_TYPES || ['normal']).map((t) => `<option value="${t}"${state.glType === t ? ' selected' : ''}>${GL_TYPE_CN[t] || t}</option>`).join('')}
            </select>
          </label>
          <label class="calc-field calc-field-inline"><span>炮击等级</span>
            <select id="calc-gl-level">
              ${[1, 2, 3, 4, 5, 6, 7].map((lv) => `<option value="${lv}"${state.glLevel === lv ? ' selected' : ''}>${GL_LEVEL_LABEL(lv)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="calc-hint" id="calc-weapon-note"${weaponNote ? '' : ' hidden'}>${weaponNote}</div>
      </section>

      <section class="calc-card">
        <h2>基础数值</h2>
        <div class="calc-grid">
          <label class="calc-field"><span>基础攻击力（不乘武器系数）</span><input id="calc-attack" type="number" min="0" step="1" value="${state.attack}"></label>
          <label class="calc-field"><span>基础会心率 %</span><input id="calc-affinity" type="number" min="-100" max="100" step="1" value="${state.affinity}"></label>
          <label class="calc-field"><span>属性类型</span><select id="calc-eltype">${EL_TYPES.map((e) => `<option value="${e}"${e === state.elementType ? ' selected' : ''}>${EL_CN[e] || e}</option>`).join('')}</select></label>
          <label class="calc-field"><span>面板属性值</span><input id="calc-element" type="number" min="0" step="10" value="${state.element}"></label>
          <label class="calc-field"><span>异常类型</span><select id="calc-sttype">${ST_TYPES.map((t) => `<option value="${t}"${t === state.statusType ? ' selected' : ''}>${ST_CN[t]}</option>`).join('')}</select></label>
          <label class="calc-field"><span>面板异常值</span><input id="calc-status" type="number" min="0" step="10" value="${state.status}"></label>
          <label class="calc-field" style="grid-column:1 / -1"><span>斩味</span><select id="calc-sharp">${sharpKeys.map((k) => `<option value="${k}"${k === state.sharpness ? ' selected' : ''}>${sharpCn[k] || k}</option>`).join('')}</select></label>
        </div>
        <div class="calc-cond-bar">
          <button id="calc-cond-open" class="calc-btn ghost">状态与条件</button>
          <span class="calc-cond-summary" id="calc-cond-summary"></span>
        </div>
        <div class="calc-cond-bar">
          <button id="calc-item-open" class="calc-btn ghost">道具 / 餐点</button>
          <span class="calc-cond-summary" id="calc-item-summary"></span>
        </div>
      </section>

      <section class="calc-card">
        <h2>技能</h2>
        <div class="calc-skill-bar">
          <button id="calc-skill-open" class="calc-btn">＋ 选择技能</button>
          <span class="calc-skill-count" id="calc-skill-count">未选技能</span>
        </div>
        <div class="calc-skill-chips" id="calc-skill-chips"></div>
        <div class="calc-panel" id="calc-panel"></div>
      </section>

      <section class="calc-card">
        <h2>怪物 / 部位</h2>
        <div class="calc-grid">
          <label class="calc-field"><span>怪物</span><select id="calc-monster">${monsterOpts}</select></label>
          <label class="calc-field"><span>部位</span><select id="calc-part"></select></label>
        </div>
        <div class="calc-grid" style="margin-top:8px">
          <label class="calc-field" style="grid-column:1 / -1"><span>选择任务</span><select id="calc-quest"></select></label>
          <label class="calc-field"><span>人数</span><select id="calc-players"><option value="1">1人</option></select></label>
        </div>
        <div class="calc-hint" id="calc-scarraw-note"></div>
        <div class="calc-grid" style="margin-top:8px">
          <label class="calc-field" style="grid-column:1 / -1"><span>肉质状态</span><select id="calc-meat-state"></select></label>
        </div>
        <label class="calc-check" style="margin-top:8px"><input type="checkbox" id="calc-enrage"${state.monsterEnraged ? ' checked' : ''}>怪物发怒</label>
        <div class="calc-hint" id="calc-enrage-note"></div>
        <div class="calc-hint" id="calc-meat-hint"></div>
      </section>

      <section class="calc-card">
        <h2>自定义连段</h2>
        ${presetHtml('combos', '连段预设（当前武器）')}
        <label class="calc-check calc-derive-toggle"><input type="checkbox" id="calc-derive-toggle"${state.deriveMode ? ' checked' : ''}>遵循派生逻辑（关闭后可任意接招）</label>
        <div class="calc-add-row">
          <select id="calc-move"></select>
          <button id="calc-add" class="calc-btn">＋ 添加</button>
        </div>
        <div class="calc-hint" id="calc-derive-hint"></div>
        <div class="calc-combo-bar">
          <span class="calc-dance-note" id="calc-dance-note"></span>
          <button id="calc-combo-clear" class="calc-btn ghost">清空连段</button>
        </div>
        <div class="calc-combo-list" id="calc-combo-list"></div>
        <div class="calc-combo-sum" id="calc-combo-sum"></div>
      </section>

      <section class="calc-card calc-result">
        <h2>计算结果</h2>
        <div class="calc-result-grid" id="calc-result-grid"></div>
        <div class="calc-hit-table" id="calc-hit-table"></div>
      </section>

      <div class="drawer-backdrop" id="calc-skill-backdrop" hidden></div>
      <aside class="drawer" id="calc-skill-drawer" hidden>
        <div class="drawer-head">
          <span class="drawer-title">技能配置</span>
          <button class="drawer-close" id="calc-skill-close">✕</button>
        </div>
        <div class="drawer-body">
          <input id="calc-skill-search" type="search" placeholder="搜索技能" class="calc-drawer-search">
          <button id="calc-skill-clear" class="calc-btn ghost calc-drawer-clear">清空全部技能</button>
          <div class="calc-skill-list" id="calc-skill-list"></div>
        </div>
      </aside>

      <div class="drawer-backdrop" id="calc-cond-backdrop" hidden></div>
      <aside class="drawer" id="calc-cond-drawer" hidden>
        <div class="drawer-head">
          <span class="drawer-title">状态与条件</span>
          <button class="drawer-close" id="calc-cond-close">✕</button>
        </div>
        <div class="drawer-body">
          <p class="calc-drawer-note">勾选后对应技能才会生效（如「挑战者」需要怪物愤怒、「辟兽之力」需要角力成功）</p>
          <div class="calc-cond-list">${condHtml}</div>
        </div>
      </aside>
      ${melodyDrawerHtml}

      <div class="drawer-backdrop" id="calc-item-backdrop" hidden></div>
      <aside class="drawer" id="calc-item-drawer" hidden>
        <div class="drawer-head">
          <span class="drawer-title">道具 / 餐点</span>
          <button class="drawer-close" id="calc-item-close">✕</button>
        </div>
        <div class="drawer-body">
          <p class="calc-drawer-note">同组互斥（游戏内不可叠加）</p>
          <button id="calc-item-clear" class="calc-btn ghost calc-drawer-clear">清空道具 / 餐点</button>
          <div class="calc-grid calc-item-grid" id="calc-item-list"></div>
        </div>
      </aside>

      <div class="picker-backdrop" id="calc-picker-backdrop" hidden></div>
      <div class="picker-sheet" id="calc-picker-sheet" hidden>
        <div class="picker-head">
          <span class="picker-title" id="calc-picker-title"></span>
          <button type="button" class="picker-close" id="calc-picker-close">✕</button>
        </div>
        <div class="picker-list" id="calc-picker-list"></div>
      </div>`;

    // ===== 事件绑定 =====
    const $ = (id) => el.querySelector(id);
    // 「无」属性 / 「无」异常：输入框置灰并显示 0（原值留在 state 里，切回来还在）
    function syncTypeInputs() {
      const noEl = state.elementType === 'None';
      const noSt = state.statusType === 'None';
      const elInput = $('input#calc-element');
      const stInput = $('input#calc-status');
      if (elInput) { elInput.disabled = noEl; elInput.value = noEl ? 0 : state.element; }
      if (stInput) { stInput.disabled = noSt; stInput.value = noSt ? 0 : state.status; }
    }
    syncTypeInputs();
    $('input#calc-attack').addEventListener('input', (e) => { state.attack = Number(e.target.value) || 0; recalc(); });
    $('input#calc-element').addEventListener('input', (e) => { state.element = Number(e.target.value) || 0; recalc(); });
    $('select#calc-eltype').addEventListener('change', (e) => {
      state.elementType = e.target.value;
      syncTypeInputs();
      pruneSkillLevels(); buildSkillList(); refreshMeatHint(); recalc();
    });
    $('select#calc-sttype').addEventListener('change', (e) => {
      state.statusType = e.target.value;
      syncTypeInputs();
      pruneSkillLevels(); buildSkillList(); recalc();
    });
    $('input#calc-status').addEventListener('input', (e) => { state.status = Number(e.target.value) || 0; recalc(); });
    $('input#calc-affinity').addEventListener('input', (e) => { state.affinity = Number(e.target.value) || 0; recalc(); });
    $('select#calc-sharp').addEventListener('change', (e) => { state.sharpness = e.target.value; recalc(); });
    $('select#calc-absorb').addEventListener('change', (e) => { state.absorbHits = Number(e.target.value); recalc(); });

    // 换武器：招式表/连段/技能池/专属选项全部跟着换
    //  - 连段必须清空（招式 id 属于旧武器）
    //  - 「遵循派生逻辑」默认：操虫棍=开（派生树已做），其他武器=关（派生逻辑待补充）
    //  - 三灯/猎虫等专属强化只对操虫棍显示（界面隐藏 + 引擎按 weaponId 拦，双层落地）
    // 注意：这里**不能整页重渲染** —— state 建在 renderCalculatorView 里，重渲染会把用户填的数值清空
    function applyWeapon() {
      const isIG = state.weaponId === 'insect_glaive';
      const isCB = state.weaponId === 'charge_blade';
      const isHH = state.weaponId === 'hunting_horn';
      const noteEl = $('div#calc-weapon-note');
      if (noteEl) {
        const noteTxt = '';   // 用户 2026-10-07：武器页不放说明文字
        noteEl.textContent = noteTxt;
        noteEl.hidden = !noteTxt;      // 没有说明文字时整行隐藏（大锤这一页不放说明）
      }
      const lampRow = $('div#calc-lamp-row');
      if (lampRow) lampRow.hidden = !isIG;
      const kinsectRow = $('div#calc-kinsect-row');
      if (kinsectRow) kinsectRow.hidden = !isIG;
      // 狂龙衣装：只有当前武器有加段数据时才给这个选项
      const mantleRow = $('div#calc-mantle-row');
      if (mantleRow) mantleRow.hidden = mantleMoves().length === 0;
      // 盾斧：瓶种 / 瓶状态 / 红盾 / 红剑（只有盾斧显示）
      const cbRow = $('div#calc-cb-row');
      if (cbRow) cbRow.hidden = !isCB;
      // 斩击斧：瓶种 / 开刃 / 红斧（只有斩击斧显示）
      const swaxRow = $('div#calc-swax-row');
      if (swaxRow) swaxRow.hidden = !(state.weaponId === 'switch_axe');
      // 狩猎笛：响玉数量（只有狩猎笛显示）
      const hornRow = $('div#calc-horn-row');
      if (hornRow) hornRow.hidden = !isHH;
      // 双刀：蓝鬼开关（只有双刀显示；切走武器复位为关 —— 状态复位须同时清数据 + 重画控件）
      const isDB = state.weaponId === 'dual_blades';
      const dbRow = $('div#calc-db-row');
      if (dbRow) dbRow.hidden = !isDB;
      if (!isDB) {
        state.blueDemon = false;
        const dbCb = $('input#calc-bluedemon');
        if (dbCb) dbCb.checked = false;
      }
      // 铳枪：炮击类型 / 炮击等级（只有铳枪显示；切走武器复位为估算器默认的 扩散型 + 较强(Lv3)）
      const isGL = state.weaponId === 'gunlance';
      const glRow = $('div#calc-gl-row');
      if (glRow) glRow.hidden = !isGL;
      if (!isGL) {
        state.glType = GL_DEFAULT_TYPE;
        state.glLevel = GL_DEFAULT_LEVEL;
        const tSel = $('select#calc-gl-type');
        if (tSel) tSel.value = GL_DEFAULT_TYPE;
        const lSel = $('select#calc-gl-level');
        if (lSel) lSel.value = String(GL_DEFAULT_LEVEL);
      }
      const dt = $('input#calc-derive-toggle');
      if (dt) dt.checked = state.deriveMode;
      // 旋律：按武器过滤（自我强化只有笛子）→ 换武器后重建清单并清掉失效项（定点更新，不重渲染整页）
      const melList = melodyAvailable();
      state.melodyIds = state.melodyIds.filter((id) => melList.some((m) => m.id === id));
      buildMelodyList();
      refreshMoveOptions();     // 招式下拉换成新武器的表
      pruneSkillLevels();       // 武器专属技能：换武器后清掉不能再触发的
      buildSkillList();         // 技能池按新武器过滤（skillVisible）
      renderSkillChips();       // 已选技能摘要也要跟着刷新（否则会留着已经失效的技能 chip）
      renderCombo();            // 连段已清空
      refreshPresetLists();
      recalc();
    }
    function presetMessage(kind, message) {
      const box = $('div#calc-' + kind + '-preset-message');
      box.textContent = message; box.hidden = !message;
    }
    function refreshPresetLists(kind, selectedId) {
      const bank = readPresets();
      (kind ? [kind] : ['settings', 'combos']).forEach(type => {
        const sel = $('select#calc-' + type + '-preset');
        if (!sel) return;
        const keep = selectedId == null ? sel.value : selectedId;
        sel.innerHTML = '';
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = '请选择预设'; sel.appendChild(empty);
        bank[type].filter(p => type !== 'combos' || p.weaponId === state.weaponId).forEach(p => {
          const o = document.createElement('option'); o.value = p.id;
          o.textContent = (type === 'settings' ? (WEAPON_META[p.weaponId].nameCn || p.weaponId) + ' · ' : '') + p.name;
          sel.appendChild(o);
        });
        sel.value = Array.from(sel.options).some(o => o.value === keep) ? keep : '';
        syncPicker(sel);
        ['load', 'rename', 'delete'].forEach(action => { $('button#calc-' + type + '-preset-' + action).disabled = !sel.value; });
      });
    }
    function restoreSettingsPreset(preset) {
      const source = preset.data;
      if (state.weaponId !== preset.weaponId) {
        state.combo = []; state.deriveMode = !!WEAPON_META[preset.weaponId].hasDerive;
      }
      CONFIG_KEYS.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) return;
        const v = source[key];
        if (Array.isArray(state[key])) { if (Array.isArray(v)) state[key] = v.filter(x => typeof x === 'string'); }
        else if (state[key] && typeof state[key] === 'object') { if (v && !Array.isArray(v) && typeof v === 'object') state[key] = clonePreset(v); }
        else if (typeof v === typeof state[key] && (typeof v !== 'number' || Number.isFinite(v))) state[key] = v;
      });
      state.weaponId = preset.weaponId;
      // 只恢复本版存在的技能与有效等级，避免旧预设影响新版本。
      state.skillLevels = Object.fromEntries(skills.filter(s => state.skillLevels[s.id] > 0).map(s => [s.id,
        Math.min(Math.max(Number(state.skillLevels[s.id]) || 0, 0), Math.max(...s.levels.map(l => l.level)))]));
      state.skillCoverage = Object.fromEntries(skills.filter(s => Number.isFinite(Number(state.skillCoverage[s.id])))
        .map(s => [s.id, Math.min(100, Math.max(0, Number(state.skillCoverage[s.id])))]));
      const controls = { weapon: 'weaponId', attack: 'attack', affinity: 'affinity', element: 'element', eltype: 'elementType',
        status: 'status', sttype: 'statusType', sharp: 'sharpness', kinsect: 'kinsectId', 'kinsect-level': 'kinsectLevel',
        'cb-phial': 'cbPhial', 'cb-reinforced': 'cbReinforced', 'swax-phial': 'swaxPhial', 'horn-ballad': 'balladCount',
        'gl-type': 'glType', 'gl-level': 'glLevel', 'db-mode': 'dbMode', absorb: 'absorbHits' };
      Object.entries(controls).forEach(([id, key]) => {
        const control = el.querySelector('#calc-' + id);
        if (!control) return;
        control.value = String(key === 'cbReinforced' ? Number(state[key]) : state[key]); syncPicker(control);
      });
      const checks = { lamp: 'threeLamp', mantle: 'mantle', 'cb-redshield': 'cbRedShield', 'cb-redsword': 'cbRedSword',
        'swax-awakened': 'swaxAwakened', 'swax-redaxe': 'swaxRedAxe', bluedemon: 'blueDemon' };
      Object.entries(checks).forEach(([id, key]) => { const cb = el.querySelector('#calc-' + id); if (cb) cb.checked = !!state[key]; });
      el.querySelectorAll('[data-cond]').forEach(cb => { cb.checked = !!state[cb.dataset.cond]; });
      buildItemSelectors(); updateCondSummary(); applyWeapon();
    }
    function setupPresets() {
      enhanceSelect($('select#calc-settings-preset'), '配置预设');
      enhanceSelect($('select#calc-combos-preset'), '连段预设');
      ['settings', 'combos'].forEach(kind => {
        const sel = $('select#calc-' + kind + '-preset');
        const editor = $('form#calc-' + kind + '-preset-editor');
        const input = $('input#calc-' + kind + '-preset-name');
        let editing = null;
        const find = () => readPresets()[kind].find(p => p.id === sel.value);
        const close = () => { editor.hidden = true; editing = null; };
        sel.addEventListener('change', () => { close(); refreshPresetLists(kind); presetMessage(kind, ''); });
        $('button#calc-' + kind + '-preset-cancel').addEventListener('click', close);
        ['save', 'rename', 'delete'].forEach(action => {
          $('button#calc-' + kind + '-preset-' + action).addEventListener('click', () => {
            const p = action === 'save' ? null : find();
            if (action !== 'save' && !p) return;
            if (action === 'save' && kind === 'combos' && !state.combo.length) { presetMessage(kind, '请先添加招式再保存连段'); return; }
            editing = { action, id: p && p.id };
            input.readOnly = action === 'delete'; input.required = action !== 'delete';
            input.value = p ? p.name : '';
            $('span#calc-' + kind + '-preset-edit-label').textContent = action === 'delete' ? '确认删除以下预设' : '预设名称';
            $('button#calc-' + kind + '-preset-confirm').textContent = action === 'delete' ? '确认删除' : '保存';
            editor.hidden = false; presetMessage(kind, ''); input.focus();
          });
        });
        editor.addEventListener('submit', e => {
          e.preventDefault(); if (!editing) return;
          if (editing.action === 'save' && kind === 'combos' && !state.combo.length) { presetMessage(kind, '请先添加招式再保存连段'); return; }
          const name = input.value.trim().slice(0, 80);
          if (editing.action !== 'delete' && !name) { presetMessage(kind, '请输入预设名称'); return; }
          const bank = readPresets(); let id = editing.id;
          if (editing.action === 'save') {
            id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            const data = kind === 'settings' ? Object.fromEntries(CONFIG_KEYS.map(key => [key, clonePreset(state[key])]))
              : { combo: clonePreset(state.combo), deriveMode: state.deriveMode };
            bank[kind].push({ id, name, weaponId: state.weaponId, data, savedAt: Date.now() });
          } else {
            const p = bank[kind].find(p => p.id === id);
            if (!p) { presetMessage(kind, '该预设已不存在'); return; }
            if (editing.action === 'rename') p.name = name;
            else bank[kind] = bank[kind].filter(p => p.id !== id);
          }
          try { localStorage.setItem(PRESET_KEY, JSON.stringify(bank)); }
          catch (error) { presetMessage(kind, '保存失败，本机存储空间不足或不可用'); return; }
          const action = editing.action; close(); refreshPresetLists(kind, action === 'delete' ? '' : id);
          presetMessage(kind, action === 'delete' ? '已删除预设' : '预设已保存到本机');
        });
        $('button#calc-' + kind + '-preset-load').addEventListener('click', () => {
          const p = find(); if (!p) return;
          if (kind === 'settings') restoreSettingsPreset(p);
          else {
            const saved = Array.isArray(p.data.combo) ? window.MHCalculator.migrateRangedCombo(p.data.combo,window.MHWCALC.rangedLegacyAliases?.[state.weaponId]) : p.data.combo;
            if (p.weaponId !== state.weaponId || !Array.isArray(saved) || !saved.every(it => it && currentMoves().some(m => m.id === it.moveId))) {
              presetMessage(kind, '该连段含当前版本不支持的招式，无法读取'); return;
            }
            state.combo = clonePreset(saved); state.deriveMode = p.data.deriveMode !== false;
            $('input#calc-derive-toggle').checked = state.deriveMode; refreshComboUI();
          }
          close(); presetMessage(kind, '已读取：' + p.name);
        });
      });
      refreshPresetLists();
    }
    $('select#calc-weapon').addEventListener('change', (e) => {
      state.weaponId = e.target.value;
      state.combo = [];
      state.deriveMode = !!(WEAPON_META[state.weaponId] || {}).hasDerive;
      applyWeapon();
    });
    enhanceSelect($('select#calc-weapon'), '武器种类');

    el.querySelectorAll('[data-cond]').forEach((cb) => {
      cb.addEventListener('change', () => {
        state[cb.dataset.cond] = cb.checked;
        updateCondSummary();
        recalc();
      });
    });
    // 三灯（操虫棍子选项）：切换后重算（攻击倍率 + 移动斩/移动连斩 动作值都随之变）
    const lampCb = $('input#calc-lamp');
    if (lampCb) lampCb.addEventListener('change', () => { state.threeLamp = lampCb.checked; recalc(); });
    // 狂龙衣装：改了要重画连段行（行内会标出该招的加段）与结果表
    const mantleCb = $('input#calc-mantle');
    if (mantleCb) mantleCb.addEventListener('change', () => { state.mantle = mantleCb.checked; refreshComboUI(); });
    // 盾斧：瓶种 / 瓶状态 / 红盾 / 红剑（都会改伤害与瓶爆 → 重算）
    const cbPhialSel = $('select#calc-cb-phial');
    if (cbPhialSel) {
      cbPhialSel.addEventListener('change', () => { state.cbPhial = cbPhialSel.value === 'element' ? 'element' : 'impact'; recalc(); });
      enhanceSelect(cbPhialSel, '盾斧 · 瓶种');
    }
    const cbReinforcedSel = $('select#calc-cb-reinforced');
    if (cbReinforcedSel) {
      cbReinforcedSel.addEventListener('change', () => { state.cbReinforced = cbReinforcedSel.value === '1'; recalc(); });
      enhanceSelect(cbReinforcedSel, '盾斧 · 瓶状态');
    }
    const cbRedShieldCb = $('input#calc-cb-redshield');
    if (cbRedShieldCb) cbRedShieldCb.addEventListener('change', () => { state.cbRedShield = cbRedShieldCb.checked; recalc(); });
    const cbRedSwordCb = $('input#calc-cb-redsword');
    if (cbRedSwordCb) cbRedSwordCb.addEventListener('change', () => { state.cbRedSword = cbRedSwordCb.checked; recalc(); });
    // 斩击斧：瓶种（强击瓶 / 强属性瓶）、开刃、红斧（只有斩击斧显示；都会改伤害 → 重算）
    const swaxPhialSel = $('select#calc-swax-phial');
    if (swaxPhialSel) {
      swaxPhialSel.addEventListener('change', () => { state.swaxPhial = swaxPhialSel.value === 'element' ? 'element' : 'power'; recalc(); });
      enhanceSelect(swaxPhialSel, '斩击斧 · 瓶种（强击瓶 = 剑形态招式基础攻击力 +17% / 强属性瓶 = 基础属性 +45%）');
    }
    const swaxAwakenedCb = $('input#calc-swax-awakened');
    if (swaxAwakenedCb) {
      swaxAwakenedCb.addEventListener('change', () => { state.swaxAwakened = swaxAwakenedCb.checked; refreshComboUI(); });
    }
    const swaxRedAxeCb = $('input#calc-swax-redaxe');
    if (swaxRedAxeCb) {
      swaxRedAxeCb.addEventListener('change', () => { state.swaxRedAxe = swaxRedAxeCb.checked; recalc(); });
    }
    // 狩猎笛：响玉数量（0~3）—— 每颗响玉在符合条件的一招里各触发一次共鸣
    const balladSel = $('select#calc-horn-ballad');
    if (balladSel) {
      balladSel.addEventListener('change', () => { state.balladCount = Number(balladSel.value) || 0; recalc(); });
      enhanceSelect(balladSel, '狩猎笛 · 响玉数量');
    }
    // 双刀：蓝鬼（鬼人闪身）—— 基础攻击力 ×1.15、属性 +基础属性×0.3（只在双刀生效，引擎侧硬拦截）
    const blueCb = $('input#calc-bluedemon');
    if (blueCb) {
      blueCb.addEventListener('change', () => {
        state.blueDemon = blueCb.checked;
        // 等效值提示：直接写出倍率后的基础攻击力与属性值（用户要求：不许只标倍率不给结果）
        updateBlueDemonNote();
        recalc();
      });
    }
    // 铳枪：炮击类型 / 炮击等级（都会改炮击系伤害 → 重算）
    const dbModeSel = $('select#calc-db-mode');
    if (dbModeSel) {
      dbModeSel.addEventListener('change', () => { state.dbMode = DB_MODE_NAMES[dbModeSel.value] ? dbModeSel.value : 'demon'; refreshComboUI(); });
      enhanceSelect(dbModeSel, '起始模式');
    }
    const glTypeSel = $('select#calc-gl-type');
    if (glTypeSel) {
      glTypeSel.addEventListener('change', () => { state.glType = glTypeSel.value || GL_DEFAULT_TYPE; recalc(); });
      enhanceSelect(glTypeSel, '铳枪 · 炮击类型');
    }
    const glLevelSel = $('select#calc-gl-level');
    if (glLevelSel) {
      glLevelSel.addEventListener('change', () => { state.glLevel = Number(glLevelSel.value) || GL_DEFAULT_LEVEL; recalc(); });
      enhanceSelect(glLevelSel, '铳枪 · 炮击等级');
    }
    // 双刀蓝鬼：等效值提示（写出倍率后的基础攻击力 / 属性值 —— 界面显示值 = 实际生效值）
    function updateBlueDemonNote() {
      const el2 = $('span#calc-bluedemon-note');
      if (!el2) return;
      const mul = Number(blueDemonCfg.attackBaseMul) || 1.15;
      const add = Number(blueDemonCfg.elementBaseAdd) || 0.3;
      if (!state.blueDemon) {
        el2.textContent = '基础攻击力 ×' + mul + ' · 属性 +基础属性×' + add;
        return;
      }
      const atk = Number(state.attack) || 0;
      const elem = Number(state.element) || 0;
      el2.textContent = '攻击力 ' + atk + ' → ' + Math.floor(Math.round(atk * mul * 1e6) / 1e6)
        + ' · 属性 ' + elem + ' → ' + Math.round((elem + elem * add) * 1e6) / 1e6;
    }

    // 旋律（多选 + 右侧抽拉式抽屉）：攻击力/属性强化作用在基础值上，会心强化加会心率
    //   同组互斥（攻击力小/大强化是同一旋律的两个档）→ 勾了高档就把同组低档取消（引擎侧再兜一层）
    function melodyListHtml() {
      const list = melodyAvailable();
      if (!list.length) return '<div class="empty">当前武器没有可选旋律。</div>';
      return list.map((m) => `<label class="calc-check calc-melody-item"><input type="checkbox" data-melody="${m.id}"${state.melodyIds.indexOf(m.id) >= 0 ? ' checked' : ''}>${m.name}`
        + '</label>').join('');
    }
    function updateMelodySummary() {
      const list = melodyAvailable();
      const on = list.filter((m) => state.melodyIds.indexOf(m.id) >= 0).map((m) => m.name);
      const span = $('span#calc-melody-summary');
      if (span) {
        span.textContent = on.length ? on.join(' · ') : '未演奏旋律';
        span.classList.toggle('on', on.length > 0);
      }
      const btn = $('button#calc-melody-open');
      if (btn) btn.textContent = on.length ? `旋律（${on.length}）` : '旋律';
    }
    function buildMelodyList() {
      const box = $('div#calc-melody-list');
      // 逐条绑定（不用事件委托：模拟器与部分 WebView 的 change 不冒泡，逐条绑定最稳）
      const onMelodyChange = (e) => {
        const id = e.target.dataset.melody;
        if (e.target.checked) {
          if (state.melodyIds.indexOf(id) < 0) state.melodyIds.push(id);
          enforceMelodyExclusive(id);
        } else {
          state.melodyIds = state.melodyIds.filter((x) => x !== id);
        }
        buildMelodyList();     // 重画清单（互斥被取消的那条要同步取消勾选）
        recalc();
      };
      if (box) {
        box.innerHTML = melodyListHtml();
        box.querySelectorAll('input[data-melody]').forEach((cb) => cb.addEventListener('change', onMelodyChange));
      }
      const row = $('div#calc-melody-row');
      if (row) row.hidden = melodyAvailable().length === 0;
      updateMelodySummary();
    }
    // 同组互斥：勾上同组的高档时把低档取消（只保留一条，避免同旋律双算）
    function enforceMelodyExclusive(checkedId) {
      const list = CALC.melodies || [];
      const grp = (list.find((m) => m.id === checkedId) || {}).exclusiveGroup;
      if (!grp) return;
      state.melodyIds = state.melodyIds.filter((id) => {
        const m = list.find((x) => x.id === id);
        return !m || m.exclusiveGroup !== grp || id === checkedId;
      });
    }
    buildMelodyList();
    $('button#calc-melody-clear').addEventListener('click', () => { state.melodyIds = []; buildMelodyList(); recalc(); });
    // 猎虫（虫种 / 等级）：改变威力倍率 → 猎虫伤害
    const kinsectSel = $('select#calc-kinsect');
    if (kinsectSel) {
      kinsectSel.addEventListener('change', () => { state.kinsectId = kinsectSel.value; recalc(); });
      enhanceSelect(kinsectSel, '选择猎虫');
    }
    const kinsectLvSel = $('select#calc-kinsect-level');
    if (kinsectLvSel) {
      kinsectLvSel.addEventListener('change', () => { state.kinsectLevel = Number(kinsectLvSel.value) || 1; recalc(); });
      enhanceSelect(kinsectLvSel, '猎虫等级');
    }

    // 技能抽屉
    const drawer = $('aside#calc-skill-drawer');
    const backdrop = $('div#calc-skill-backdrop');
    function openSkillDrawer() {
      drawer.hidden = false; backdrop.hidden = false;
      requestAnimationFrame(() => { drawer.classList.add('open'); backdrop.classList.add('open'); });
    }
    function closeSkillDrawer() {
      drawer.classList.remove('open'); backdrop.classList.remove('open');
      setTimeout(() => { drawer.hidden = true; backdrop.hidden = true; }, 260);
    }
    $('button#calc-skill-open').addEventListener('click', openSkillDrawer);
    $('button#calc-skill-close').addEventListener('click', closeSkillDrawer);
    backdrop.addEventListener('click', closeSkillDrawer);

    // 状态与条件抽屉（右侧抽拉式：原来平铺在「基础数值」卡片里，条件变多后太占地方）
    const condDrawer = $('aside#calc-cond-drawer');
    const condBackdrop = $('div#calc-cond-backdrop');
    const condBtn = $('button#calc-cond-open');
    function openCondDrawer() {
      condDrawer.hidden = false; condBackdrop.hidden = false;
      requestAnimationFrame(() => { condDrawer.classList.add('open'); condBackdrop.classList.add('open'); });
    }
    function closeCondDrawer() {
      condDrawer.classList.remove('open'); condBackdrop.classList.remove('open');
      setTimeout(() => { condDrawer.hidden = true; condBackdrop.hidden = true; }, 260);
    }
    // 抽屉关着也要看得出当前生效的条件（不然用户不知道伤害是怎么算出来的）
    function updateCondSummary() {
      const span = $('span#calc-cond-summary');
      if (!span) return;
      const linked={apexSoulReady:'custom_apex_soul',encouragement:'HunterSkill_170',ailment:'HunterSkill_171'};
      const on = COND_LABELS.filter((x) => !!state[x[0]]&&(!linked[x[0]]||state.skillLevels[linked[x[0]]]>0)).map((x) => x[1]);
      span.textContent = on.length ? on.join(' · ') : '未设置条件';
      span.classList.toggle('on', on.length > 0);
      const btn = $('button#calc-cond-open');
      if (btn) btn.textContent = on.length ? `状态与条件（${on.length}）` : '状态与条件';
    }
    condBtn.addEventListener('click', openCondDrawer);
    $('button#calc-cond-close').addEventListener('click', closeCondDrawer);
    condBackdrop.addEventListener('click', closeCondDrawer);
    updateCondSummary();

    // 旋律抽屉（右侧抽拉式：用户 2026-09-30「开始的旋律不是单选，可以多选，做成右侧抽拉式」）
    const melDrawer = $('aside#calc-melody-drawer');
    const melBackdrop = $('div#calc-melody-backdrop');
    function openMelodyDrawer() {
      melDrawer.hidden = false; melBackdrop.hidden = false;
      requestAnimationFrame(() => { melDrawer.classList.add('open'); melBackdrop.classList.add('open'); });
    }
    function closeMelodyDrawer() {
      melDrawer.classList.remove('open'); melBackdrop.classList.remove('open');
      setTimeout(() => { melDrawer.hidden = true; melBackdrop.hidden = true; }, 260);
    }
    $('button#calc-melody-open').addEventListener('click', openMelodyDrawer);
    $('button#calc-melody-close').addEventListener('click', closeMelodyDrawer);
    melBackdrop.addEventListener('click', closeMelodyDrawer);

    // 道具 / 餐点抽屉（右侧抽拉式：原来折在卡片里，条数多了太占地方）
    const itemDrawer = $('aside#calc-item-drawer');
    const itemBackdrop = $('div#calc-item-backdrop');
    function openItemDrawer() {
      itemDrawer.hidden = false; itemBackdrop.hidden = false;
      requestAnimationFrame(() => { itemDrawer.classList.add('open'); itemBackdrop.classList.add('open'); });
    }
    function closeItemDrawer() {
      itemDrawer.classList.remove('open'); itemBackdrop.classList.remove('open');
      setTimeout(() => { itemDrawer.hidden = true; itemBackdrop.hidden = true; }, 260);
    }
    $('button#calc-item-open').addEventListener('click', openItemDrawer);
    $('button#calc-item-close').addEventListener('click', closeItemDrawer);
    itemBackdrop.addEventListener('click', closeItemDrawer);
    $('button#calc-item-clear').addEventListener('click', () => {
      state.itemPicks = {};
      buildItemSelectors();   // 重画（下拉回到「不使用」）
      recalc();
    });

    // 自绘选择器：关闭
    $('button#calc-picker-close').addEventListener('click', closePicker);
    $('div#calc-picker-backdrop').addEventListener('click', closePicker);

    // 把所有原生 select 换成自绘选择器（怪物/部位/肉质状态/属性类型/斩味/招式/舞踏/受击次数）
    enhanceSelect($('select#calc-eltype'), '属性类型');
    enhanceSelect($('select#calc-sttype'), '异常类型');
    enhanceSelect($('select#calc-sharp'), '斩味');
    enhanceSelect($('select#calc-absorb'), '属性吸收受击次数');
    enhanceSelect($('select#calc-monster'), '选择怪物');
    enhanceSelect($('select#calc-quest'), '选择任务');
    enhanceSelect($('select#calc-players'), '选择人数');
    enhanceSelect($('select#calc-part'), '选择部位');
    enhanceSelect($('select#calc-meat-state'), '肉质状态');
    enhanceSelect($('select#calc-move'), '选择招式');
    $('button#calc-skill-clear').addEventListener('click', () => {
      state.skillLevels = {};
      buildSkillList();          // 重建以重置步进器显示
      renderSkillChips(); recalc();
    });
    $('input#calc-skill-search').addEventListener('input', applySkillSearch);

    // 部位 + 肉质状态
    function refreshQuestOptions() {
      const mid = String(name2id[state.monster]);
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const choices = quests.filter(q => q.targets.some(t => String(t.monsterId) === mid))
        .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
        .flatMap(q => {
          const targets = q.targets.filter(t => String(t.monsterId) === mid);
          return targets.map((t, i) => `<option value="${q.id}:${i}">${esc(questLevelLabel(q) + ' ' + questName(q))}${targets.length > 1 ? '（第' + (i + 1) + '只）' : ''}</option>`);
        });
      const sel = $('select#calc-quest');
      sel.innerHTML = '<option value="">未选择任务（基础倍率1）</option>' + choices.join('');
      state.quest = ''; state.players = 1; sel.value = ''; syncPicker(sel);
      refreshPlayerOptions();
    }
    function refreshPlayerOptions() {
      const [id, index] = state.quest.split(':');
      const sc = questScarRawOf(state.monster, id, Number(index) || 0, 1);
      const max = state.quest && sc.valid ? sc.maxPlayers : 1;
      state.players = Math.min(max, Math.max(1, state.players));
      const sel = $('select#calc-players');
      sel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}人</option>`).join('');
      sel.value = String(state.players); sel.disabled = max === 1; syncPicker(sel);
      refreshScarRawNote();
    }
    function refreshScarRawNote() {
      const el = $('div#calc-scarraw-note');
      if (!el) return;
      const sc = scarRawOf();
      const shown = v => Number(v).toFixed(2);
      el.textContent = sc.valid
        ? (state.quest ? '' : '未选择任务，爆伤口使用基础倍率 · ') + 'Scar Raw ' + shown(sc.questRaw)
          + (sc.playerRate !== 1 ? ' × 人数倍率 ' + shown(sc.playerRate) + ' = ' + shown(sc.raw) : '')
          + (sc.legendary ? ' · 默认历战伤口 ×1.3（可逐招选择）' : '')
        : sc.reason + '，不计爆伤口伤害';
    }
    function refreshParts() {
      const m = selectedMonster();
      const partSel = $('select#calc-part');
      partSel.innerHTML = (m ? m.parts : []).map((p) => `<option value="${p.key}">${partName(m.name, p.key)}</option>`).join('');
      state.part = (m && m.parts[0]) ? m.parts[0].key : '';
      state.meatIdx = 0;
      syncPicker(partSel);
      refreshMeatStates();
    }
    function refreshMeatStates() {
      const part = selectedPart();
      const sel = $('select#calc-meat-state');
      const list = part ? meatStates(part.raw) : [];
      sel.innerHTML = list.map((s, i) => `<option value="${i}">${s.label}</option>`).join('');
      state.meatIdx = 0;
      sel.value = '0';
      syncPicker(sel);
      refreshMeatHint();
    }
    function refreshMeatHint() {
      refreshScarRawNote();
      const part = selectedPart();
      const hint = $('div#calc-meat-hint');
      if (!part) { hint.textContent = '该怪物无肉质数据'; return; }
      const m = currentMeat() || {};
      const st = $('select#calc-meat-state');
      const label = st && st.selectedIndex >= 0 && st.options[st.selectedIndex] ? st.options[st.selectedIndex].textContent : '';
      // 只列斩/打/弹三种肉质 + 属性吸收（面板选「无」属性时不写属性那一项）
      hint.textContent = `${label}：斩 ${m.Slash ?? '—'} · 打 ${m.Blow ?? '—'} · 弹 ${m.Shot ?? m.Bullet ?? '—'}`
        + (state.elementType === 'None' ? '' : ` · ${EL_CN[state.elementType] || state.elementType}属性吸收 ${m[state.elementType] ?? '—'}`);
    }

    // 怪物发怒（用户 2026-10-08）：从「状态与条件」挪到「怪物 / 部位」栏；勾上后按数据库的受击倍率
    //   （AngryTable.PlDamage，player dmg）算最终伤害，并把「发怒前 → 发怒后」的倍率写在同栏
    function refreshEnrageNote() {
      const el = $('div#calc-enrage-note');
      if (!el) return;
      const r = enrageRateOf(state.monster);
      const on = r ? r.max : 1;
      el.textContent = '受击倍率 ×1.00 → ×' + on.toFixed(2) + (state.monsterEnraged ? '（发怒中）' : '');
    }
    {
      const cb = $('input#calc-enrage');
      if (cb) cb.addEventListener('change', () => { state.monsterEnraged = cb.checked; refreshEnrageNote(); recalc(); });
      refreshEnrageNote();
    }

    $('select#calc-monster').addEventListener('change', (e) => { state.monster = e.target.value; refreshParts(); refreshQuestOptions(); refreshEnrageNote(); recalc(); });
    $('select#calc-quest').addEventListener('change', (e) => { state.quest = e.target.value; refreshPlayerOptions(); refreshComboUI(); });
    $('select#calc-players').addEventListener('change', (e) => { state.players = Number(e.target.value) || 1; refreshScarRawNote(); refreshComboUI(); });
    $('select#calc-part').addEventListener('change', (e) => { state.part = e.target.value; refreshMeatStates(); recalc(); });
    $('select#calc-meat-state').addEventListener('change', (e) => { state.meatIdx = Number(e.target.value) || 0; refreshMeatHint(); refreshEnrageNote(); recalc(); });

    // 连段
    $('input#calc-derive-toggle').addEventListener('change', (e) => {
      state.deriveMode = e.target.checked;
      refreshComboUI();
    });
    $('button#calc-add').addEventListener('click', () => {
      const moveId = $('select#calc-move').value;
      if (!moveId) return;
      const move = moveOf(moveId);
      const lvs = move ? levelsOf(move) : null;
      state.combo.push({
        moveId,
        ...(move?.skipPrefixAfter && state.combo.at(-1)?.moveId === move.skipPrefixAfter && state.combo.at(-1)?.wound ? {wound:true} : {}),
        ...(state.weaponId === 'dual_blades' ? { dbMode: dbModeOf(state.combo.at(-1), move) } : {}),
        charge: lvs ? defaultLevelOf(move) : ((move && move.chargeable) ? 2 : null),
        ...(move && move.spin ? { spin: move.spin['default'] } : {}),
        // 长枪力防：力量格挡插入时按数据层默认层数（默认 3）落一份，后续可在行内改
        ...(move && move.forceGuardBuff ? { forceGuard: Number(move.forceGuardBuff['default'] || 0) } : {})
      });
      refreshComboUI();
    });
    $('button#calc-combo-clear').addEventListener('click', () => { state.combo = []; refreshComboUI(); });

    refreshParts();
    refreshQuestOptions();
    buildItemSelectors();
    buildSkillList();
    renderSkillChips();
    renderCombo();
    refreshMoveOptions();
    setupPresets();
    recalc();
  }

  // 页脚联系/勘误按钮
  const footerBtn = document.getElementById('footer-contact');
  const footerInfo = document.getElementById('footer-contact-info');
  if (footerBtn && footerInfo) {
    footerBtn.addEventListener('click', () => { footerInfo.hidden = !footerInfo.hidden; });
  }

  // 初始视图
  showView('monsters');

  // 测试/诊断句柄（不影响正常使用）
  window.__MHWILD_DEBUG__ = { monsters, quests, questScarRawOf, renderMonsterDetail, renderQuestDetail, renderCalculatorView, openMonster, openQuest, fmt, hzvClass };
})();

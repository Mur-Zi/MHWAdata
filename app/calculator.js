/* Monster Hunter Wilds 伤害计算器 —— 引擎（vanilla JS，无框架/无构建）
 *
 * 公式（已与用户确认，1.021 基准）：
 *   物理 = 真实攻击力 × (动作值/100) × (肉质/100) × 会心补正 × 斩味物理补正 × 技能乘区
 *   属性 = (属性显示值/10) × 属补(elemRate) × (属性肉质/100) × 属性会心 × 斩味属性补正 × 技能乘区
 *   异常 = 异常显示值 × 异常补正(statusRate) × (1/3) × 技能乘区
 *   晕厥 = 招式晕厥值 × 技能乘区
 *
 * 口径约定（务必遵守）：
 *   - 攻击力只算真实攻击力，不做武器倍率（bloat）换算。输入「真实攻击力」即直接用。
 *   - 会心：正会心 1.25（超会心 1.28/1.31/1.34/1.37/1.40），负会心恒为 0.75（不受超会心影响）。
 *   - 属性显示值 ÷10 得到真实属性后再参与计算；异常显示值不 ÷10。
 *   - 异常每次命中按 1/3 概率触发（期望值 ×1/3）。
 *
 * 招式数据（ig_moves.json）hit 字段：mv=动作值, elemRate=属补(属性补正/列64),
 *   statusRate=异常补正(列65), stun=晕厥值, type=SLASH/BLOW(棍子)。猎虫(NONE)另算，暂未建模。
 *   sharpCost=耗斩(列61 CustomKireajiReduce，10=面板1斩味=历代1刀；列60=0 时默认10)，
 *   noSharp=禁用斩味(列58 IsNoUseKireaji：不耗斩味且斩补无效)。
 *
 * 待确认点（实现中显式标注为 approximation）：
 *   - 蓄力(0/1/2)倍率仅作用于物理(动作值)；(属性/异常是否随蓄力变化待确认)
 *   - 舞踏倍率作用于物理+属性；(异常是否受舞踏影响待确认)
 *   - 飞燕按数据表列39 IsSkillHien 逐 hit 标记应用（直接乘在动作值上），
 *     只有被标记的 hit 吃加成：飞身跃入斩/回避斩/飞圆斩/飞天螺旋斩(棍段)/
 *     集中转翔突刺/空中集中转翔突刺/强化急袭斩(前5刀)/急袭突刺(仅第1刀)；
 *     跳跃斩、跳跃突进斩等空中招式反而没有标记，不吃飞燕
 *   - 连击(chain)按连段内命中序号近似取档位（真实需帧数/时间窗，帧数待填）
 *   - 属性吸收/属性变换 的加值单位按「显示值」处理（与 elemFlat 一致）
 *   - 技能加算/乘算顺序按说明文案「变为X倍后，+Y」实现为 (基础×Π乘算)+Σ加算
 */
(function (global) {
  'use strict';

  // ===================== 常量 =====================
  const CRIT_BASE = 1.25;        // 正会心基础补正
  const CRIT_NEG = 0.75;         // 负会心补正（不受超会心影响）
  const STATUS_PROC = 1 / 3;     // 异常触发概率
  const ELEMENT_CAP_RATE = 2.3;  // 属性值上限：基础面板属性值的 2.3 倍
  const ELEMENT_CAP_MIN = 400;   // 属性值上限的另一条线：基础 + 400（取两者较高）
  const ELEMENT_TYPES = ['Fire', 'Water', 'Thunder', 'Ice', 'Dragon'];

  // 全部 14 种武器（damageType 决定吃哪种肉质：切/打/弹）
  // 招式数据：操虫棍用逐条核对过的 ig_moves.json；其余武器来自《MHWS 1.021 动作值》各武器表
  const WEAPONS = [
    { id: 'great_sword', name: '大剑', damageType: 'Slash' },
    { id: 'sword_and_shield', name: '片手剑', damageType: 'Slash' },
    { id: 'dual_blades', name: '双剑', damageType: 'Slash' },
    { id: 'long_sword', name: '太刀', damageType: 'Slash' },
    { id: 'hammer', name: '大锤', damageType: 'Blunt' },
    { id: 'hunting_horn', name: '狩猎笛', damageType: 'Blunt' },
    { id: 'lance', name: '长枪', damageType: 'Slash' },
    { id: 'gunlance', name: '铳枪', damageType: 'Slash' },
    { id: 'switch_axe', name: '斩击斧', damageType: 'Slash' },
    { id: 'charge_blade', name: '盾斧', damageType: 'Slash' },
    { id: 'insect_glaive', name: '操虫棍', damageType: 'Slash' },
    { id: 'bow', name: '弓', damageType: 'Shot' },
    { id: 'heavy_bowgun', name: '重弩', damageType: 'Shot' },
    { id: 'light_bowgun', name: '轻弩', damageType: 'Shot' }
  ];

  const DEFAULT_SHARPNESS = {
    red:    { raw: 0.50, element: 0.25 },
    orange: { raw: 0.75, element: 0.50 },
    yellow: { raw: 1.00, element: 0.75 },
    green:  { raw: 1.05, element: 1.00 },
    blue:   { raw: 1.20, element: 1.0625 },
    white:  { raw: 1.32, element: 1.15 },
    purple: { raw: 1.39, element: 1.25 }   // 荒野无紫斩，仅完整性保留
  };

  const SHARPNESS_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'purple'];
  const SHARPNESS_CN = { red: '红', orange: '橙', yellow: '黄', green: '绿', blue: '蓝', white: '白', purple: '紫' };

  // ===================== 工具 =====================
  function n(v, fb) { const x = Number(v); return Number.isFinite(x) ? x : (fb === undefined ? 0 : fb); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // 该 hit 在当前灯态下的动作值：hit.mv = 非三灯（表内基准），hit.mvLamp = 三灯
  function hitMv(hit, threeLamp) {
    return (threeLamp && hit && hit.mvLamp != null) ? n(hit.mvLamp) : n(hit && hit.mv);
  }

  // ===================== 技能解析 =====================
  // 按武器分组取第 L 级的值（groups: [{weapons:[...], values:[...]}, {weapons:['*'], ...}]）
  function groupValue(groups, weaponId, level) {
    if (!Array.isArray(groups) || !groups.length) return null;
    const idx = (level - 1);
    for (const g of groups) {
      const ws = g.weapons || [];
      if (ws.includes(weaponId) || ws.includes('*')) {
        const v = (g.values || [])[idx];
        if (typeof v === 'number') return v;
      }
    }
    return null;
  }

  // 条件判断（skill 级 condition 与 effect 级 condition 共用）
  function conditionActive(cond, ctx) {
    if (!cond || cond === 'ALWAYS') return true;
    const c = ctx || {};
    switch (cond) {
      case 'weak_spot': case 'WEAK_SPOT': return !!c.weakSpot;
      case 'wound': return !!c.wound;
      case 'enraged': case 'MONSTER_ENRAGED': return !!c.monsterEnraged;
      case 'full_hp': case 'FULL_HEALTH': return !!c.fullHealth;
      case 'guard': return !!c.guard;
      case 'ailment': return !!c.ailment;
      case 'apex_soul_ready': return c.apexSoulReady!==false;
      case 'encouragement': return !!c.encouragement;
      case 'low_hp': case 'LOW_HEALTH': return !!c.lowHealth;
      // 斩味条件（钝器能手）：当前斩味颜色 ≤ 黄 / ≤ 绿（红<橙<黄<绿<蓝<白）
      case 'sharpness_max_yellow': return sharpnessRank(c.sharpness) <= SHARPNESS_ORDER.indexOf('yellow');
      case 'sharpness_max_green': return sharpnessRank(c.sharpness) <= SHARPNESS_ORDER.indexOf('green');
      // 本计算器没有对应输入的招式/任务条件：默认不生效（数值仍记在数据里）
      case 'draw_attack': return !!c.drawAttack;              // 拔刀术【力】：只对拔刀攻击生效
      case 'quest_time_10': return !!c.questTime10;           // 钻研：任务经过 10 分钟
      case 'quest_time_20': return !!c.questTime20;
      case 'quest_time_30': return !!c.questTime30;
      case 'clash': return !!c.clash;                         // 角力/抵消成功（辟兽之力、冻峰龙之反叛）
      case 'overcome_frenzy': return !!c.overcomeFrenzy;      // 克服狂龙症（黑蚀龙之力）
      case 'chain': return !!c.chainActive;                   // 连击发动中（凶爪龙之力）—— 选了「连击」技能即视为发动
      case 'wet': return !!c.wet;                             // 湿润状态（浸水刃纹）
      case 'bubble': return !!c.bubble;                       // 泡沫状态（浸水刃纹）
      case 'ate_meat': return !!c.ateMeat;                    // 食用烤熟的肉等道具后（暗器蛸之力/蛮勇之食桌）
      case 'dodge_evade': return !!c.dodgeEvade;              // 巧击发动中回避成功（千刃龙的斗志）
      case 'festival': return !!c.festival;                   // 祭典期间（大地之恩惠）
      case 'war_cry': return !!c.warCry;                      // 肢体动作「咆哮」后（雪狮子王之斗志/ウォークライ）
      // ↓ 本计算器没有对应输入、也暂时不打算做的条件：**一律不生效**（数值仍记在数据里，
      //   界面会把这些技能列到「未计入」提示里）；不放在 default 里是为了避免打错条件名就静默生效
      case 'meat_raw': case 'meat_cooked': case 'meat_burnt': return false;   // 炎之大厨：烤肉熟度
      case 'ore_input': return false;                                          // 能量石：矿石种类
      case 'resist_input': return false;                                       // 耐性变换：耐性值
      case 'baked_corn': return false;                                         // 烧烤玉米炮：放热状态
      case 'extra_proc': return false;                                         // 白炽奔流：概率追加伤害
      case 'value_unconfirmed': return false;                                  // 饭团：hasmine 数值待确认
      case 'gunlance_only': case 'charge_axe_only': return false;              // 武器专属招式条件
      default: return true; // 未建模条件默认放行，避免静默丢伤害
    }
  }
  // 上面这些「没有对应输入」的条件：供界面提示用（选了这些技能时会注明未计入）
  const UNSUPPORTED_CONDITIONS = ['draw_attack', 'quest_time_10', 'quest_time_20', 'quest_time_30',
    'wet', 'bubble', 'meat_raw', 'meat_cooked', 'meat_burnt', 'ore_input', 'resist_input',
    'baked_corn', 'extra_proc', 'value_unconfirmed', 'gunlance_only', 'charge_axe_only'];
  const CONDITION_LABEL = {
    draw_attack: '只对拔刀攻击生效', quest_time_10: '需要任务经过 10 分钟',
    quest_time_20: '需要任务经过 20 分钟', quest_time_30: '需要任务经过 30 分钟',
    wet: '需要湿润状态', bubble: '需要泡沫状态',
    meat_raw: '需要烤肉的熟度', meat_cooked: '需要烤肉的熟度', meat_burnt: '需要烤肉的熟度',
    ore_input: '需要矿石种类输入', resist_input: '需要耐性值输入',
    baked_corn: '需要放热状态（铳枪）', extra_proc: '概率追加伤害（未建模）',
    value_unconfirmed: '数值待确认', gunlance_only: '铳枪专属', charge_axe_only: '盾斧专属'
  };
  // 斩味颜色的档位（red=0 … white=5）
  // 支持三种入参：字符串键（'white'，界面用）、带 name 的对象、只有补正值的对象（按 raw 反查）
  function sharpnessRank(sharp) {
    if (sharp == null) return SHARPNESS_ORDER.indexOf('green');
    if (typeof sharp === 'string') {
      const i = SHARPNESS_ORDER.indexOf(sharp);
      return i >= 0 ? i : SHARPNESS_ORDER.indexOf('green');
    }
    if (sharp.name) {
      const i = SHARPNESS_ORDER.indexOf(sharp.name);
      if (i >= 0) return i;
    }
    if (sharp.raw != null) {
      for (let i = 0; i < SHARPNESS_ORDER.length; i++) {
        const s = DEFAULT_SHARPNESS[SHARPNESS_ORDER[i]];
        if (s && Math.abs(n(s.raw) - n(sharp.raw)) < 1e-9) return i;
      }
    }
    return SHARPNESS_ORDER.indexOf('green');
  }

  // 应用选中技能 → 汇总状态
  function applySkills(base, selectedSkills, weaponId, ctx) {
    const frenzyCov = Number.isFinite(ctx?.overcomeFrenzyCoverage)
      ? clamp(ctx.overcomeFrenzyCoverage, 0, 100) / 100 : ((ctx && ctx.overcomeFrenzy) ? 1 : 0);
    const st = {
      // 「攻击」技能改的是**基础攻击力**；其余攻击类技能是加在最终攻击力上的条件加成
      baseAttackFlat: 0, baseAttackPct: 1, baseAttackBonusPct: 0,
      attackFlat: 0, attackPct: 1, attackFromBasePct: 0,
      elementFlat: 0, elementPct: 1,        // 显示值口径
      statusFlat: 0, statusPct: 1,          // 显示值口径
      affinity: n(base.affinity),
      weakSpotAffinity: 0,                  // 弱点特效：仅肉质>45 的 hit 生效（逐刀判定）
      woundAffinity: 0,                     // 弱点特效：命中伤口时生效
      critMult: CRIT_BASE,                  // 超会心
      elementCritMult: 1.0,                 // 会心击【属性】
      statusCritMult: 1.0,                  // 会心击【特殊】
      airborneMult: 1.0,                    // 飞燕
      chargeElemMult: 1.0, chargeStatusMult: 1.0, // 蓄力大师
      convertElemMult: 1.0, convertStatusMult: 1.0, // 因祸得福
      absorbElemFlat: 0,                    // 属性吸收（显示值）
      dragonElemFlat: 0,                    // 属性变换（显示值）
      chain: null,                          // 连击 {attack:[], element:[]}
      stunMult: 1.0,                        // 击晕术
      morphMvPct: 1.0,                      // 盾斧高速变形：变形类招式动作值乘算（属补不变）
      impactPhialPct: 1.0,                  // 盾斧炮术：榴弹瓶瓶爆乘算（只对榴弹瓶）
      gunlanceArtyMul: 1.0,                 // 铳枪炮术：炮击系固伤乘算（倍率，作用于基础攻击力）
      gunlanceArtyAdd: 0,                   // 铳枪炮术：炮击系附带火属性加算（估算器 skill_data!J3，**不进固伤**）
      gunlanceShellAdd: 0,                  // 炮弹装填（增弹）：铳枪装填数加值（估算器 read me!I3 = 有 → +1）
      gunlanceChargeAccel: 1.0,             // 铳枪炮术：蓄力加速（帧数用，本计算器不参与伤害）
      blueDemon: null,                      // 双刀蓝鬼 { attackBaseMul, elementBaseAdd }；非双刀恒为 null
      frenzyAffinity: 0,                    // 无我之境（克服后）
      woundBurstPct: 1.0                    // 破坏王（用户 2026-10-08）：只加「集中处决爆伤口」伤害（每级 +10%）
    };

    // 「连击发动中」这类条件由已选技能自动推导（凶爪龙之力：连击技能效果发动时 基础攻击力+3/+10）
    // 不能依赖技能处理顺序，所以先扫一遍已选技能
    const ctxEff = Object.assign({}, ctx || {});
    if (!ctxEff.chainActive) {
      ctxEff.chainActive = (selectedSkills || []).some(function (sel) {
        const s = sel && (sel.skill || sel);
        return s && s.id === 'HunterSkill_114' && n(sel.level, 1) > 0;
      });
    }

    // 选了但「本计算器算不出来」的技能：记下来给界面提示（不静默）
    const skillNotes = [];
    const noteOnce = function (name, reason) {
      if (!name || !reason) return;
      if (!skillNotes.some(function (x) { return x.name === name; })) skillNotes.push({ name: name, reason: reason });
    };

    // 互斥技能组（如欧米茄共鸣的两套护甲【远】/【近】）：同组只算一个
    // 界面侧已做「选一个就把同组清零」，这里再兜一层，避免两份数据同时乘算
    const exclusiveSeen = {};
    const activeSkills = (selectedSkills || []).filter(function (sel) {
      const s = sel && (sel.skill || sel);
      const grp = s && s.exclusiveGroup;
      if (!grp || n(sel.level, 1) <= 0) return true;
      if (exclusiveSeen[grp]) {
        noteOnce(s.name, '与同组的另一项互斥（同一套装备的两种护甲），本项未计入');
        return false;
      }
      exclusiveSeen[grp] = true;
      return true;
    });

    activeSkills.forEach(function (sel) {
      const skill = sel.skill || sel;
      const level = n(sel.level, 1);
      if (!skill || !Array.isArray(skill.levels)) return;
      const lv = skill.levels.find(function (x) { return n(x.level) === level; });
      if (!lv) return;
      // 覆盖率（用户 2026-10-06）：技能效果的**期望值**折算 —— 只有数据层标了 coverage 的技能吃这个开关
      //   （防具技能 / 套装技能 / 心眼），默认 100%；未标 coverage 的技能恒为 1（行为不变）。
      //   加法类效果 × 覆盖率（+30% 会心 × 80% = +24%）；乘法类效果折算成 1+(v−1)× 覆盖率（×1.05 @80% → ×1.04）
      const cov = skill.id === 'HunterSkill_183' && level === 4 && Number.isFinite(ctx?.overcomeFrenzyCoverage)
        ? frenzyCov : (skill.coverage ? clamp(n(sel.coverage, 100), 0, 100) / 100 : 1);
      const covFlat = function (v) { return n(v) * cov; };
      const covMult = function (v, d) { return 1 + (n(v, d) - 1) * cov; };

      // 技能级条件（如挑战者=enraged、无伤=full_hp）
      // 例外：weak_spot 已改为「按命中部位肉质逐刀判定」，此处不拦
      if (skill.condition && skill.condition !== 'weak_spot' && !conditionActive(skill.condition, ctxEff)) {
        if (UNSUPPORTED_CONDITIONS.indexOf(skill.condition) >= 0) {
          noteOnce(skill.name, CONDITION_LABEL[skill.condition] || '条件未支持');
        }
        return;
      }

      // 武器专属技能：只有列表里的武器能用（如攻击守势需要格挡，操虫棍没盾）
      // 盾斧：高速变形这类技能对斩击斧是攻击力乘算、对盾斧是动作值乘算 → 允许「按效果指定武器」
      const effWeaponsOk = (lv.effects || []).some(function (e) { return Array.isArray(e.weapons) && e.weapons.indexOf(weaponId) >= 0; });
      if (Array.isArray(skill.weapons) && skill.weapons.indexOf(weaponId) < 0 && !effWeaponsOk) return;

      // 属性/异常强化技能：只在与面板所选类型一致时生效（火武器不吃冰属性强化）
      if (skill.elementType && skill.elementType !== base.elementType) return;
      if (skill.statusType && skill.statusType !== base.statusType) return;

      // 霸主之魂与三灯同源：取基础攻击力的5%作为末端加值。
      // 按技能ID处理，兼容已缓存的旧数据标记，避免再次落入基础乘区或独立倍率。
      if (skill.id === 'custom_apex_soul') { st.attackFromBasePct += covFlat(.05); return; }

      // 需要面板有属性 / 有异常的技能（用户拍板：属性武器不享受会心击【特殊】）
      const hasElem = (base.elementType !== 'None') && ELEMENT_TYPES.indexOf(base.elementType) >= 0;
      if (skill.requireElement && !hasElem) return;
      if (skill.requireStatus && base.statusType === 'None') return;

      if (!(lv.effects || []).length && !['chain','frenzy','goreWeighted'].includes(lv.special?.type)) noteOnce(skill.name, '本计算器不计算这项效果');
      (lv.effects || []).forEach(function (e) {
        // 效果级武器过滤（盾斧高速变形：对盾斧是「变形类招式动作值 ×1.05/1.1/1.2」）
        if (Array.isArray(e.weapons) && e.weapons.indexOf(weaponId) < 0) return;
        // 弱点特效的两条加成改由 calcHit 逐刀判定（肉质>45 / 命中伤口），此处只归类
        //   覆盖率按期望折算（用户例子：弱点特效 Lv5 会心 +30%、覆盖率 80% → +24%）
        if (e.condition === 'weak_spot') { if (e.type === 'affinity') st.weakSpotAffinity += covFlat(e.value); return; }
        if (e.condition === 'wound') { if (e.type === 'affinity') st.woundAffinity += covFlat(e.value); return; }
        if (!conditionActive(e.condition, ctxEff)) {
          if (UNSUPPORTED_CONDITIONS.indexOf(e.condition) >= 0) {
            noteOnce(skill.name, CONDITION_LABEL[e.condition] || '条件未支持');
          }
          return;
        }
        // 加基础攻击力：只有文案写明「基础攻击力」的效果（effect.baseAttack）或整技能标了 baseAttack
        const isBase = e.baseAttack === true || skill.baseAttack === true;
        switch (e.type) {
          case 'baseAtkBonusPct': st.baseAttackBonusPct+=covFlat(e.value);break;
          case 'atkFlat':
            if (isBase) st.baseAttackFlat += covFlat(e.value); else st.attackFlat += covFlat(e.value);
            break;
          case 'atkPct':
            if (isBase) st.baseAttackPct *= covMult(e.value, 1); else st.attackPct *= covMult(e.value, 1);
            break;
          case 'affinity':  st.affinity += covFlat(e.value); break;
          case 'critMult':  st.critMult = covMult(e.value, CRIT_BASE); break;
          case 'elemPct':   st.elementPct *= covMult(e.value, 1); break;
          case 'elemFlat':  st.elementFlat += covFlat(e.value); break;
          case 'statusPct': st.statusPct *= covMult(e.value, 1); break;
          case 'statusFlat': st.statusFlat += covFlat(e.value); break;
          case 'stunPct':   st.stunMult *= covMult(e.value, 1); break;
          case 'airborneMult': st.airborneMult *= covMult(e.value, 1); break;
          // 盾斧高速变形：变形类招式（剑↔斧）**只加动作值**，不加属补（用户拍板）
          case 'morphMvPct': st.morphMvPct *= covMult(e.value, 1); break;
          // 盾斧炮术：**只加榴弹瓶瓶爆**（不影响招式伤害、也不影响强属性瓶 —— 用户拍板）
          case 'impactPhialPct': st.impactPhialPct *= covMult(e.value, 1); break;
          // 破坏王（用户 2026-10-08）：只加「集中处决爆伤口」的伤害（每级 +10%）
          case 'woundBurstPct': st.woundBurstPct *= covMult(e.value, 1); break;
          // 铳枪炮术：只作用于**炮击系固伤**（不吃肉质/会心/斩味；不影响物理招式）
          //   系数 = 基础攻击力 × 倍率 + 加算（估算器 skill_data!K1 = C2*G3*I15+D2）
          case 'artyMul': st.gunlanceArtyMul *= covMult(e.value, 1); break;
          case 'artyAdd': st.gunlanceArtyAdd += covFlat(e.value); break;
          case 'artyChargeAccel': st.gunlanceChargeAccel *= covMult(e.value, 1); break;
          // 炮弹装填：铳枪**装填数 +1**（用户 2026-10-01「增弹要」）
          //   作用面 = 全弹发射的发数（估算器 act_data!R5 = 1 时 B10 = 基础弹药量 + 1）
          //   weapons 过滤在 effects 循环入口已经做过（非铳枪直接跳过本效果）
          case 'shellCapacityAdd': st.gunlanceShellAdd += covFlat(e.value); break;
        }
      });

      // 特殊技能（按 weaponGroups 取武器分组值）
      if (lv.special) {
        const sp = lv.special;
        switch (sp.type) {
          case 'crit_element':
            st.elementCritMult = groupValue(base.weaponGroups && base.weaponGroups.crit_element, weaponId, level) || st.elementCritMult;
            break;
          case 'crit_status':
            st.statusCritMult = groupValue(base.weaponGroups && base.weaponGroups.crit_status, weaponId, level) || st.statusCritMult;
            break;
          case 'charge_master': {
            const v = groupValue(base.weaponGroups && base.weaponGroups.charge_master, weaponId, level);
            if (v) { st.chargeElemMult = v; st.chargeStatusMult = v; }
            break;
          }
          case 'convert': { // 因祸得福：属性 + 异常双加成
            const ve = groupValue(base.weaponGroups && base.weaponGroups.convert_elem, weaponId, level);
            const vs = groupValue(base.weaponGroups && base.weaponGroups.convert_status, weaponId, level);
            if (ve) st.convertElemMult = ve;
            if (vs) st.convertStatusMult = vs;
            break;
          }
          case 'absorb_elem': { // 属性吸收：等级决定首击加值，后续每次受击+10（至多+20）
            const v = groupValue(base.weaponGroups && base.weaponGroups.absorb_elem, weaponId, level);
            if (v) {
              const hits = clamp(n(ctx && ctx.absorbHits, 1), 1, 3); // 受击次数 1/2/3
              st.absorbElemFlat += v + 10 * Math.min(hits - 1, 2);
            }
            break;
          }
          case 'dragon_elem': { // 属性变换：加龙属性显示值
            const arr = base.weaponGroups && base.weaponGroups.dragon_elem;
            const v = Array.isArray(arr) ? arr[level - 1] : null;
            if (typeof v === 'number') st.dragonElemFlat += v;
            break;
          }
          case 'chain': { // 连击：前4击档0(+5/+50)，第5击起档level(Lv1-5)
            const g = base.weaponGroups && base.weaponGroups.chain && base.weaponGroups.chain[weaponId];
            if (g) { st.chain = { attack: g.attack || null, element: g.element || null }; st.chainLevel = level;st.attackFlat+=n(g.attack?.[0])*(1-cov)+n(g.attack?.[level])*cov;st.elementFlat+=n(g.element?.[0])*(1-cov)+n(g.element?.[level])*cov; }
            break;
          }
          case 'goreWeighted': {
            st.attackFlat += 10*(1-cov)+15*cov;
            break;
          }
          case 'frenzy': { // 无我之境：克服后会心 +3/6/10
            st.frenzyAffinity += level*5*frenzyCov;
            break;
          }
          case 'charge_boost': // 蓄击强化（仅大锤）：晕厥×1.3
            st.stunMult *= 1.3;
            break;
        }
      }
    });

    st.affinity += st.frenzyAffinity + 10*frenzyCov;
    st.affinity = clamp(st.affinity, -100, 100);
    st.skillNotes = skillNotes;   // 选了但本计算器算不出来的技能（界面提示用）
    return st;
  }

  // 攻击力向下取整（用户拍板：攻击力舍弃小数点）
  // 先抹掉浮点噪声再取整，否则 200×0.15 = 29.999999999999996 会被 floor 成 29（应为 30）
  function floorAtk(v) { return Math.floor(Math.round(n(v) * 1e6) / 1e6); }

  // 属性值上限：max(基础面板属性值 × 2.3, 400)；基础为 0（无属性武器）时上限为 0
  function elementCap(baseElement) {
    const b = n(baseElement);
    // 近战属性值上限 = max(基础属性值 + 400, 基础属性值 × 2.3)（hasmine 口径，用户确认）
    return b > 0 ? Math.max(b + ELEMENT_CAP_MIN, b * ELEMENT_CAP_RATE) : 0;
  }

  // ===================== 猎虫（共斗虫）伤害 =====================
  // hasmine 口径（用户确认照做）：
  //   物理 = 动作值 × 虫威力倍率 × 物理倍率 × (肉质/100)
  //   属性 = 0.1 × 武器属性值 × 属性倍率 × (属性肉质/100)
  // 猎虫攻击不吃斩味、不吃技能、不吃会心，也不能会心。
  const KINSECT_BASE = 1.05;        // BASE_KINSECT_PHYSICAL_MULTIPLIER
  const KINSECT_SEVER = 1.1;        // SEVER_KINSECT_PHYSICAL_MULTIPLIER
  const KINSECT_EXTRACT = 1.5;      // EXTRACT_ATTACK_BOOST_MULTIPLIER
  const KINSECT_LINK = 1.5;         // LINK_ATTACK_PHYSICAL_MULTIPLIER
  const KINSECT_LINK_ELEM = 1.2;    // LINK_ATTACK_ELEMENT_MULTIPLIER
  const KINSECT_CHARGED = 0.7;      // CHARGED_KINSECT_REDUCTION_MULTIPLIER
  const KINSECT_DIVE = 1.5;         // DIVE_ATTACK_PHYSICAL_MULTIPLIER
  const KINSECT_FOCUS = 1.75;       // FOCUS_WEAK_POINT_PHYSICAL_MULTIPLIER

  // 虫威力倍率：查表 kinsectPowerMultiplierMasterData[威力]，武器带属性时威力 -1（下限 1）
  function kinsectPowerMult(kinsect, level, hasWeaponElement, table) {
    const arr = (kinsect && kinsect.powerByKinsectLevel) || [];
    if (!arr.length) return 1;
    const idx = clamp(n(level, 1), 1, arr.length) - 1;
    let power = n(arr[idx], 1);
    if (hasWeaponElement) power = Math.max(power - 1, 1);
    return n((table || {})[String(power)], 1);
  }

  // 物理/属性倍率：按虫种的强化特性（bonuses）与命中标签（tags）判定
  function kinsectMultipliers(kinsect, tags) {
    const t = tags || [];
    const b = (kinsect && kinsect.bonuses) || [];
    const focusWound = t.indexOf('focus_wound') >= 0;
    const tripleLinked = t.indexOf('triple_linked') >= 0;
    const linked = t.indexOf('linked') >= 0;
    const dive = t.indexOf('dive') >= 0;
    const charged = t.indexOf('charged') >= 0;
    const hasExtract = b.indexOf('EXTRACT_ATTACK_BOOST') >= 0;
    const hasLink = b.indexOf('ELEMENT_LINK_ATTACK_BOOST') >= 0;
    const hasDust = b.indexOf('DUST_ATTACK_BOOST') >= 0;
    const hasFocus = b.indexOf('FOCUS_WEAK_POINT_ATTACK_BOOST') >= 0;
    let phys = (hasFocus && focusWound) ? KINSECT_FOCUS : KINSECT_BASE;
    if (kinsect && kinsect.attackType === 'SEVER') phys *= KINSECT_SEVER;
    if (hasExtract && !tripleLinked && !focusWound) phys *= KINSECT_EXTRACT;
    if (hasLink && (linked || dive)) phys *= KINSECT_LINK;
    if ((hasLink || hasDust) && charged) phys *= KINSECT_CHARGED;
    if (hasDust && dive) phys *= KINSECT_DIVE;
    const elem = (hasLink && (linked || dive)) ? KINSECT_LINK_ELEM : 1;
    return { phys: phys, elem: elem };
  }

  // 应用道具/餐点（同组互斥由 UI 保证；此处按 effects 直接累加）
  function applyItems(st, items) {
    (items || []).forEach(function (it) {
      // 用户 2026-09-30：「力量护符加的是基础攻击力」→ 该组带 baseAttack 标记，走基础攻击力那一层
      const base = !!(it && it.baseAttack);
      (it && it.effects ? it.effects : []).forEach(function (e) {
        switch (e.target) {
          case 'rawAttack':
            if (e.type === 'add') { if (base) st.baseAttackFlat += n(e.value); else st.attackFlat += n(e.value); }
            else if (e.type === 'multiply') { if (base) st.baseAttackPct *= n(e.value, 1); else st.attackPct *= n(e.value, 1); }
            break;
          case 'elementAttack':
            if (e.type === 'add') st.elementFlat += n(e.value);
            else if (e.type === 'multiply') st.elementPct *= n(e.value, 1);
            break;
          case 'statusAttack':
            if (e.type === 'add') st.statusFlat += n(e.value);
            else if (e.type === 'multiply') st.statusPct *= n(e.value, 1);
            break;
          case 'affinity':
            st.affinity += n(e.value);
            break;
        }
      });
    });
    st.affinity = clamp(st.affinity, -100, 100);
    return st;
  }

  // 会心补正（物理）：expected 会按正/负会心分别取 1.25 / 0.75
  function rawCritMultiplier(affinity, critMult, mode) {
    const a = clamp(affinity, -100, 100) / 100;
    if (mode === 'guaranteedCrit') return critMult;
    if (mode === 'noCrit') return 1;
    // expected：负会心恒 0.75，超会心只影响正会心
    if (a >= 0) return 1 + a * (critMult - 1);
    return 1 + Math.abs(a) * (CRIT_NEG - 1); // = 1 - |a| * 0.25
  }

  // 属性/异常 会心补正（只有会心命中才触发；负会心不触发）
  function elementCritMultiplier(affinity, elemCritMult, mode) {
    const a = clamp(affinity, -100, 100) / 100;
    if (mode === 'guaranteedCrit') return elemCritMult;
    if (mode === 'noCrit') return 1;
    return 1 + Math.max(0, a) * (elemCritMult - 1);
  }

  // ===================== 铳枪炮击系（gunlance 专属） =====================
  // 口径（用户 2026-10-01 拍板 + 估算器 `荒野铳枪超级估算器ver1.10.xlsx` 公式反推）：
  //   炮击伤害 = 炮击动作值/100 × 炮击系数
  //   炮击系数 = 基础攻击力（面板×基础乘算，**不含加算**）× 炮术倍率 + 炮术加算
  //   炮术每级 +5%（1/1.05/1.1/1.15）+ 加算（0/+3/+6/+9），**炮击 / 龙杭 / 龙击炮 一律吃**（用户拍板）
  //   炮击系不吃肉质 / 不吃会心 / 不吃斩味
  //   例外（都按估算器 动作表 的公式）：
  //     · 龙杭火花（wyrmstakeSpark）：物理段**吃肉质与会心**（不吃斩味），属性段吃属性吸收
  //     · 附带火属性（用户拍板：类比笛子的属性周波 = 固伤 + 属性伤害）：
  //         属性伤害 =（表内附带火属性 + 炮术加算）× 火属性吸收/100
  //       —— 估算器里它被 read me!C13（属性吸收，默认 0）乘掉所以缓存显示 0；填了吸收才有值
  // 逐类型 × 等级的数值全部来自 _calculator_v1/gunlance_shelling.json（由 build/gen-gunlance-shelling.mjs 从估算器导出）
  //
  //   shelling.move 决定口径：
  //     shot / chargeShot / fullBurst → 动作值 = tables[type][lv-1].shellAttack，再乘 move 自己的倍率
  //        · chargeShot 的 rateMulFrom = chargeRate（1.8）
  //        · fullBurst 的 countFrom = shellsDefault（装填发数），rateMulFrom = fullBurstRate（全弹补正）
  //     wyvernfire  → 动作值 = wyvernfireAttack（**已含龙击炮自己的系数**，不再乘任何倍率）
  //     wyrmstake  → 动作值 = wyrmstakeAttack（连装第 2 发的 ×1.1 由数据层 tank 系数一次性折进表内）
  //                  并且吃「龙杭全弹补正」（只有挂在 龙杭全弹/连装/集中派生 招式上时 ammoIndex = ammoUsed+1）
  //     wyrmstakeSpark → 龙杭火花：段数由数据层的 sparkCount 给（9 / 15），物理段吃肉质×会心（动作表!F17/F18）
  function calcShelling(p) {
    const s = p.shelling || {};
    const table = (p.shellTable && p.shellTable.tables) ? p.shellTable.tables : null;
    const cfg = (p.shellTable && p.shellTable.typeConfig) ? p.shellTable.typeConfig : null;
    if (!table || !cfg) {
      // 没接炮击表 → 不静默按 0：标 unavailable，界面提示「未计入」
      return { shelling: true, unavailable: true, raw: 0, element: 0, fire: 0, total: 0, mv: 0, coeff: 0, count: 0 };
    }
    const rows = table[p.shellType] || table.normal || [];
    const c = cfg[p.shellType] || cfg.normal || {};
    // 等级行：由用户选的炮击等级决定（数据层 hit 里那个 levelRow 只是占位，运行时按等级取）
    const lv = clamp(n(p.shellLevel, 1), 1, rows.length);
    const row = rows[lv - 1] || {};
    const moveKey = s.move || 'shot';
    // 炮击系数（**与估算器 skill_data!K1 / I1 完全同口径**，用户 2026-10-01 要求「炮算出来的结果要和计算表一样」）：
    //   系数 =（面板 × 全部乘算，**不取整**）× 炮术倍率 +（全部加算）
    //     · 估算器 C2 = readme 面板 × skill_data!A2（所有乘算技能的乘积）—— 不取整，所以这里也不能用 floorAtk
    //     · 估算器 D2 = SUM(所有加算) —— 力量护符/攻击技能加算等一并进来
    //     · 炮术的**加算**（J3 = +3/+6/+9）**不进固伤**，只加到「附带火属性」（估算器 M 列）—— 见下面 element
    const coeff = n(p.shellBaseAllMuls, n(p.baseAttack)) * n(p.artyMul, 1) + n(p.atkFlatPool, 0);
    let mv = 0, count = 1, note = moveKey, spark = false;
    if (moveKey === 'shot') {
      mv = n(row.shellAttack);
    } else if (moveKey === 'chargeShot') {
      mv = n(row.shellAttack) * n(c.chargeRate, 1.8);
      count = clamp(p.fullBurstCount == null ? 1 : Math.round(n(p.fullBurstCount, 1)), 1, 7);
    } else if (moveKey === 'fullBurst') {
      // 装填数 = 类型基础装填数 + 炮弹装填（增弹）+1（估算器 act_data!R5 / 主表 B10 同口径）
      //   用户 2026-10-01：界面给「发炮数」选项（默认满装填）→ 在这里按上限钳制；增弹自动把上限 +1
      const capMax = Math.max(1, n(c.shellsDefault, 1) + n(p.shellCapAdd, 0));
      //   注意 n(null, d) 会走 Number(null)=0 这一支（不是 fallback）→ 没选过时必须显式取上限
      const picked = (p.fullBurstCount == null) ? capMax : n(p.fullBurstCount, capMax);
      count = clamp(picked, 1, capMax);
      mv = n(row.shellAttack) * n(c.fullBurstRate, 1);
    } else if (moveKey === 'wyvernfire') {
      // 龙击炮：吃炮术（用户 2026-10-01 拍板），系数与炮击同口径
      mv = n(row.wyvernfireAttack);
    } else if (moveKey === 'wyrmstake') {
      // 龙杭爆炸：估算器把「连装第 2 发的 ×1.1」折进了自己那张表（wyrmstakeAttack 列本身已含）
      //   → 引擎不再额外乘；数据层用 ammoIndex 标注「这是第几发龙杭」
      // 龙杭全弹补正：只有挂在 龙杭全弹 / 连装龙杭全弹 / 集中派生龙杭 的**第一发**上时才吃
      mv = n(row.wyrmstakeAttack);
      const ammoUsed = n(p.shellAmmoUsed, 0);
      if (s.ammoIndex != null && n(s.ammoIndex) > ammoUsed) mv *= n(c.wyrmstakeFullBurstRate, 1);
    } else if (moveKey === 'wyrmstakeSpark') {
      // 龙杭火花（用户拍板「按照他的来」）：估算器 动作表!F17/G17（9 段）与 F18/G18（连装 15 段）
      //   物理 = 火花动作值/100 × 固伤系数 × 肉质/100 × 会心期望（吃肉质与会心、不吃斩味）
      //   属性 = 属性值/10 × 属补 0.5 × 属性吸收/100
      mv = n(row.wyrmstakeSpark);
      count = Math.max(1, n(s.sparkCount, 1));
      spark = true;
      note = 'wyrmstakeSpark（固伤系数 × 肉质 × 会心，不吃斩味）';
    }
    // 物理：火花额外吃肉质与会心（其余炮击系一律不吃）
    const sparkPhysMul = spark ? (n(p.sparkZone, 100) / 100) * n(p.sparkCrit, 1) : 1;
    const raw = mv / 100 * coeff * count * sparkPhysMul;
    // 属性（固伤 + 属性伤害的第二半）：
    //   炮击 / 龙击炮 / 龙杭爆炸 → （表内附带火属性 + 炮术加算）× 火属性吸收/100 × 发数
    //   龙杭火花 → 属性值/10 × 属补 0.5 × 武器属性吸收/100 × 段数
    const fireField = (moveKey === 'wyvernfire') ? 'wyvernfireFire'
      : (moveKey === 'wyrmstake') ? 'wyrmstakeFire' : 'shellFire';
    const fire = n(row[fireField], 0);
    const elemZone = spark ? n(p.elemZone, 0) : n(p.fireZone, 0);
    const element = spark
      ? (n(p.elemValue, 0) / 10) * 0.5 * (elemZone / 100) * count
      : (fire + n(p.artyAdd, 0)) * (elemZone / 100) * count;
    return {
      shelling: true, move: moveKey, shellType: p.shellType, shellLevel: p.shellLevel,
      mv: Math.round(mv * 1e6) / 1e6, count: count, coeff: Math.round(coeff * 1e6) / 1e6,
      raw: Math.max(0, raw), element: Math.max(0, element), fire: fire,
      total: Math.max(0, raw) + Math.max(0, element),
      elemZone: elemZone, spark: spark,
      status: 0, stun: 0, note: note
    };
  }

  // ===================== 单刀计算 =====================
  function calcHit(p) {
    const hit = p.hit || {};

    // 猎虫攻击（type:insect）：按 hasmine 的猎虫模型算伤害
    //   物理 = 动作值 × 虫威力倍率 × 物理倍率 × (肉质/100)（肉质用虫的攻击类型：斩/打）
    //   属性 = 0.1 × 武器属性值 × 属性倍率 × 属补 × 招式级属性修正 × (属性肉质/100)
    // 不吃斩味 / 技能 / 会心
    if (hit.type === 'insect') {
      const k = p.kinsect || {};
      const kMv = hitMv(hit, p.threeLamp);
      // 招式级属性修正（hasmine 口径）：飞天螺旋斩猎虫段 ×0（不给属性伤害）
      const kElemMul = n(hit.insectElemMul, 1);
      // 没选猎虫（调用方未传 kinsect）→ 无法算猎虫伤害，按 0 处理（UI 一定会选一只）
      if (!k.kinsect) {
        return {
          raw: 0, element: 0, total: 0, status: 0, stun: 0,
          kinsect: true, noKinsect: true, mv: kMv,
          elemRate: n(hit.elemRate, 1) * kElemMul, elemMul: kElemMul,
          statusRate: n(hit.statusRate, 0),
          sharpCost: 0, noSharp: true, hien: false, type: 'insect',
          isWeak: false, affinityUsed: 0
        };
      }
      const kMul = kinsectMultipliers(k.kinsect, hit.tags);
      // 虫的攻击类型：SEVER → 斩肉质，其余（BLUNT）→ 打肉质
      const kType = (k.kinsect && k.kinsect.attackType === 'SEVER') ? 'Slash' : 'Blow';
      const kHitzone = n(p.hitzones && p.hitzones[kType], n(p.hitzoneRaw));
      const kElemZone = n(p.hitzones && p.hitzones[p.elementType], n(p.hitzoneElement));
      const kElemValue = (!p.elementDisabled && n(p.element) > 0) ? n(p.element) : 0;
      const kPhys = (kMv === null ? 0 : kMv * n(k.powerMult, 1) * kMul.phys * (kHitzone / 100));
      const kElem = (kElemValue > 0 && kElemZone > 0)
        ? 0.1 * kElemValue * kMul.elem * n(hit.elemRate, 1) * kElemMul * (kElemZone / 100)
        : 0;
      return {
        raw: Math.max(0, kPhys),
        element: Math.max(0, kElem),
        total: Math.max(0, kPhys + kElem),
        status: 0, stun: 0,
        kinsect: true,          // 猎虫段（伤害算，但不吃斩味/技能/会心）
        mv: kMv,
        powerMult: n(k.powerMult, 1),
        physMult: kMul.phys,
        elemMult: kMul.elem,
        mvEffMul: 1,
        // 属补按「实际生效值」下发（表内属补 × 招式级属性修正），汇总与明细口径一致
        elemRate: n(hit.elemRate, 1) * kElemMul,
        elemMul: kElemMul,
        statusRate: n(hit.statusRate, 0),
        sharpCost: 0,
        noSharp: true,
        hien: false,
        type: 'insect',
        isWeak: false,
        affinityUsed: 0
      };
    }

    const type = hit.type === 'BLOW' ? 'Blow' : 'Slash';
    // 固伤（狩猎笛音波/响玉/响周波物理部分）：物理不吃肉质（按 100 计）
    const hitzoneRaw = hit.fixed ? 100 : n(p.hitzones && p.hitzones[type], n(p.hitzoneRaw));
    const elemTypeForZone = hit.waveElementType || p.elementType;
    const hitzoneElem = n(p.hitzones && p.hitzones[elemTypeForZone], n(p.hitzoneElement));
    const st = p.state;

    // 武器类型选择「无」：该武器不带属性 / 不带异常，整条属性/异常链路归零
    // （未传类型 = 调用方没指定，保持原行为；只有显式 'None' 才归零）
    const noElemType = hit.waveElementOnly ? !(n(hit.waveElementValue, 0) > 0)
      : p.elementType === 'None' || (!!p.elementType && ELEMENT_TYPES.indexOf(p.elementType) < 0);
    const noStatusType = p.statusType === 'None';

    // 禁用斩味（列58 IsNoUseKireaji）：不耗斩味且斩补无效（倍率按 1 计）；
    //   列59 IsForceUseKireajiAttackRate=1 时「不耗斩但斩补仍生效」（表内 207 行）
    // 狩猎笛固伤（音波/响玉/响周波物理部分）：物理不吃肉质、不吃会心；响周波另按用户拍板固定绿斩
    const noSharp = !!hit.noSharp;
    const isFixed = !!hit.fixed;
    const sharpIgnored = (isFixed || noSharp) && !hit.forceSharp;   // 斩补按 1 计
    const greenSharp = p.sharpGreen || null;                       // 绿斩倍率（界面把表内绿斩行传进来）
    const useGreen = isFixed && hit.waveSharp === 'green';
    const sharpRaw = hit.sharpRawOverride != null ? n(hit.sharpRawOverride,1) : useGreen ? n(greenSharp && greenSharp.raw, 1)
      : (sharpIgnored ? 1 : p.sharpness.raw);
    const sharpElem = useGreen ? n(greenSharp && greenSharp.element, 1)
      : (sharpIgnored ? 1 : p.sharpness.element);

    // 攻击力 = 基础攻击力（含「攻击」技能）× 其他技能/道具乘算 + Σ加算（其他技能/道具加值 + 三灯加值）
    // 连击：前4击档0(+5/+50)，第5击起档 level(Lv1-5)
    const baseAtkValue = p.baseAttack != null ? n(p.baseAttack) : n(p.attack);
    let attack = baseAtkValue * st.attackPct + st.attackFlat + n(p.lampFlat);
    // 太刀刃色保留基础补正；斩斧强化作用于含技能、道具加算的攻击力。
    if (n(p.swaxBasePct, 1) !== 1 || n(p.swaxBaseAdd, 0) !== 0 || n(p.baseAtkPct, 1) !== 1) {
      attack = (baseAtkValue * n(p.baseAtkPct, 1) * st.attackPct + st.attackFlat + n(p.lampFlat)) * n(p.swaxBasePct, 1) + n(p.swaxBaseAdd, 0);
    }
    const chainIdx = (p.hitIndex || 0) < 4 ? 0 : (st.chainLevel || 1);
    attack = floorAtk(attack);   // 攻击力向下取整（含连击加值）

    // 属性显示值（含技能）＋ 连击属性档 —— 顺序 (基础×乘算)+加算
    const hitElementBase = hit.waveElementOnly ? n(hit.waveElementValue, 0) : p.element;
    let elemDisplay = noElemType ? 0
      : hitElementBase * st.elementPct + st.elementFlat + st.absorbElemFlat + st.dragonElemFlat;
    // 属性值上限：max(基础面板属性值 × 2.3, 400)；面板属性为 0（无属性武器）时不产生属性
    const elemCap = elementCap(hitElementBase);
    if (elemDisplay > elemCap) elemDisplay = elemCap;

    // 异常显示值（含技能） —— 顺序 (基础×乘算)+加算
    const statusDisplay = noStatusType ? 0 : p.status * st.statusPct + st.statusFlat;

    // 太刀「有气」：招式级开关打开（默认）时取表内 col81 有气动作值（用户 2026-10-06 拍板）
    const mvValue = (hit && hit.mvQi != null && p.lsQiOn !== false) ? n(hit.mvQi) : hitMv(hit, p.threeLamp);   // 当前灯态下的表内动作值
    const mv = mvValue / 100;
    const elemRate = n(hit.elemRate, 1);       // 属补
    const statusRate = n(hit.statusRate, 0);   // 异常补正

    // 弱点部位自动判定：该 hit 所用肉质 > 45（用户规则，逐刀判定）
    // 伤口：由部位肉质状态自动应用（选「伤口」肉质时 isWound=true）
    const isWeak = hitzoneRaw > 45;
    const isWound = !!p.isWound;
    const affinityEff = clamp(
      st.affinity + (isWeak ? st.weakSpotAffinity : 0) + (isWound ? st.woundAffinity : 0),
      -100, 100
    );

    // 响周波：除「响周波斩」外不吃会心（用户拍板，表内 66 列写的是可会心）
    const noCrit = !!hit.noCrit;
    const rawCrit = noCrit ? 1 : rawCritMultiplier(affinityEff, st.critMult, p.mode);
    const elemCrit = noCrit ? 1 : elementCritMultiplier(affinityEff, st.elementCritMult, p.mode);
    const statusCrit = noCrit ? 1 : elementCritMultiplier(affinityEff, st.statusCritMult, p.mode);

    // 蓄力(0/1/2)倍率：只作用动作值（物理），不影响属补/异常补正（用户确认）
    const chargeMul = n(p.chargeMul, 1);
    // 舞踏倍率：只作用物理（用户拍板；属性不吃舞踏）
    const danceMul = n(p.danceMul, 1);
    // 蓄力大师 / 因祸得福 技能乘区
    const chargeElem = n(p.chargeable ? st.chargeElemMult : 1, 1);
    const chargeStatus = n(p.chargeable ? st.chargeStatusMult : 1, 1);

    // 飞燕：倍率直接乘在动作值上（仅表内 IsSkillHien 标记的 hit 适用）
    // 盾斧：红盾（斧形态 ×1.1）与高速变形（变形类招式 ×1.05/1.1/1.2）同样只作用动作值
    //   高速变形单独取出来（p.morphMult），因为 effectiveMv 要用它、而 cbMoveMul 里还含红盾
    // 长枪力防：力量格挡的力防层数（0/1/2/3 → 紧接其后派生出的那一招**前 3 hit** ×1.1/1.3/1.7，表内 r116）
    //   同样只作用动作值，且单独走 p.forceGuardMul —— 这样 effectiveMv 也能带上它（显示值 = 生效值）
    const forceGuardMul = n(p.forceGuardMul, 1);
    // 大剑集中贯穿斩：追击跳数的**逐跳衰减**（表内 col55 MultiHitRateCurve 曲线，用户 2026-10-06 拍板
    //   「按表内来」）——同样只作用动作值，且单独走 p.tickDecay，这样 effectiveMv 也带上它（显示值 = 生效值）
    const tickDecay = n(p.tickDecay, 1);
    const mvEff = mv * (p.hien ? st.airborneMult : 1) * n(p.morphMult, 1) * n(p.cbMoveMul, 1) * forceGuardMul * tickDecay;

    // 物理基础（会心前）：攻击力 × 动作值(含飞燕) × 蓄力 × 肉质 × 斩味 × 舞踏
    let raw = attack
      * mvEff
      * chargeMul
      * (hitzoneRaw / 100)
      * sharpRaw
      * danceMul;
    // 最低保底：正物理伤害 <1 时按 1（在会心补正前；hasmine 公式确认）
    if (raw > 0 && raw < 1) raw = 1;
    // 会心补正
    raw *= rawCrit;

    // 属性伤害：0.1 × 属性值 × 属补 × (属性肉质/100) × 属性会心 × 斩味属性 × 技能乘区
    // 狩猎笛属性周波：自带属性值独立参与（属性周波 = 物理固伤 + 属性伤害 + 自带属性的属性伤害）
    // 保底：有属性伤害但不足 1 时取 1（用户拍板，与 hasmine 一致）
    const waveElemValue = hit.waveElementOnly ? 0 : n(hit.waveElementValue, 0);
    // 斩击斧：强属性瓶 → 基础属性 +45%（乘在属性值上；因子为 1 时行为不变）
    let elemental = (((elemDisplay * n(p.swaxElemPct, 1)) + waveElemValue) / 10)
      * elemRate
      * (hitzoneElem / 100)
      * elemCrit
      * sharpElem
      * st.convertElemMult
      * chargeElem;
    elemental *= n(p.cbElementMul,1);
    if (elemental > 0 && elemental < 1) elemental = 1;

    // 怪物发怒「受击倍率」（用户 2026-10-08）：数据库 AngryTable 的 PlDamage（player dmg）
    //   只作用**最终伤害**（物理 + 属性）；未开愤怒 / 该怪没有发怒表时为 1（中性因子，行为与接入前完全一致）
    const enrageMul = n(p.enrageMul, 1);
    if (enrageMul !== 1) { raw *= enrageMul; elemental *= enrageMul; }
    // 重奏的10点追加是绝对固定伤害，不走攻击力、属性或其他补正。
    if (hit.constantDamage != null) { raw=n(hit.constantDamage,0); elemental=0; }

    // 异常周波：100% 触发自带异常值（不经 1/3 折算，用户拍板）
    const status = hit.waveStatusAlways
      ? n(hit.waveStatusValue, 0) * statusCrit * st.convertStatusMult * chargeStatus
      : statusDisplay
        * statusRate
        * STATUS_PROC
        * statusCrit
        * st.convertStatusMult
        * chargeStatus;

    // 晕厥：只有命中头部才累计（其他部位不涨）
    const stun = (p.isHead ? n(hit.stun) : 0) * st.stunMult;

    return {
      raw: Math.max(0, raw),
      element: Math.max(0, elemental),
      total: Math.max(0, raw + elemental),
      status: Math.max(0, status),
      stun: Math.max(0, stun),
      mv: mvValue,                               // 当前灯态下的表内动作值（三灯时取 mvLamp）
      fixed: isFixed,
      // 实际生效动作值（含飞燕 / 高速变形 / 蓄力 / 舞踏 / 力防倍率），用于连段汇总
      effectiveMv: mv * (p.hien ? st.airborneMult : 1) * n(p.morphMult, 1) * chargeMul * danceMul * forceGuardMul * tickDecay * 100,
      // 大剑集中贯穿斩：这一跳吃了第几档衰减（界面小字标「表内 10 ×0.934」用；未标记的 hit 为 null）
      tickDecay: tickDecay !== 1 ? tickDecay : null,
      forceGuard: forceGuardMul !== 1,           // 该刀吃了力防层数加成（界面单独标注）
      forceGuardMul: forceGuardMul,
      hien: !!p.hien,                            // 该刀动作值吃飞燕（表列39 IsSkillHien）
      airborneMult: p.hien ? st.airborneMult : 1, // 该刀实际套用的飞燕倍率（未标记/未选技能时为1）
      // 高速变形：打这一刀时剑斧形态变了（prevForm ≠ 打完后的形态）；倍率与实际生效值同源
      morph: n(p.morphMult, 1) !== 1,
      morphMult: n(p.morphMult, 1),
      prevForm: p.prevForm || null,               // 打这一刀时人在剑形态还是斧形态（界面标注/审计用）
      sharpCost: n(hit.sharpCost),               // 该刀耗斩（10 = 面板1斩味 = 历代1刀）
      noSharp: noSharp,                          // 禁用斩味：不耗斩且斩补无效
      forceSharp: !!hit.forceSharp,              // 列59：不耗斩但斩补仍生效（界面据此决定提示措辞）
      sharpRaw: sharpRaw,                        // 该刀实际套用的斩味物理补正
      elemRate: elemRate,
      statusRate: statusRate,
      type: hit.type,
      isWeak: isWeak,          // 肉质>45 自动判定
      affinityUsed: affinityEff
    };
  }

  // ===================== 连段计算 =====================
  function calculateCombo(params) {
    const moves = params.moves || [];
    const moveById = new Map(moves.map(function (m) { return [m.id, m]; }));
    const state = applySkills({
      affinity: params.affinity,
      weaponGroups: params.weaponGroups,
      elementType: params.elementType,   // 面板属性类型（用于过滤属性强化技能）
      statusType: params.statusType,     // 面板异常类型（用于过滤异常强化技能）
      sharpness: params.sharpness        // 当前斩味颜色（钝器能手的斩味条件要用）
    }, params.skills, params.weaponId, Object.assign({ sharpness: params.sharpness }, params.context || {}));
    applyItems(state, params.items);   // 道具/餐点（鬼人药、怪力种子、餐点等）

    // 旋律（战斗前演奏的强化，用户 2026-09-30 拍板）：攻击力/属性都作用在**基础值**上（与「攻击」技能同层），
    //   会心强化直接加会心率。自我强化只在狩猎笛出现（数据层 weapons 声明 + 界面过滤）
    //   用户 2026-09-30 补正：**不是单选，可以多选** → 收 melodies 数组（多条同时生效）；
    //   同组互斥（exclusiveGroup：攻击力小/大强化是同一旋律的不同档）只算第一条，界面侧已提前过滤
    const melodyList = (Array.isArray(params.melodies) ? params.melodies
      : (params.melody ? [params.melody] : [])).filter(Boolean);
    const melSeenGroup = {};
    const activeMelodies = melodyList.filter(function (m) {
      const grp = m && m.exclusiveGroup;
      if (!grp) return true;
      if (melSeenGroup[grp]) return false;
      melSeenGroup[grp] = true;
      return true;
    });
    activeMelodies.forEach(function (m) {
      if (m.attackPct) state.baseAttackPct *= (1 + n(m.attackPct));
      if (m.elementPct) state.elementPct *= (1 + n(m.elementPct));
      if (m.affinity) state.affinity += n(m.affinity);
    });
    const melody = activeMelodies.length ? activeMelodies[0] : null;
    if (melody) state.melodyName = melody.name || null;

    // ===== 双刀（dual_blades）：蓝鬼（鬼人闪身）=====
    //   用户拍板：开启时**基础攻击力 ×1.15**（与「攻击」技能/力量护符同一层 → 进基础乘区，故必须在
    //   baseAttack 计算**之前**乘进 state.baseAttackPct），**属性 = 基础属性 + 基础属性×0.3**（加算项，不是整体 ×1.3）。
    //   只在 weaponId === 'dual_blades' 时生效 —— 其他武器传了也忽略（引擎侧硬拦截）。
    const isDB = params.weaponId === 'dual_blades';
    const dbCfg = params.blueDemon || {};
    const blueDemonOn = isDB && !!dbCfg.on;
    const blueDemonMul = blueDemonOn ? n(dbCfg.attackBaseMul, 1.15) : 1;
    const blueDemonElemAdd = blueDemonOn ? n(dbCfg.elementBaseAdd, 0.3) : 0;
    if (blueDemonOn) {
      state.baseAttackPct *= blueDemonMul;
      // 属性加算项：基础属性（面板值）× 0.3，作为显示值口径的加算（与「属性吸收/属性变换」同层）
      state.elementFlat += n(params.element) * blueDemonElemAdd;
    }

    // 基础攻击力 = 面板 × 基础攻击力乘算 + 基础攻击力加算，再**向下取整**（用户拍板：攻击力舍弃小数点）
    // 只有文案写明「基础攻击力」的效果进这里（攻击 Lv1~5 的加值）；「攻击力变为X倍」类乘算进最终攻击力
    // 双刀蓝鬼（×1.15）挂在这一层：state.baseAttackPct 里 —— 与「攻击」技能/力量护符同层
    if(params.mantle){state.baseAttackBonusPct+=.05;state.affinity=clamp(state.affinity+10,-100,100);}
    const baseAttack = floorAtk(n(params.attack) * (state.baseAttackPct+state.baseAttackBonusPct) + state.baseAttackFlat);

    // 操虫棍三灯（红+白+橙）：攻击力获得「基础攻击力 ×0.15」的**加值**（加算），
    // 并让 移动斩 / 移动连斩 用三灯动作值（hit.mvLamp）
    // 未显式传 threeLamp 时按三灯处理（游戏常态，与 ig_moves._meta.defaultState 一致）
    // 用户拍板：三灯是操虫棍独有强化 —— 其他武器一律不吃（引擎侧硬拦，避免混进别的武器）
    const isInsectGlaive = params.weaponId === 'insect_glaive';
    const threeLamp = !isInsectGlaive ? false
      : (!params.context || params.context.threeLamp === undefined ? true : !!params.context.threeLamp);
    const lamp = params.lamp || {};
    // 加值 = 基础攻击力（含攻击技能）× (表内 TrippleAtkRate - 1)；未传 lamp 配置时加值为 0
    // 注意这是**加算**项：攻击力 = 基础攻击力 × Π其他乘算 + Σ加算（含三灯加值 + 其他技能/道具加值）
    const lampRate = threeLamp && n(lamp.threeAtkRate, 1) > 0 ? n(lamp.threeAtkRate, 1) - 1 : 0;
    const soulFlat = floorAtk(baseAttack * state.attackFromBasePct);
    // 同源百分比先相加再取整，避免两次取整丢失1点攻击力。
    const lampFlat = floorAtk(baseAttack * (lampRate + state.attackFromBasePct)) - soulFlat;
    state.attackFlat += soulFlat;
    // 最终攻击力同样向下取整（技能乘算/加算、道具、三灯加值全部算完之后）
    const attackFinal = floorAtk(baseAttack * state.attackPct + state.attackFlat + lampFlat);

    // 面板类型：「无」属性 / 「无」异常 → 整条链路归零（含猎虫属性）
    const noElemType = params.elementType === 'None'
      || (!!params.elementType && ELEMENT_TYPES.indexOf(params.elementType) < 0);
    const noStatusType = params.statusType === 'None';

    // 猎虫（共斗虫）配置：虫种 + 等级 → 威力倍率（武器带属性时威力 -1）
    const kinsectCfg = (function () {
      const src = params.kinsect || {};
      const k = src.kinsect || null;
      const level = clamp(n(src.level, 1), 1, 15);
      const hasElem = !noElemType && n(params.element) > 0;
      return {
        kinsect: k,
        level: level,
        // 猎虫也是操虫棍独有：其他武器一律不套猎虫威力倍率
        powerMult: (isInsectGlaive && k) ? kinsectPowerMult(k, level, hasElem, src.powerTable) : 1
      };
    })();

    const sharpness = params.sharpness || DEFAULT_SHARPNESS.green;
    const danceMultiplier = params.danceMultiplier || {};
    const chargeMultiplier = params.chargeMultiplier || { '0': 0.6, '1': 0.75, '2': 1 };

    // ===== 铳枪（gunlance）：炮击类型 / 炮击等级 / 炮击表 都是开局选的，其他武器一律不吃 =====
    const isGL = params.weaponId === 'gunlance';
    const glCfg = params.gunlance || {};
    const GL_TABLE = isGL ? (params.shellTable || null) : null;
    const glTypeRaw = isGL ? String(glCfg.type || 'normal') : '';
    const glType = (GL_TABLE && GL_TABLE.types && GL_TABLE.types.indexOf(glTypeRaw) >= 0) ? glTypeRaw : 'normal';
    const glLevel = isGL ? clamp(n(glCfg.level, 3), 1, 7) : 0;

    const isWound = !!(params.context && params.context.wound); // 部位肉质状态是否为伤口（UI 自动应用）
    const isHead = !!params.isHead;                             // 部位是否为头部（只有头部累计晕厥）

    // ===== 盾斧（charge_blade）：瓶种 / 瓶状态 / 红盾 / 红剑 都是开局选的，其他武器一律不吃 =====
    const isCB = params.weaponId === 'charge_blade';
    // 剑斧形态武器（盾斧 / 斩击斧）：形态状态机与「高速变形」判定共用一套（用户 2026-10-06 接入斩击斧）
    const hasForm = isCB || params.weaponId === 'switch_axe';
    const isSWAX = params.weaponId === 'switch_axe';
    // 斩击斧武器级开关（用户 2026-10-06 拍板）：开刃 / 瓶种（强击瓶·强属性瓶）/ 红斧（强化敲打开出）
    const swaxCfg = params.swax || {};
    const swaxAwakened = !!swaxCfg.awakened;                 // 开刃：剑形态攻击附带瓶爆
    const swaxPhialKind = swaxCfg.phial === 'element' ? 'element' : 'power';   // 强属性瓶 / 强击瓶
    const swaxRedAxe = !!swaxCfg.redAxe;                     // 红斧：斧形态基础攻击力 +10
    const cbCfg = params.cb || {};
    const cbPhialKind = cbCfg.phial === 'element' ? 'element' : 'impact';   // 强属性瓶 / 榴弹瓶
    const cbReinforced = !!cbCfg.reinforced;    // 强化瓶
    const cbRedShield = !!cbCfg.redShield;      // 红盾
    const cbRedSword = !!cbCfg.redSword;        // 红剑
    const cbTable = params.phialTable || null;  // 瓶爆台账（来自 chargeblade_moves.json）
    const cbMul = (cbTable && cbTable.multipliers) || {};
    const cbSaw = (cbTable && cbTable.saw) || null;
    // 强属性瓶瓶爆用「属性显示值」（技能/道具加成后，再套属性值上限）——与逐刀属性同口径
    const cbElemDisplay = noElemType ? 0
      : Math.min(n(params.element) * state.elementPct + state.elementFlat + state.absorbElemFlat + state.dragonElemFlat,
        elementCap(n(params.element)));
    // 舞踏：打完跳跃突进斩后自动派生，层数 = 连段内已打出的跳跃突进斩次数（上限 2），无需手动指定
    let danceStacks = 0;

    let totalRaw = 0, totalElement = 0, totalStatus = 0, totalStun = 0;
    let totalSharpCost = 0;                                    // 连段总耗斩（单位：10 = 面板1斩味）
    let insectMv = 0, insectElemRate = 0, insectHits = 0;      // 猎虫段：单列展示
    let soundMv = 0, soundHits = 0, soundRaw = 0, soundElement = 0, soundStun = 0;   // 狩猎笛音波/响玉：单列展示
    let shellHits = 0, shellRaw = 0, shellMv = 0, shellFireTotal = 0, shellElem = 0;   // 铳枪炮击系：单列展示
    let woundBurstHits = 0, woundBurstRaw = 0;                 // 集中处决爆伤口：单列展示（用户 2026-10-08）
    const balladTable = params.balladTable || null;
    let insectRaw = 0, insectElement = 0;                      // 猎虫段伤害（hasmine 模型）
    // 动作值三档（供 UI：原始值大字 + 飞燕后/生效值小字）
    let totalMv = 0;            // 表内原始动作值之和
    let totalMvAfterHien = 0;   // 只计入飞燕倍率
    let totalMvEffective = 0;   // 计入飞燕 + 蓄力 + 舞踏（引擎实际用于算伤害的值）
    const hits = [];
    let hitIndex = 0;
    let prevCharge = 2;   // 上一招的蓄力等级（供 inheritCharge 招式继承，如飞天螺旋斩）
    let prevPhialKind = null;   // 盾斧：上一招带的瓶爆档（ultra 在大解/追解后可吃 ×1.5 / ×1.273）
    let cbFormPrev = null;      // 盾斧：上一招打完之后处于剑/斧形态（第一招 = null，按招式自身形态起手）
    // 盾斧：一招「打完之后是剑形态还是斧形态」（档位选项/打完选项会改变它）。
    //   供高速变形判定用（上一招打完的形态 ≠ 这一招打完的形态 = 发生了形态变化）
    const cbFormAfterMove = function (mv, it) {
      if (!mv) return null;
      if (mv.recoveryOption) return (mv.recoveryOption.variants[it?.recovery ?? mv.recoveryOption.default] || mv.recoveryOption.variants[0]).toForm;
      if (mv.sequenceOptions) return it?.finish === false ? mv.form : (mv.sequenceOptions[it?.wound ? 'wound' : 'none'][it?.sequence ?? 0] || mv.sequenceOptions[it?.wound ? 'wound' : 'none'][0]).toForm || mv.form;
      if (mv.aimVariants) {
        const v = mv.aimVariants[clamp(n(it && it.aim, 0), 0, mv.aimVariants.length - 1)];
        if (v && v.toForm) return v.toForm;
      }
      if (mv.finishOption && mv.finishOption.variants) {
        const want = (it && it.finish !== undefined) ? !!it.finish : !!mv.finishOption['default'];
        const v = mv.finishOption.variants.filter(function (x) { return x.value === want; })[0];
        if (v && v.toForm) return v.toForm;
      }
      return mv.toForm || mv.form || null;
    };

    // 大剑冲撞攻击的招式选项「打断上一个蓄力斩」（用户 2026-10-01）：
    //   勾了 → 紧邻在它前面的那一刀若是「可被打断」的招式（数据层 cancelMovable：蓄力斩/强蓄力斩/真蓄力斩），
    //   该刀整体取消 —— 伤害（raw/element/status/stun）归零、动作值不计入三档合计、
    //   这些 hit 打 cancelled:true（界面显示 0 / 「已取消」）。耗斩按「取消这一刀」处理 = 不耗斩。
    //   不勾 → 完全正常计算。
    const cancelOn = function (idx) {
      const it = (params.combo || [])[idx];
      if (!it) return null;
      const mv = moveById.get(it.moveId || it.id);
      if (!mv || !mv.cancelPrevOption) return null;
      const on = (it.cancelPrev !== undefined) ? !!it.cancelPrev : !!mv.cancelPrevOption['default'];
      if (!on) return null;
      const prev = (params.combo || [])[idx - 1];
      if (!prev) return null;
      const pm = moveById.get(prev.moveId || prev.id);
      if (!pm || !pm.cancelMovable) return null;
      return { prevMoveId: pm.id };
    };

    const comboList = params.combo || [];
    let hitsStartOfLast = 0;   // 上一把真正打出 hit 的招在 hits 里的起点（打断上一个蓄力斩用）
    // 长枪力防：力量格挡的「力防层数」是**跨招**的加成 —— 只作用于紧接它之后派生出的那一招的前 N hit。
    //   在这里按连段顺序传递：本招若是带 forceGuardBuff 的招式（力量格挡）→ 给下一招挂上；只延续一招。
    let pendingForceGuard = null;
    const forceGuardUsed = [];   // 连段里实际吃到力防加成的位置（界面标注 + 闸门断言用）
    for (let comboIdx = 0; comboIdx < comboList.length; comboIdx++) {
      const item = comboList[comboIdx];
      let move = moveById.get(item.moveId || item.id);
      if (!move) continue;
      if (move.rangedVariants || move.rangedStages) move = rangedWholeMove(move,item);

      // 这一招吃的力防加成（来自紧邻上一招的力量格挡；没有则 null）
      const forceGuard = pendingForceGuard;
      let fgRemain = forceGuard ? n(forceGuard.hits, 0) : 0;
      let fgApplied = 0;        // 本招实际吃到加成的 hit 数（回传给界面显示）
      pendingForceGuard = null;   // 只延续一招：本招处理完就清掉（下面若本招是力量格挡会重新挂上）

      // 这一招勾了「打断上一个蓄力斩」吗？（勾了 → 下面把它前面紧邻的那一刀归零；
      //   注意 cancelled 说的是「本招会不会去取消别人」，被取消的是 hits 里本招起点之前的那一段）
      const cancelInfo = cancelOn(comboIdx);
      // 蓄力等级：可蓄招式取用户选择；继承型（飞天螺旋斩）取「派生它的上一招」的蓄力等级
      let chargeLevel;
      if (move.chargeable) chargeLevel = clamp(n(item.charge, 2), 0, 2);
      else if (move.inheritCharge) chargeLevel = clamp(n(prevCharge, 2), 0, 2);
      else chargeLevel = 2;
      const usesCharge = !!(move.chargeable || move.inheritCharge);
      const chargeMul = usesCharge ? n(chargeMultiplier[String(chargeLevel)], 1) : 1;

      // 表内直接给了各档位动作值的招式（大剑/大锤/狩猎笛的蓄力档位）：按用户选的档位取 hit，
      // 不再用 chargeMultiplier 折算（表内数值就是实测值，逐档不同）。
      // 档位越界时钳到最近的档位；默认取最高档（与「表内动作值 = 满蓄档」口径一致）。
      const lvList = move.chargeLevels && move.chargeLevels.length ? move.chargeLevels : null;
      let lvPick = null;
      if (lvList) {
        const want = n(item.charge, n(move.defaultLevel, NaN));
        lvPick = lvList.find(function (l) { return l.level === want; })
          || lvList[lvList.length - 1];
      }
      const levelUnit = lvPick ? (move.levelUnit || '蓄') : null;
      // 档位改名（用户 2026-10-08）：太刀直斩系选红刃时名字变「赤刃斩」（chargeLevels[].name）；
      //   没声明 name 的档位沿用招式本名 → 未接入该字段的武器行为完全不变
      const moveLabel = (lvPick && lvPick.name) ? lvPick.name : move.name;

      // 舞踏：打完跳跃突进斩后自动派生并强化后续空中招式；层数 = 已打出的跳跃突进斩次数（上限 2）
      let danceMul = 1;
      if (move.danceKey && danceStacks >= 1) {
        const dm = (danceMultiplier[move.danceKey] || {});
        danceMul = n(dm[String(Math.min(danceStacks, 2))], 1);
      }
      const danceUsed = danceStacks;

      // 可自选段数的招式（如飞天螺旋斩）：取前 N 个棍段 + 紧随其后的猎虫段；
      // 其余招式固定打满表内段数（limit = null 不截断）
      // 铳枪集中龙杭突刺（用户 2026-10-01）：勾了招式级选项「命中伤口」后，**段数范围与固定首段数一起换**
      //   （未命中 = 起手突刺 A9 ×1 + 自选 1~7 段电钻；命中 = A9 ×2 + 自选 7~13 段电钻）
      //   → woundHitSelect 覆盖 hitSelect（prefixHits / min / max / default），口径与下面的 woundOn 一致：
      //     带 woundOption 的招式一律由选项决定，不看部位状态
      const selectWoundOn = !(move.bloomOption && item.bloom) && (move.woundOption ? !!item.wound : isWound);
      const sequenceOptions = (lvPick?.sequenceOptions || move.sequenceOptions)?.[selectWoundOn ? 'wound' : 'none'];
      const sequenceVariant = sequenceOptions && (sequenceOptions[item.sequence ?? 0] || sequenceOptions[0]);
      const hsBase = sequenceVariant ? sequenceVariant.hitSelect : move.hitSelect && (!move.hitSelect.requiresWound || selectWoundOn) ? move.hitSelect : null;
      const hsWoundSwap = !!(hsBase && move.woundOption && move.woundHitSelect && item && item.wound);
      const hs = hsWoundSwap ? Object.assign({}, hsBase, move.woundHitSelect) : hsBase;
      let hitLimit = hs
        ? clamp(n(item.hits, n(hs['default'], hs.max)), n(hs.min, 1), n(hs.max, 99))
        : null;
      let bladeSeen = 0;
      let truncated = false;
      // 轮数模型（双刀回天突刺）：hitLimit 原本是「轮数」，展开后会被置空 →
      //   单独存一份「用户选的轮数」，供逐刀结果回传给界面（标注「N 轮（M 刀）」）
      let loopRounds = null;

      // 狂龙衣装（狂化装衣）加段：用户拍板「加段不单独当招式，界面最上面给开关，开启后并进原招式」。
      // 表内已按招式挂好（move.mantleHits；档位招式挂在具体档位上，如大剑普蓄的第 2 个加段「3 蓄才有」）。
      const mantleOn = !!params.mantle;
      const mantleList = mantleOn
        ? [].concat(move.mantleHits || [], lvPick ? (lvPick.mantleHits || []) : [])
        : [];
      // 圈数（move.spin）：可自选重复次数的 hit —— 大锤「回旋攻击」「追击回旋敲打」用。
      //   head = 固定排在最前的 hit 个数（回旋攻击 head=1：起始 1hit 在前；追击回旋敲打 head=0：旋转在最前）
      //   圈数由用户在界面选，越界钳到 [min,max]
      let spinCount = 0;
      let seqHits = (lvPick ? lvPick.hits : move.hits);
      if (move.preciseOption && item.precise === false) seqHits=move.normalHits;
      if (move.requiresPhialLast && n(item.phial,n(move.phialOption?.default,5))===0) seqHits=seqHits.slice(0,-1);
      if (sequenceVariant) {
        seqHits = sequenceVariant.hits.slice();
        if (move.skipPrefixAfter && comboList[comboIdx-1]?.moveId === move.skipPrefixAfter && comboList[comboIdx-1]?.wound) seqHits = seqHits.filter(h=>!h.focusPrefix);
        if (item.finish === false) seqHits = seqHits.filter(h=>!h.sequenceFinish);
      }
      if (move.hitsWhenPrevIds?.ids.includes(comboList[comboIdx-1]?.moveId)) seqHits = move.hitsWhenPrevIds.hits;
      // 片手绽伤使用独立五段序列；即使外部输入同时勾选，绽伤优先且不爆伤口。
      const bloomOn = !!(move.bloomOption && item.bloom);
      if (bloomOn) seqHits = move.bloomHits;
      // 大剑真蓄：命中部位肉质 ≥ 阈值 → 本段（最后一段）换成「强击」数值（表内独立行，用户拍板 45）
      //   0 蓄档表内没有对应强击行 → 该档不挂 weakHits，这里自然不换
      let weakSwapped = false;
      if (lvPick && lvPick.weakHits && lvPick.weakHits.length && seqHits.length) {
        const zoneForWeak = n(params.hitzones && params.hitzones.Slash, n(params.hitzoneRaw));
        if (zoneForWeak >= n(move.weakThreshold, 45)) {
          seqHits = seqHits.slice(0, seqHits.length - 1).concat(lvPick.weakHits);
          weakSwapped = true;
        }
      }
      // 致命连击仍为一条红白招式；完成段数只截取对应阶段的实际hit。
      if (move.completionOption) {
        const opts = move.completionOption.variants;
        const pick = opts[item.completion] || opts[move.completionOption.default];
        if (pick.hitCount != null) seqHits = seqHits.slice(0, pick.hitCount);
      }
      // 盾斧集中二连变形斩：打完 220（变斧）/ 不打完 110（留剑）—— 用户在界面上选
      if (!sequenceVariant && move.finishOption && move.finishOption.variants) {
        const want = (item.finish !== undefined) ? !!item.finish : !!move.finishOption['default'];
        const v = move.finishOption.variants.find(function (x) { return x.value === want; })
          || move.finishOption.variants[move.finishOption.variants.length - 1];
        seqHits = [{ rsid: null, row: null, mv: v.mv, type: 'SLASH', elemRate: 1, statusRate: 1, sharpCost: 10, noSharp: false, hien: false, stun: 0, _userValue: '用户拍板：' + v.label + ' ' + v.mv }];
      }
      if (move.hitSelect && move.hitSelect.requiresWound && !selectWoundOn) seqHits = seqHits.slice(0, n(move.hitSelect.prefixHits, 2));
      const sp = move.spin;
      if (sp) {
        const min = n(sp.min, 1), max = n(sp.max, 99);
        spinCount = clamp(n(item.spin, n(sp.default, min)), min, max);
        const head = clamp(n(sp.head, 0), 0, seqHits.length);
        const spinHits = [];
        for (let k = 0; k < spinCount; k++) {
          spinHits.push(Object.assign({}, sp.hit, { spinIndex: k + 1 }));
        }
        seqHits = seqHits.slice(0, head).concat(spinHits, seqHits.slice(head));
      }
      // 可自选段数的招式有两种模型（数据层声明，引擎按边界钳制）：
      //   ① 通用模型（操虫棍飞天螺旋斩等）：取前 N 个 hit 直接截断
      //   ② 轮数模型（双刀回天突刺）：hitSelect.loopHits = 每轮刀数，用户选的 N = 轮数
      //      → 展开成前 N×loopHits 个 hit（越界按模循环取模板）+ 其余 hit（落地终结）
      if (hs?.tagged) {
        let loop = 0;
        seqHits = seqHits.filter(h=>!h.sequenceLoop || ++loop <= hitLimit).map(h=>h.sequenceLoop ? {...h,loopIndex:++bladeSeen,loopRound:bladeSeen} : h);
        loopRounds = hitLimit; hitLimit = null; bladeSeen = 0;
      }
      if (hs && hs.cycle) {
        let phase = 0;
        if (move.accumulateHits) for (let j = comboIdx - 1; j >= 0 && comboList[j].moveId === move.id; j--) {
          phase += clamp(n(comboList[j].hits, n(hs.default, 2)), hs.min, hs.max);
        }
        const template = seqHits;
        seqHits = Array.from({ length: hitLimit }, function (_, k) { return Object.assign({}, template[(phase + k) % template.length]); });
        hitLimit = null;
      }
      if (hs && n(hs.loopHits, 0) > 0) {
        // 轮数模型（双刀回天突刺）：用户选的 item.hits 是**轮数**，每轮 loopHits 刀
        //   模板结构 = 循环段（前 loopHits 刀，回天突刺 = [L12, R9] 交替共 8 刀 = 4 轮）
        //             + 固定尾段（循环段之后的 hit，回天突刺 = 落地终结 L18 + R24）
        //   用户选的 hitLimit 是**轮数**；每轮 2 刀（右手 + 左手）→ 循环段总长 = 轮数 × (loopHits / 4 轮)
        // prefixHits：循环段之前的**固定首段**个数（铳枪集中龙杭突刺 = 起手突刺 A9）
        // prefixRepeat：固定首段重复几次（未命中伤口 1 段 / 命中伤口 2 段 —— 同一条模板行重复）
        const loopHits = n(hs.loopHits);
        const pre = Math.max(0, Math.min(n(hs.prefixHits, 0), seqHits.length));
        const preR = Math.max(1, n(hs.prefixRepeat, 1));
        const roundsMax = Math.max(1, n(hs.max, 4));
        const perRound = Math.max(1, Math.round(loopHits / roundsMax));   // 回天突刺 = 8/4 = 2 刀/轮
        const rounds = Math.max(1, n(hitLimit, 1));
        const expanded = [];
        for (let k = 0; k < rounds * perRound; k++) {
          const src = seqHits[pre + (k % loopHits)];
          if (!src) break;
          expanded.push(Object.assign({}, src, { loopIndex: k + 1, loopRound: Math.floor(k / perRound) + 1 }));
        }
        // 模板结构 = 固定首段（pre 个 × preR 次）+ 展开后的循环段 + 固定尾段（循环段之后的部分）
        const prefixHits = [];
        for (let k = 0; k < preR; k++) {
          for (let j = 0; j < pre; j++) prefixHits.push(Object.assign({}, seqHits[j], { prefixIndex: k * pre + j + 1 }));
        }
        seqHits = prefixHits.concat(expanded, seqHits.slice(pre + loopHits));
        loopRounds = rounds;
        hitLimit = null;   // 已展开 → 不再走「取前 N 个」的截断逻辑
        truncated = false;
      }
      // 命中伤口/绽伤时的追加 hit（大锤集中殴打：跟部位伤口状态走；盾斧集中二连斩：招式级选项）
      //   大剑集中贯穿斩：追加 hit 挂在**档位上**（动作值随蓄力档变）→ 档位优先，招式级字段继续兼容
      const woundOn = !bloomOn && (move.woundOption ? !!item.wound : isWound);
      const woundSrc = (lvPick && lvPick.woundExtra) ? lvPick.woundExtra : move.woundExtra;
      const woundList = (!sequenceVariant && woundOn && woundSrc) ? woundSrc : [];

      // ===== 斩击斧（用户 2026-10-06 拍板）=====
      // 招式级开关：变形斩「能量是否充足」—— 不足 → 变成装瓶动作（不变形、不吃高速变形、伤害按装瓶 0 计）
      //   在 SWAX 块最前面声明，供后面的形态状态机（cbLeaveForm / morphOn）一起用
      const swaxReload = !!(isSWAX && move.energyOption && item && item.energy === false);
      // ⓪ 集中处决变化点自选（用户 2026-10-06 拍板）：形态可在**倒数两招或最后一招**改变，
      //    含「变过去再变回来」；分支 0 恒为 none（= 表内原样）→ 未选择时命中序列与接入前完全一致。
      //    选中非 none 分支 = 该分支含变形 → 该分支吃高速变形（与盾斧「变形招式整招吃」同口径）。
      let swaxAimMorph = false;
      let swaxPhialSrc = move.phialHits;
      if (isSWAX && move.aimVariants && move.aimVariants.length) {
        const av = clamp(n(item ? item.aim : 0, 0), 0, move.aimVariants.length - 1);
        const pick = move.aimVariants[av] || move.aimVariants[0];
        if (pick && pick.id !== 'none') {
          seqHits = pick.hits.slice();
          swaxPhialSrc = pick.phialHits || [];
          swaxAimMorph = true;
        }
      }
      // ① 属性解放 / 零距离属性解放突刺：突刺 + 连打 N（5~14）+ 终结
      //    打满 14 hit → 完整终结（属解 r89=135 / 零解 r90=160）；不满 = 提前引爆 → 简易终结（r91=65 / r99=75）
      let thrustUsed = null;
      if (isSWAX && move.thrustHits && move.thrustSelect) {
        const ts = move.thrustSelect;
        thrustUsed = clamp(n(item.hits, n(ts['default'], n(ts.max, 14))), n(ts.min, 5), n(ts.max, 14));
        const tick = move.thrustHits[0];
        const seq = seqHits.slice();
        for (let i = 0; i < thrustUsed && tick; i++) seq.push(Object.assign({}, tick, { thrustIndex: i + 1 }));
        const fin = thrustUsed >= n(ts.max, 14) ? (move.finHits || []) : (move.finSimpleHits || []);
        fin.forEach((h) => seq.push(Object.assign({}, h, { thrustFinisher: true })));
        seqHits = seq;
        // 已自行展开成「突刺 + N 连打 + 终结」→ 不再走 hitSelect 的「取前 N 个」截断
        hitLimit = null;
        truncated = false;
      }
      // ② 瓶爆：**开刃**状态下剑形态攻击附带（数据层逐行声明段数与属补，如压缩解放 r93 ×3 属补 0.8）
      let swaxPhialN = 0;
      if (isSWAX && swaxAwakened && swaxPhialSrc) {
        const extra = [];
        swaxPhialSrc.forEach((h) => {
          const n2 = Math.max(1, n(h.phialHits, 1));
          for (let i = 0; i < n2; i++) extra.push(Object.assign({}, h, { phialIndex: i + 1, elemRate:swaxPhialKind==='element'?n(h.elemRateElement,h.elemRate):n(h.elemRatePower,h.elemRate) }));
        });
        swaxPhialN = extra.length;
        seqHits = seqHits.concat(extra);
      }
      // ③ 能量不足 → 装瓶动作（伤害 0；界面标「装瓶」）
      if (swaxReload) seqHits = seqHits.map((h) => Object.assign({}, h, { mv: 0, swaxReload: true }));
      // ④ 抵消上捞斩 GP 当身成功 → 换成当身成立的两段（r36 + r72）
      if (isSWAX && move.gpOption && item && item.gp === true && (move.gpRows || []).length) {
        seqHits = move.gpRows.map((h) => Object.assign({}, h, { gpSuccess: true }));
      }
      if(isSWAX&&swaxAwakened&&move.phialPerHit){
        const ph=move.phialPerHit;swaxPhialN=seqHits.filter(h=>h.formOverride!=='axe').length;
        seqHits=seqHits.flatMap(h=>h.formOverride==='axe'?[h]:[h,{...ph,formOverride:'sword',elemRate:swaxPhialKind==='element'?ph.elemRateElement:ph.elemRatePower}]);
      }

      // ===== 盾斧：形态倍率 / 电锯跳数 / 瓶爆 =====
      // 红盾：斧形态招式 ×1.1。高速变形**不在这里**乘 —— 它单独走 p.morphMult，
      // 这样 effectiveMv（界面显示的动作值）也能带上它，且不会被乘两遍。
      const cbAxe = isCB && move.form === 'axe';
      const cbMoveMul = isCB && cbAxe && cbRedShield ? n(cbMul.redShieldMove, 1.1) : 1;
      // 高速变形（用户 2026-09-30 口径）：**凡触发剑斧形态变化就吃**，不加白名单。
      //   判据 = 打这一刀时剑斧形态变了：上一招打完的形态（cbFormState）≠ 这一招打完的形态。
      //   → 盾突刺/防御 之后派生的大解·超解（剑→斧）、斧形态的变形斩（斧→剑）都自动吃；
      //     同形态内的招式（一解、二解、红剑…)不吃。狂龙衣加段也不吃（在 hit 参数里按 isMantle 归零）。
      // 注意 cbFormState 用**打出这一刀时的形态**：
      //   招式声明了 form → 就是它；不限起手形态的招式（swingForm，如超解：剑也能直接出）→ 取派生链上的实际形态，
      //   再与「挥砍形态 swingForm」比较：剑形态出的超解 = 出招时变斧 → 发生了形态变化 → 吃高速变形。
      const cbFormState = cbFormPrev || move.swingForm || move.form || null;
      const cbSwingForm = move.swingForm || move.form || null;
      // 斩击斧：变形斩「能量是否充足」（swaxReload 在 SWAX 块最前面声明）—— 不足 → 装瓶动作：
      //   不变形（打完形态 = 出招形态）、不吃高速变形、伤害按装瓶 0 计
      const cbLeaveForm = swaxReload ? cbFormState : cbFormAfterMove(move, item);
      // 这一招「出招时」有没有换形态：进招时人在的形态 ≠ 挥砍形态
      //   （斧：变形斩 剑→斧、剑形态出的超解 剑→斧、斧形态出的集中二连斩 斧→剑 …）
      const cbEntryChange = !!(cbFormState && cbSwingForm && cbSwingForm !== cbFormState);
      // 招式自身就是变形招式（数据层 morph：swingForm ≠ 打完后的形态）→ **整招都吃**，含电锯跳数（用户 2026-09-30）
      //   例外：autoReturn（超解——那是自己演出收回剑，用户：「超解自己变回剑怎么会吃呢，
      //   要后续派生的招式导致形态变化才吃」）→ 不吃，只能靠后续招式触发
      const cbSelfMorph = !!(move.morph && !move.autoReturn);
      const morphOn = !!(hasForm && (cbEntryChange || cbSelfMorph || swaxAimMorph) && !swaxReload);
      const morphMul = morphOn ? n(state.morphMvPct, 1) : 1;
      let sawN = 0;
      if (isCB && move.sawOption) {
        sawN = clamp(n(item.saw, n(move.sawOption['default'], 4)), n(move.sawOption.min, 0), n(move.sawOption.max, 4));
      }
      // 瓶爆：各种解自带（一解1/二解2/大解2/追解3/超解0~5）；超解在大解·追解之后派生再多一层倍率
      const cbPhialSlot = (cbTable && move.phial) ? (cbTable[cbPhialKind] || {})[move.phial] : null;
      let phialN = 0;
      if (isCB && cbPhialSlot) {
        phialN = move.phialOption
          ? clamp(n(item.phial, n(move.phialOption['default'], 5)), n(move.phialOption.min, 0), n(move.phialOption.max, 5))
          : n(move.phialCount, 0);
        // 二解：每段命中各爆一次（选 1 hit 就只爆 1 次 —— 用户拍板）
        if (move.phialPerHit) {
          const bladeHits = hitLimit != null ? Math.min(seqHits.length, hitLimit) : seqHits.length;
          phialN = Math.min(phialN, bladeHits);
        }
      }
      const phialChain = isCB && move.phial === 'ultra' && prevPhialKind === 'high';

      // 伤口追加 hit 的插入位置：woundExtraAt（大剑集中贯穿斩 = 2，紧跟在起手 2 hit 之后）；
      //   未声明时沿用老口径（追加在整段命中之后，如大锤震打）
      // 盾斧先裁主体命中，电锯追加不占主体段数；每个主体命中后各追加用户所选跳数。
      if(isCB && hitLimit!=null && !sequenceVariant) {seqHits=seqHits.slice(0,hitLimit);hitLimit=null;}
      const baseSeq = seqHits.flatMap(function (h) {
        const out=[{hit:h,mantle:false,wound:false}];
        if(isCB&&sawN>0&&cbSaw)for(let k=0;k<sawN;k++)out.push({hit:cbSaw,mantle:false,wound:false,saw:k+1,sawMax:sawN});
        return out;
      });
      const woundSeq = woundList.map(function (h) { return { hit: h, mantle: false, wound: true }; });
      const woundAt = (woundSeq.length && move.woundExtraAt != null)
        ? clamp(n(move.woundExtraAt, 0), 0, baseSeq.length)
        : null;
      const hitSeq = (woundAt == null ? baseSeq : baseSeq.slice(0, woundAt).concat(woundSeq, baseSeq.slice(woundAt)))
        .concat(mantleList.map(function (h) { return { hit: h, mantle: true, wound: false }; }))
        .concat(woundAt == null ? woundSeq : [])
        // 炮击系（铳枪）：与主命中分离的附加命中口径 —— 单独标注、伤害计入总伤害，不进动作值/耗斩合计
        .concat(((isGL && move.shellHits) ? move.shellHits : []).map(function (h) {
          return { hit: h, mantle: false, wound: false, shelling: true };
        }));

      // 狩猎笛附加命中（固伤，像猎虫那样单独标注、伤害计入总伤害但不进武器动作值/耗斩口径）：
      //   ① 演奏音波 + 旋律生效时音波：自动挂在 演奏/奏击/重奏 上
      //   ② 响玉共鸣：每颗响玉各触发一次（常态招式 → 平A共鸣；演奏/奏击/重奏 → 演奏共鸣）
      const soundVariant = move.soundOption && (move.soundOption.variants[item.sound ?? move.soundOption.default] || move.soundOption.variants[0]);
      const followingMelody = soundVariant && /^(horn_wave_|horn_melody_)/.test(comboList[comboIdx+1]?.moveId || '');
      if (move.soundHits && move.soundHits.length && (!soundVariant || soundVariant.sound && (!followingMelody || move.soundCountOption))) {
        const soundN=move.soundCountOption?clamp(n(item.soundCount,move.soundCountOption.default),move.soundCountOption.min,move.soundCountOption.max)-1:1;
        for(let j=0;j<soundN;j++)move.soundHits.forEach(function (h) {hitSeq.push({ hit: h, mantle: false, wound: false, hornSound: true });});
      }
      if(selectWoundOn&&move.balladFinishHit&&n(params.balladCount,0)>0)hitSeq.push({hit:move.balladFinishHit,mantle:false,wound:false,hornSound:true});
      {
        const balladN = clamp(n(params.balladCount, 0), 0, 3);
        const balladHit = (balladN > 0 && balladTable && move.balladProc) ? balladTable[move.balladProc] : null;
        if (balladHit) {
          for (let k = 0; k < balladN; k++) {
            hitSeq.push({ hit: balladHit, mantle: false, wound: false, hornSound: true, ballad: k + 1 });
          }
        }
      }

      // 盾斧附加命中：电锯跳数（斧形态招式，超解除外）+ 瓶爆（各种解 / 红剑的每个剑 hit / 红盾盾突）
      if (isCB && cbTable) {
        const pushPhial = function (slot, n2) {
          for (let k = 0; k < n2; k++) hitSeq.push({ hit: slot, mantle: false, wound: false, phialKind: cbPhialKind, phialIndex: k + 1, phialChain: phialChain });
        };
        if (phialN > 0 && cbPhialSlot) {
          // 表内分状态行两种写法（按行取值，不按瓶种一刀切）：
          //   ① 带红斧条件的那对行（只有 1解/突进1解/2解）：强化瓶且没开红盾 → 强化瓶行；其余（红斧 或 普通瓶）→「红斧或普通瓶」行
          //   ② 不带红斧条件的行（大解/追解/超解）：只分普通瓶与强化瓶 —— 强化瓶就取强化瓶那行
          //      （r85 = 20 而不是 r84 = 16；属性瓶 r96 = 6 而不是 r95 = 4.2）
          const slot = cbPhialSlot.redAxeRule
            ? ((cbReinforced && !cbRedShield) ? (cbPhialSlot.reinforcedOnly || cbPhialSlot.redShieldOrNormal) : cbPhialSlot.redShieldOrNormal)
            : (cbReinforced ? (cbPhialSlot.reinforcedOnly || cbPhialSlot.redShieldOrNormal) : cbPhialSlot.redShieldOrNormal);
          pushPhial(slot, phialN);
        }
        // 红剑：剑形态任意招式的每个 hit 都附带 1 次瓶爆（表内 r78 / r89）
        if (cbRedSword && !cbAxe && move.form === 'sword' && move.hits.length) {
          pushPhial((cbTable[cbPhialKind] || {}).swordRedHit, sequenceVariant ? seqHits.filter(h=>h.formOverride==='sword').length : move.hits.length);
        }
        // 红盾盾突：盾突刺附带 1 次瓶爆（表内 r80 / r90）
        if (cbRedShield && move.redShieldPhial) pushPhial((cbTable[cbPhialKind] || {}).shield, 1);
      }

      // 这一招的 hit 在 hits 数组里的起点（打断上一个蓄力斩时要回头把这些 hit 归零）
      const hitsStart = hits.length;
      // 上一刀在 hits 里的区间起点（0 伤害节点如「格挡」不产生 hit → 它不改变这个值，
      //   所以「紧邻的上一刀」指的是**上一把真正打出 hit 的招**）
      const prevHitsStart = hitsStartOfLast;

      let firstWeaponHitDamage = null;
      hitSeq.forEach(function (entry) {
        const hit = entry.hit;
        const isMantle = entry.mantle;
        if (hit && hit.shelling) entry.shelling = true;   // 炮击系 hit（数据层用 shellHits 挂载）

        // ===== 盾斧瓶爆（附加命中）：按瓶种走两条完全不同的公式，且都不吃会心/斩味 =====
        //   榴弹瓶：最终攻击力 × 瓶动作值/100（连肉质都不看）
        //   强属性瓶：(属性值/10) × 瓶属补 × 属性肉质/100（吃属性吸收）
        if (entry.phialKind) {
          const isElem = entry.phialKind === 'element';
          const chainMul = entry.phialChain
            ? (isElem ? (cbReinforced?14:10)/n(hit.elemRate,1) : (cbReinforced?45:38)/n(hit.mv,1))
            : 1;
          const redMul = cbRedShield ? (isElem ? n(cbMul.redShieldElement, 1.3) : 1.2) : 1;
          let pr = 0, pe = 0;
          if (isElem) {
            const elemZone = n(params.hitzones && params.hitzones[params.elementType], params.hitzoneElement);
            pe = Math.max(0, (cbElemDisplay / 10) * n(hit.elemRate, 1) * (elemZone / 100) * redMul * chainMul);
          } else {
            // 炮术只加榴弹瓶瓶爆（用户拍板）：招式伤害与红盾倍率都不受影响
            pr = Math.max(0, attackFinal * (n(hit.mv, 0) / 100) * redMul * chainMul * n(state.impactPhialPct, 1));
          }
          const pStun = isHead ? n(hit.stun, 0) * n(state.stunMult, 1) : 0;
          const pr2 = Math.max(0, pr);
          const pe2 = Math.max(0, pe);
          hits.push({
            moveId: move.id, moveName: moveLabel,
            phial: true, phialKind: entry.phialKind, phialIndex: entry.phialIndex, phialChain: !!entry.phialChain,
            phialMv: n(hit.mv, 0), phialElemRate: n(hit.elemRate, 1),
            phialMultiplier: redMul * chainMul,
            charge: null, chargeUnit: null, mantle: false, wound: false, spin: null, dance: null,
            hitLimit: null, hitMax: null,
            raw: pr2, element: pe2, total: pr2 + pe2, status: 0, stun: pStun,
            mv: n(hit.mv, 0), effectiveMv: 0, elemRate: n(hit.elemRate, 1), statusRate: 0,
            sharpCost: 0, noSharp: true, hien: false, kinsect: false, isWeak: false,
            type: 'phial', affinityUsed: 0, mvEffMul: 1
          });
          totalRaw += pr2;
          totalElement += pe2;
          totalStun += pStun;
          return;   // 瓶爆不进动作值三档、不推进连击（附加命中口径），也不耗斩
        }

        // ===== 铳枪炮击系（附加命中口径）：不吃肉质/会心/斩味，单列展示 =====
        //   只有 weaponId === 'gunlance' 的招式才带 shelling 标记（数据层只给铳枪写；这里再硬拦一层，
        //   别的武器就算数据被污染也进不来 —— 用户拍板：专属机制按武器标识硬拦截）
        if (entry.shelling && isGL) {
          // 炮击系的两个「吃环境」的部分（都按估算器公式）：
          //   · 龙杭火花：物理段吃斩肉质 × 会心期望
          //   · 附带火属性：属性段吃火属性吸收（炮击附带的是火属性）
          const shellZone = n(params.hitzones && params.hitzones.Slash, n(params.hitzoneRaw));
          const shellAff = clamp(
            state.affinity + ((shellZone > 45) ? state.weakSpotAffinity : 0) + (isWound ? state.woundAffinity : 0),
            -100, 100
          );
          const shellCrit = rawCritMultiplier(shellAff, state.critMult, params.mode);
          const glElemPanel = (params.elementType && params.elementType !== 'None')
            ? Math.min(elementCap(params.element), n(params.element) * state.elementPct + state.elementFlat
              + state.absorbElemFlat + state.dragonElemFlat)
            : 0;
          const sr = calcShelling({
            shelling: hit.shelling || {},
            shellTable: GL_TABLE,
            shellType: glType,
            shellLevel: glLevel,
            baseAttack: baseAttack,
            // 与估算器 skill_data!C2 同口径：面板 × 全部乘算（基础乘区 × 其他乘区），**不取整**
            shellBaseAllMuls: n(params.attack) * (state.baseAttackPct+state.baseAttackBonusPct) * state.attackPct,
            // 与估算器 skill_data!D2 同口径：全部加算（基础加算 + 其他加算 + 灯具加值）
            atkFlatPool: state.baseAttackFlat + state.attackFlat + n(lampFlat),
            artyMul: state.gunlanceArtyMul,
            artyAdd: state.gunlanceArtyAdd,
            shellAmmoUsed: ((move.shellHits || []).filter(function (h) {
              return h.shelling && h.shelling.move === 'wyrmstake';
            }).length > 1) ? 1 : 0,
            shellCapAdd: state.gunlanceShellAdd,   // 炮弹装填（增弹）：装填数 +1 → 全弹发射多发一发
            // 全弹发射的「发炮数」选项（用户 2026-10-01）：用户在界面上选发几炮；上限 = 类型装填数 + 增弹
            fullBurstCount: (item && item.shells != null) ? n(item.shells) : null,
            sparkZone: shellZone,
            sparkCrit: shellCrit,
            fireZone: n(params.hitzones && params.hitzones.Fire, 0),
            elemZone: n(params.hitzones && params.hitzones[params.elementType], 0),
            elemValue: glElemPanel
          });
          const srRaw = Math.max(0, n(sr.raw, 0)) * n(params.enrageMul, 1);   // 炮击系固伤也吃发怒受击倍率（用户 2026-10-08：全部吃）
          const srElem = Math.max(0, n(sr.element, 0)) * n(params.enrageMul, 1);
          const scKind=hit.shelling.move,scTable={normal:{shot:.2,chargeShot:.3,fullBurst:.1},wide:{shot:.4,chargeShot:.5,fullBurst:.3},long:{shot:.3,chargeShot:.4,fullBurst:.2}};
          const firstWyvern=hitSeq.find(e=>e.hit?.shelling?.move==='wyvernfire')===entry;
          const shellSharp=(scKind==='wyvernfire'?(firstWyvern?2:0):scKind==='fullBurst'?(scTable[glType]?.fullBurst||.1)*n(sr.count,1):scTable[glType]?.[scKind]||0)*10;
          totalSharpCost+=shellSharp;
          hits.push({
            moveId: move.id, moveName: moveLabel,
            shelling: true, shellMove: sr.move, shellTypeKey: sr.shellType, shellLevelKey: sr.shellLevel,
            shellMv: sr.mv, shellCount: sr.count, shellCoeff: sr.coeff, shellFire: sr.fire,
            shellElemZone: sr.elemZone, shellSpark: !!sr.spark, shellElement: srElem,
            shellUnavailable: !!sr.unavailable,
            charge: null, chargeUnit: null, mantle: false, wound: false, spin: null, dance: null,
            hitLimit: null, hitMax: null,
            raw: srRaw, element: srElem, total: srRaw + srElem, status: 0, stun: 0,
            mv: sr.mv, effectiveMv: 0, elemRate: 0, statusRate: 0,
            sharpCost: 0, noSharp: true, hien: false, kinsect: false, isWeak: false,
            type: 'shelling', affinityUsed: 0, mvEffMul: 1, sharpCost:shellSharp,
            hand: null, loopIndex: null, loopRound: null, hitUnit: null, loopHits: null, loopRounds: null
          });
          totalRaw += srRaw;
          totalElement += srElem;
          shellHits += 1;
          shellRaw += srRaw;
          shellElem += srElem;
          shellMv += n(sr.mv, 0);
          if (sr.fire) shellFireTotal += n(sr.fire, 0) * Math.max(1, n(sr.count, 1));
          return;   // 不进动作值三档、不推进连击、不耗斩
        }

        if (!isMantle && hitLimit != null && hit.type !== 'insect') {
          if (bladeSeen >= hitLimit) { truncated = true; return; }   // 达到段数上限，后续段全部跳过
          bladeSeen += 1;
        } else if (!isMantle && hitLimit != null && truncated) {
          return;   // 已到上限后残留的猎虫段也一并跳过
        }
        // 力防加成：只给本招**自己的命中**（狂龙衣加段 / 伤口追加段是附加命中 → 不吃也不占额度），
        //   且只给前 N hit（表内 r116 口径 = 前 3 hit）
        const fgThis = (!isMantle && !entry.wound && fgRemain > 0) ? n(forceGuard.mul, 1) : 1;
        if (fgThis !== 1) { fgRemain -= 1; fgApplied += 1; }
        let r = calcHit({
          hit: hit,
          hitzones: params.hitzones,
          hitzoneRaw: params.hitzoneRaw,
          hitzoneElement: params.hitzoneElement,
          elementType: params.elementType,
          statusType: params.statusType,   // 「无」异常 → 异常链路归零
          threeLamp: threeLamp,            // 三灯：动作值取 mvLamp + 攻击力加算
          lampFlat: move.noLampBonus ? 0 : lampFlat,
          baseAttack: baseAttack,          // 基础攻击力（含「攻击」技能）
          attack: n(params.attack),        // 面板输入值（仅用于面板显示/兜底）
          element: n(params.element),
          elementDisabled: noElemType,     // 面板选「无」属性 → 猎虫也不吃属性
          kinsect: kinsectCfg,             // 猎虫（共斗虫）配置：虫种 + 等级 → 威力倍率
          status: n(params.status),
          sharpness: sharpness,
          sharpGreen: params.sharpGreen,   // 绿斩倍率（狩猎笛响周波固定绿斩用）
          state: state,
          mode: params.mode || 'expected',
          // 狂龙衣装加段：表内给的就是它自己的实测动作值/属补/耗斩（独立于原招式），
          // 不再吃原招式的蓄力倍率（大剑那些「3 蓄才有」的加段已在数据层按档位挂好）
          chargeMul: isMantle ? 1 : chargeMul,
          danceMul: danceMul,
          // 长枪力防：紧接力量格挡之后的那一招前 N hit 的动作值倍率（只作用动作值）
          forceGuardMul: fgThis,
          chargeable: usesCharge,
          hien: !!hit.hien,   // 飞燕适用（表列39 IsSkillHien）
          // 高速变形适用：**打这一刀时剑斧形态变了**（上一招打完的形态 ≠ 这一招打完的形态）；
          //   狂龙衣加段是「由主命中派生的附加命中」，用自己的动作值 → 不吃（与蓄力倍率同口径）
          morphMult: (isMantle || !morphOn || hit.morphEligible === false) ? 1 : morphMul,
          // 斩斧红斧：斧形态攻击力+10；强击瓶：剑形态攻击力×1.17。
          // 强属性瓶保持基础属性×1.45；字段名兼容旧参数，计算位置由calcHit处理。
          swaxBasePct: (isSWAX && swaxPhialKind === 'power' && ((hit.formOverride||move.form) === 'sword'||hit.swaxPhial)) ? 1.17 : 1,
          // 太刀「有气」：招式级开关（默认开）→ 该招的 hit 取表内 col81 有气动作值
          lsQiOn: !(item && item.qi === false),
          // 太刀刃色（招式内自选）：白刃 ×1.05 / 黄刃 ×1.075 / 红刃 ×1.10 基础攻击力（用户 2026-10-06 拍板）
          baseAtkPct: hit.baseAtkPct != null ? n(hit.baseAtkPct,1) : (lvPick && lvPick.atkPct) ? n(lvPick.atkPct, 1) : 1,
          swaxBaseAdd: (isSWAX && swaxRedAxe && (hit.formOverride||move.form) === 'axe') ? 10 : 0,
          swaxElemPct: (isSWAX && swaxPhialKind === 'element' && ((hit.formOverride||move.form) === 'sword'||hit.swaxPhial)) ? 1.45 : 1,
          prevForm: cbFormState,   // 打这一刀时人在哪个形态（计算事实，不再手写适用名单）
          isWound: isWound,   // 命中伤口（由部位肉质状态自动应用）
          isHead: isHead,     // 头部才累计晕厥
          // 怪物发怒受击倍率（用户 2026-10-08）：数据库 AngryTable.PlDamage —— 只作用最终伤害
          enrageMul: n(params.enrageMul, 1),
          // 高速变形（盾斧）：变形类招式的动作值也吃 ×1.2/1.1/1.05 —— 显示值必须等于生效值
          cbMoveMul: hit.formOverride === 'sword' ? 1 : hit.formOverride === 'axe' && cbRedShield ? 1.1 : cbMoveMul,
          cbElementMul: hit.formOverride === 'sword' ? 1 : hit.formOverride === 'axe' && cbRedShield ? 1.1 : cbMoveMul,
          // 大剑集中贯穿斩：追击跳数的逐跳衰减倍率（表内 col55 曲线；未标记的 hit 取 1）
          tickDecay: n(hit.tickDecay, 1),
          hitIndex: hitIndex
        });
        // 精确复用同招首hit，避免追加时连击等档位改变造成伤害不同；只去掉耗斩。
        if (hit.woundRepeatFirst && firstWeaponHitDamage) {
          r = Object.assign({}, firstWeaponHitDamage, { sharpCost: 0, noSharp: true });
        } else if (!firstWeaponHitDamage && !isMantle && !entry.wound && hit.type !== 'insect') {
          firstWeaponHitDamage = Object.assign({}, r);
        }
        hits.push({
          moveId: move.id,
          moveName: moveLabel,
          // 表内给了逐档动作值的招式：报用户选的那一档（界面显示值 = 实际生效值）
          charge: lvPick ? lvPick.level : (usesCharge ? chargeLevel : null),
          chargeUnit: levelUnit,
          chargeLevels: lvList ? lvList.map(function (l) { return l.level; }) : null,
          chargeInherited: !!move.inheritCharge,
          mantle: isMantle,        // 狂龙衣装加段（界面单独标注）
          swaxPhial:!!hit.swaxPhial,
          weakSwapped: weakSwapped,   // 大剑真蓄：本段换成了强击数值（界面标注）
          wound: entry.wound,      // 命中伤口/绽伤时的追加 hit（界面单独标注）
          saw: entry.saw || null,  // 电锯跳数（盾斧斧形态招式）
          sawMax: entry.sawMax || null,
          hornSound: !!entry.hornSound,   // 狩猎笛音波 / 响玉共鸣（单列展示，口径同猎虫）
          ballad: entry.ballad || null,   // 第几颗响玉
          cbForm: hasForm ? move.form : null,
          spin: spinCount || null, // 该招的圈数（大锤回旋攻击/追击回旋敲打才有值）
          spinIndex: hit.spinIndex || null,   // 本 hit 是第几圈
          spinMax: sp ? n(sp.max) : null,
          dance: danceUsed,        // 该招生效的舞踏层数（自动累计）
          hitLimit: hitLimit,      // 该招实际打出的棍段数（可自选段数的招式才有值）
          hitMax: hs ? n(hs.max) : null,
          hitUnit: hs && hs.unit ? hs.unit : null,   // 可自选段数的单位（双刀回天突刺 = 「轮」）
          loopHits: hs && hs.loopHits ? n(hs.loopHits) : null,
          loopRounds: loopRounds,                    // 用户选的轮数（轮数模型展开后回传，界面据此标「N 轮」）
          loopIndex: hit.loopIndex || null,          // 本刀是循环段里的第几刀
          loopRound: hit.loopRound || null,          // 本刀属于第几轮
          // 双刀：这一刀是右手还是左手（表内行名/日文名的 R/L 判定，生成期已守卫）
          hand: hit.hand || null,
          ...r
        });
        totalRaw += r.raw;
        totalElement += r.element;
        totalStatus += r.status;
        totalStun += r.stun;
        if (r.kinsect) {
          // 猎虫攻击：伤害照算（hasmine 模型），但不进棍子口径 ——
          // 不计耗斩、不进动作值三档，也不推进 hitIndex（连击按猎人命中数计档）
          insectHits += 1;
          insectMv += r.mv;                    // r.mv 已按当前灯态取值
          insectElemRate += n(hit.elemRate, 1);
          insectRaw += r.raw;
          insectElement += r.element;
        } else if (entry.hornSound) {
          // 狩猎笛音波 / 响玉共鸣：伤害照算，但不进武器动作值三档、不耗斩（与猎虫同口径）
          soundHits += 1;
          soundMv += r.mv;
          soundRaw += r.raw;
          soundElement += r.element;
          soundStun += r.stun;
        } else {
          // 不耗斩味的 hit（列58）不并入总耗斩（即使数据层漏把 sharpCost 归零也不高估）
          if (!r.noSharp) totalSharpCost += r.sharpCost;
          // 动作值三档：原始 / 计飞燕 / 计飞燕+蓄力+舞踏+高速变形（原始值按当前灯态取）
          totalMv += r.mv;
          totalMvAfterHien += r.mv * (r.hien ? r.airborneMult : 1) * n(r.morphMult, 1);
          totalMvEffective += r.effectiveMv;
          // 狂龙衣加段是真实命中（伤害/耗斩/动作值照算），但按「由主命中派生的附加命中」口径
          // 不推进连击档位计数（界面单独标注）。
          if (!isMantle) hitIndex += 1;   // 连击档位只按棍子命中数推进
        }
      });

      // 本招真的有 hit → 记下起点，给下一招的「打断上一个蓄力斩」用
      if (hits.length > hitsStart) hitsStartOfLast = hitsStart;

      // ===== 集中处决「爆伤口」（用户 2026-10-08）=====
      //   勾了「命中伤口」且本招带伤口系数表（数据层 woundBurst）时，命中处数决定一次额外伤害：
      //     伤害 = 伤口系数（1 处 30 / 2 处 50 / 3 处 80）× 任务Scar Raw × 人数倍率 × 历战伤口倍率
      //            × 破坏王（每级 +10%，woundBurstPct）
      //   不吃肉质 / 会心 / 斩味 / 属性 / 发怒受击倍率 —— 与炮击系同为「附加命中」，单列展示
      if (woundOn && move.woundBurst && !(move.skipPrefixAfter && comboList[comboIdx-1]?.moveId === move.skipPrefixAfter && comboList[comboIdx-1]?.wound) && n(params.scarRaw, 0) > 0) {
        const wc = clamp(Math.round(n(item && item.woundCount, 1)), 1, 3);
        const coeff = n(move.woundBurst[wc] != null ? move.woundBurst[wc] : move.woundBurst[1], 0);
        const legendary = item && typeof item.woundLegendary === 'boolean' ? item.woundLegendary : !!params.scarLegendary;
        const legendaryMul = legendary ? 1.3 : 1;
        const burstRaw = Math.max(0, coeff * n(params.scarRaw, 0) * legendaryMul * n(state.woundBurstPct, 1));
        hits.push({
          moveId: move.id, moveName: moveLabel,
          woundBurst: true, woundCount: wc, woundCoeff: coeff, woundScarRaw: n(params.scarRaw, 0),
          woundBurstPct: n(state.woundBurstPct, 1),
          woundLegendaryMul: legendaryMul,
          charge: lvPick ? lvPick.level : null, chargeUnit: levelUnit,
          mantle: false, wound: false, saw: null, sawMax: null, hornSound: false, ballad: null,
          cbForm: null, spin: null, spinIndex: null, spinMax: null, dance: null,
          hitLimit: null, hitMax: null, hitUnit: null, loopHits: null, loopRounds: null, loopIndex: null, loopRound: null,
          hand: null, kinsect: false, shelling: false, isWeak: false, type: 'woundBurst',
          raw: burstRaw, element: 0, total: burstRaw, status: 0, stun: 0,
          mv: 0, effectiveMv: 0, elemRate: 0, statusRate: 0,
          sharpCost: 0, noSharp: true, hien: false, affinityUsed: 0, mvEffMul: 1,
          tickDecay: null, forceGuard: false, morph: false, prevForm: null,
          chargeLevels: lvList ? lvList.map(function (l) { return l.level; }) : null,
          chargeInherited: false, weakSwapped: false
        });
        totalRaw += burstRaw;
        woundBurstHits += 1;
        woundBurstRaw += burstRaw;
      }

      // ===== 打断上一个蓄力斩（大剑冲撞攻击的招式选项，用户 2026-10-01）=====
      //   本招勾了 → 紧邻在它前面的那一刀（cancelMovable：蓄力斩/强蓄力斩/真蓄力斩）整体取消：
      //   这些 hit 的伤害全部归零、标 cancelled:true，并把它们已经累加进合计的
      //   物理/属性/异常/晕厥、动作值三档、耗斩全部扣回来（汇总 = 实际生效值）。
      //   被取消的那一刀在 hits 里的区间 = 本招起点 hitsStart 之前的那一段（prevStart ~ hitsStart）。
      //   耗斩按「取消这一刀」处理 = 不耗斩（标 noSharp，界面也不会再报耗斩）。
      if (cancelInfo) {
        for (let hi = prevHitsStart; hi < hitsStart; hi++) {
          const h = hits[hi];
          totalRaw -= h.raw; totalElement -= h.element;
          totalStatus -= h.status; totalStun -= h.stun;
          h.raw = 0; h.element = 0; h.total = 0; h.status = 0; h.stun = 0;
          if (h.kinsect) {
            h.mv = 0; h.effectiveMv = 0;
          } else if (h.hornSound) {
            // 音波/响玉共鸣：单列合计也要跟着扣（下面按 hits 重算，这里只需把该 hit 归零）
          } else if (h.shelling) {
            // 炮击系：单列合计也要跟着扣（下面按 hits 重算）
          } else {
            totalMv -= n(h.mv, 0);
            totalMvAfterHien -= n(h.mv, 0) * (h.hien ? n(h.airborneMult, 1) : 1) * n(h.morphMult, 1);
            totalMvEffective -= n(h.effectiveMv, 0);
            if (!h.noSharp) totalSharpCost -= n(h.sharpCost, 0);
            h.mv = 0; h.effectiveMv = 0; h.sharpCost = 0; h.noSharp = true;
          }
          h.cancelled = true;
          h.cancelledBy = cancelInfo.prevMoveId;
        }
        // 单列口径（猎虫 / 音波响玉 / 炮击系）按 hits 重算，避免累加项与逐刀明细脱节
        insectHits = 0; insectMv = 0; insectElemRate = 0; insectRaw = 0; insectElement = 0;
        soundHits = 0; soundMv = 0; soundRaw = 0; soundElement = 0; soundStun = 0;
        shellHits = 0; shellRaw = 0; shellMv = 0; shellFireTotal = 0; shellElem = 0;
        woundBurstHits = 0; woundBurstRaw = 0;
        hits.forEach(function (h) {
          if (h.kinsect) {
            insectHits += 1; insectMv += n(h.mv, 0); insectElemRate += n(h.elemRate, 1);
            insectRaw += h.raw; insectElement += h.element;
          } else if (h.hornSound) {
            soundHits += 1; soundMv += n(h.mv, 0); soundRaw += h.raw;
            soundElement += h.element; soundStun += h.stun;
          } else if (h.shelling) {
            shellHits += 1; shellMv += n(h.shellMv, 0); shellRaw += h.raw;
            shellElem += n(h.shellElement, 0);
            shellFireTotal += n(h.shellFire, 0) * Math.max(1, n(h.shellCount, 1));
          } else if (h.woundBurst) {
            woundBurstHits += 1; woundBurstRaw += h.raw;
          }
        });
      }

      prevCharge = chargeLevel;   // 记录本招蓄力等级，供下一招继承
      // 长枪力防：本招是力量格挡 → 按「力防层数」给下一招挂加成（0 层不加伤害 → 不挂）
      if (move.forceGuardBuff) {
        const fgb = move.forceGuardBuff;
        const fgLv = clamp(n(item.forceGuard, n(fgb['default'], 0)), n(fgb.min, 0), n(fgb.max, 3));
        const fgMul = n((fgb.multipliers || [])[fgLv], 1);
        if (fgMul !== 1) {
          pendingForceGuard = { mul: fgMul, hits: clamp(n(fgb.hits, 3), 1, 99), level: fgLv };
        }
      }
      // 本招实际吃到的力防加成 → 回传给界面（连段行 / 结果卡据此标注「力防 ×1.3（前 3 hit）」）
      if (forceGuard && fgApplied > 0) {
        forceGuardUsed.push({
          comboIndex: comboIdx, moveId: move.id, moveName: moveLabel,
          level: forceGuard.level, mul: n(forceGuard.mul, 1), hits: fgApplied
        });
      }
      if (isCB) prevPhialKind = move.phial || null;   // 供「超解在大解/追解后派生」判定
      // 盾斧：把「这一招打完后的形态」记给下一招 —— 下一招据此判断有没有发生形态变化（高速变形）
      if (hasForm) cbFormPrev = cbLeaveForm;
      // 打完跳跃突进斩 → 舞踏层数 +1（上限 2），自动强化后续空中招式
      if (move.danceKey === 'jumpThrust') danceStacks = Math.min(danceStacks + 1, 2);
      for(let j=hitsStart;j<hits.length;j++)hits[j].comboIndex=comboIdx;
    }

    const totalDamage = totalRaw + totalElement;
    const isFixedHit=h=>!!(h.fixed||h.woundBurst||(h.phial&&h.phialKind==='impact')||(h.shelling&&!h.shellSpark));
    const totalFixed=hits.reduce((a,h)=>a+(isFixedHit(h)?h.raw:0),0);
    const totalPhysical=totalRaw-totalFixed;
    const totalMotionValue=hits.reduce((a,h)=>a+(!isFixedHit(h)?n(h.effectiveMv):0),0);
    const totalElementRate=hits.reduce((a,h)=>a+(!h.woundBurst?n(h.elemRate):0),0);
    const moveContributions=(params.combo||[]).map((it,i)=>{
      const hs=hits.filter(h=>h.comboIndex===i),damage=hs.reduce((a,h)=>a+h.total,0),fixed=hs.reduce((a,h)=>a+(isFixedHit(h)?h.raw:0),0);
      return {comboIndex:i,moveId:it.moveId,damage,fixed,physical:hs.reduce((a,h)=>a+h.raw,0)-fixed,element:hs.reduce((a,h)=>a+h.element,0),share:totalDamage>0?damage/totalDamage*100:0};
    });
    // （noElemType / noStatusType 已在上面声明：猎虫段也要用）
    // 面板汇总：基础值 → 技能/道具后（供 UI 显示「有技能后的数值」）
    // 武器类型选「无」时属性/异常整条链路归零（面板也显示 0）
    const elemAfterRaw = n(params.element) * state.elementPct + state.elementFlat + state.absorbElemFlat + state.dragonElemFlat;
    // 目标部位会心：弱点特效 / 伤口 按当前所选部位自动应用（弱点 = 该武器物理类型肉质 > 45）
    // 供面板与结果卡显示「最终会心率」时与逐刀判定保持一致
    const targetRawType = (WEAPONS.filter(function (w) { return w.id === params.weaponId; })[0] || {}).damageType || 'Slash';
    const targetRaw = n(params.hitzones && params.hitzones[targetRawType], n(params.hitzoneRaw));
    const targetIsWeak = targetRaw > 45;
    const affinityVsTarget = clamp(
      state.affinity + (targetIsWeak ? state.weakSpotAffinity : 0) + (isWound ? state.woundAffinity : 0),
      -100, 100
    );
    const panel = {
      attackBase: n(params.attack),        // 面板输入的基础攻击力
      baseAttackAfter: baseAttack,         // 基础攻击力（已向下取整）
      // 最终攻击力 = 基础攻击力 × 其他乘算 + Σ加算（其他技能/道具 + 三灯），再向下取整
      attackAfter: attackFinal,
      attackLampFlat: lampFlat,        // 面板里拆出三灯加值，便于界面标注
      attackOtherPct: state.attackPct, // 其他技能/道具的乘算（供面板说明）
      attackOtherFlat: state.attackFlat,
      elementBase: noElemType ? 0 : n(params.element),
      // 与 calcHit 的口径一致（含属性吸收/属性变换的加算），并套用 max(2.3倍, 400) 上限
      elementAfter: noElemType ? 0 : Math.min(elemAfterRaw, elementCap(params.element)),
      // 属性是否触到上限（供 UI 提示）
      elementCapped: !noElemType && elemAfterRaw > elementCap(params.element) + 1e-9,
      statusBase: noStatusType ? 0 : n(params.status),
      statusAfter: noStatusType ? 0 : n(params.status) * state.statusPct + state.statusFlat,
      affinityBase: clamp(n(params.affinity), -100, 100),
      affinityAfter: state.affinity,
      // 含目标部位判定的会心率（弱点特效 / 伤口自动应用）
      affinityVsTarget: affinityVsTarget,
      affinityTargetRaw: targetRaw,
      affinityTargetIsWeak: targetIsWeak,
      affinityTargetType: targetRawType,
      critMult: state.critMult,
      weakSpotAffinity: state.weakSpotAffinity,
      woundAffinity: state.woundAffinity
    };
    return {
      totalRaw, totalElement, totalDamage, totalStatus, totalStun,
      totalFixed,totalPhysical,totalMotionValue,totalElementRate,moveContributions,
      affinityVsTarget: affinityVsTarget,    // 结果卡「最终会心率」用（含弱点特效/伤口）
      attackFinal: attackFinal,
      totalSharpCost,                        // 连段总耗斩（10 = 面板1斩味 = 历代1刀）
      sharpKnives: totalSharpCost / 10,      // 折算成「刀」
      // 动作值三档（UI：原始值大字 + 飞燕后/生效值小字）
      totalMv: Math.round(totalMv * 100) / 100,                    // 表内原始动作值之和
      totalMvAfterHien: Math.round(totalMvAfterHien * 100) / 100,  // 只计飞燕倍率
      totalMvEffective: Math.round(totalMvEffective * 100) / 100,  // 计飞燕+蓄力+舞踏（算伤害用）
      insect: {                              // 猎虫段单独结算（不计入棍子动作值/耗斩）
        hits: insectHits,        mv: insectMv,
        elemRate: Math.round(insectElemRate * 100) / 100,
        raw: Math.round(insectRaw * 100) / 100,          // 猎虫物理伤害
        element: Math.round(insectElement * 100) / 100,  // 猎虫属性伤害
        damage: Math.round((insectRaw + insectElement) * 100) / 100,
        kinsectName: (params.kinsect && params.kinsect.kinsect
          && (params.kinsect.kinsect.nameZh || params.kinsect.kinsect.name)) || null,
        kinsectLevel: params.kinsect ? kinsectCfg.level : null,
        powerMult: params.kinsect ? kinsectCfg.powerMult : null   // 引擎按虫种+等级实际查到的威力倍率
      },
      sound: {                               // 狩猎笛音波 / 响玉共鸣（同样只算伤害，不进武器动作值/耗斩）
        hits: soundHits,
        mv: Math.round(soundMv * 100) / 100,
        raw: Math.round(soundRaw * 100) / 100,
        element: Math.round(soundElement * 100) / 100,
        stun: Math.round(soundStun * 100) / 100,
        damage: Math.round((soundRaw + soundElement) * 100) / 100
      },
      shelling: {                            // 铳枪炮击系（只算伤害，不进武器动作值/耗斩、不吃肉质/会心/斩味）
        enabled: isGL,        type: isGL ? glType : null,
        level: isGL ? glLevel : null,
        hits: shellHits,
        mv: Math.round(shellMv * 100) / 100,
        raw: Math.round(shellRaw * 100) / 100,
        element: Math.round(shellElem * 100) / 100,      // 炮击附带属性（固伤 + 属性伤害，吃属性吸收）
        fire: Math.round(shellFireTotal * 100) / 100,    // 表内附带火属性值（展示用）
        damage: Math.round((shellRaw + shellElem) * 100) / 100,
        artyMul: isGL ? Math.round(state.gunlanceArtyMul * 1e6) / 1e6 : 1,
        artyAdd: isGL ? state.gunlanceArtyAdd : 0,
        // 炮击系数（与估算器 skill_data!K1 同口径）：面板 × 全部乘算（不取整）× 炮术倍率 + 全部加算
        //   注意：炮术加算（artyAdd）**不进固伤**，只加到附带火属性 —— 别写回这里
        coefficient: isGL
          ? Math.round(((n(params.attack) * (state.baseAttackPct+state.baseAttackBonusPct) * state.attackPct) * state.gunlanceArtyMul
            + state.baseAttackFlat + state.attackFlat + n(lampFlat)) * 100) / 100
          : 0,
        coefficientFrom: isGL ? '（面板×全部乘算）×炮术倍率 + 全部加算 —— 与估算器 skill_data!K1 同口径' : null
      },
      // 集中处决「爆伤口」（用户 2026-10-08）：命中伤口后按处数造成的额外伤害，单列展示
      woundBurst: {
        hits: woundBurstHits,
        raw: Math.round(woundBurstRaw * 100) / 100,
        damage: Math.round(woundBurstRaw * 100) / 100,
        scarRaw: n(params.scarRaw, 0),
        pct: Math.round(n(state.woundBurstPct, 1) * 1e6) / 1e6,
        legendary: !!params.scarLegendary
      },
      blueDemon: {                           // 双刀蓝鬼（面板展示用：等效值 = 实际生效值）
        enabled: blueDemonOn,
        attackBaseMul: blueDemonMul,
        elementBaseAdd: blueDemonElemAdd,
        baseAttackBefore: Math.round(n(params.attack) * 1e6) / 1e6,
        baseAttackAfter: baseAttack,
        elementBase: noElemType ? 0 : n(params.element),
        elementAfter: noElemType ? 0 : Math.min(
          n(params.element) * state.elementPct + state.elementFlat + state.absorbElemFlat + state.dragonElemFlat,
          elementCap(n(params.element)))
      },
      dps: 0, // 帧数待填，暂不计算时长/DPS
      affinity: state.affinity,
      // 生效的旋律（用户 2026-09-30：不是单选，可多选）——melody 保留第一条供旧界面兼容
      melody: melody ? { id: melody.id, name: melody.name, note: melody.note || null } : null,
      melodies: activeMelodies.map(function (m) { return { id: m.id, name: m.name, note: m.note || null }; }),
      skillNotes: state.skillNotes || [],   // 选了但算不出来的技能（界面提示）
      threeLamp: threeLamp,    // 三灯是否生效（攻击力加算 + 移动斩/移动连斩 用 mvLamp）
      lampAtkFlat: lampFlat,   // 三灯攻击加值（基础攻击力 × 0.15，加算项；未开灯为 0）
      noElement: noElemType,   // 面板选「无」属性：UI 不必显示属补/属性相关列
      noStatus: noStatusType,  // 面板选「无」异常：UI 不必显示异常补/异常相关列
      danceStacks: danceStacks,   // 连段内累计的舞踏层数（自动）
      forceGuardUsed: forceGuardUsed,   // 长枪力防：连段里实际吃到加成的位置（招名/层数/倍率/吃到几 hit）
      panel,
      hits,
      state
    };
  }

  // ===================== 肉质适配（kuro-hzv.js） =====================
  // 从 window.MHWILD_KURO_HZV 抽取怪物/部位/普通肉质
  function buildMonsterParts(kuroHZV) {
    if (!kuroHZV) return [];
    return Object.keys(kuroHZV).map(function (monName) {
      const parts = Object.keys(kuroHZV[monName] || {}).map(function (partKey) {
        const p = kuroHZV[monName][partKey] || {};
        const grp = (p.groups && p.groups['普通']) || [];
        const meat = (grp[0] && grp[0].m) || p.wound || (grp[0] && grp[0]) || {};
        return { key: partKey, meat: meat };
      });
      return { name: monName, parts: parts };
    });
  }

  function rangedWholeMove(move,item){
    const variant=move.rangedVariants?.[item.rangedVariant??0]||move.rangedVariants?.[0]||{};
    const m={...move,...variant,id:move.id,name:move.name};
    const expand=(model,value)=>{
      const count=Math.floor(clamp(n(value,model.default),model.min,model.max)),out=[];
      // 一发弹／一支箭的全部命中相邻，速射及多箭按各自阶段展开，不把弹数误作阶段数。
      const width=Math.max(...model.stages.map(s=>s.hits.length));
      for(let projectile=0;projectile<width;projectile++)for(let k=1;k<=count;k++){
        const stage=model.stages.filter(s=>s.from<=k).at(-1);
        if(stage?.hits[projectile])out.push({...stage.hits[projectile]});
      }
      return out;
    };
    m.hits=m.rangedStages?expand(m.rangedStages,item.rangedHits):(item.wound&&m.woundHits?m.woundHits:m.hits).slice();
    if(item.wound&&m.rangedFollow)m.hits.push(...expand(m.rangedFollow,item.rangedFollowHits));
    if(item.counter&&m.counterHits)m.hits.push(...m.counterHits);
    if(m.rangedExtra){const count=Math.floor(clamp(n(item.rangedExtraHits,m.rangedExtra.default),m.rangedExtra.min,m.rangedExtra.max));for(let k=0;k<count;k++)m.hits.push(...m.rangedExtra.hits);}
    return m;
  }
  function migrateRangedCombo(combo,aliases){
    const out=[];
    for(const item of combo){
      const alias=item.rangedWholeVersion===1?null:aliases?.[item.moveId];
      const migrated=alias?{...alias,...item,moveId:alias.moveId,rangedWholeVersion:1}:{...item};
      const prev=out.at(-1);
      const guide=alias?.rangedLegacyGuideExplosion&&out.findLast(it=>it.moveId===migrated.moveId);
      if(guide)guide.rangedVariant=alias.rangedVariant;
      else if(alias?.rangedLegacyComponent&&prev?.moveId===migrated.moveId){
        if(alias.wound)prev.wound=true;
        if(alias.counter)prev.counter=true;
        if(alias.rangedFollowHits)prev.rangedFollowHits=Math.max(prev.rangedFollowHits||0,alias.rangedFollowHits);
        if(alias.rangedExtraHits)prev.rangedExtraHits=(prev.rangedExtraHits||0)+alias.rangedExtraHits;
      }
      else if(alias?.rangedLegacyPart&&prev?.rangedLegacyPart&&prev.moveId===migrated.moveId&&prev.rangedVariant===migrated.rangedVariant){prev.rangedHits=Math.max(prev.rangedHits||1,migrated.rangedHits||1);}
      else out.push(migrated);
    }
    return out;
  }
  function rangedVariantChoices(weapon,moves,combo,moveId){
    return rangedAllowedVariants(weapon,moves,combo).filter(m=>m._wholeId===moveId).map(m=>m._variant);
  }
  function rangedAllowedVariants(weapon,moves,combo){
    const flat=moves.flatMap(m=>m.rangedVariants?m.rangedVariants.map((v,i)=>({...m,...v,id:m.id+'@'+i,rangedVariants:null,_wholeId:m.id,_variant:i})): [{...m,_wholeId:m.id,_variant:0}]);
    const by=new Map(moves.map(m=>[m.id,m]));
    const items=(combo||[]).map(it=>{const m=by.get(it.moveId);return m?.rangedVariants?{...it,moveId:m.id+'@'+(m.rangedVariants[it.rangedVariant??0]?it.rangedVariant??0:0)}:it;});
    return rangedNextFlat(weapon,flat,items);
  }
  function rangedNextMoves(weapon,moves,combo){
    const ids=new Set(rangedAllowedVariants(weapon,moves,combo).map(m=>m._wholeId));
    return moves.filter(m=>ids.has(m.id));
  }
  // 派生只发生在完整动作之间，伤害阶段不会再进入候选池。
  function rangedNextFlat(weapon,moves,combo){
    const by=new Map(moves.map(m=>[m.id,m])),items=(combo||[]).filter(it=>by.has(it.moveId));
    const lastItem=items.at(-1),last=lastItem&&by.get(lastItem.moveId);
    let mode=false,guided=false,primary=null,secondary=null;
    for(const it of items){const m=by.get(it.moveId);if(m.rangedRole==='mode')mode=!mode;
      if(m.rangedRole==='guide')guided=true;
      if(m.rangedHeatGroup==='primary')primary=m.rangedHeatType;
      if(m.rangedHeatGroup==='secondary')secondary=m.rangedHeatType;
    }
    return moves.filter(m=>{
      const r=m.rangedRole,lr=last?.rangedRole;
      if(m.rangedPart)return !!last && m.rangedAmmo===last.rangedAmmo && r===lr && m.rangedRapid===last.rangedRapid;
      if(weapon==='bow'){
        if(m.rangedGuided&&!guided)return false;
        if(r==='ready')return !!last;
        if(r==='rainExplosion')return lr==='rain';
        if(r==='guideExplosion')return guided&&!!last&&['charge','quick','power','volley','dragon','thousand','flying'].includes(lr);
        if(r==='focusFollow')return lr==='focus'&&!!lastItem.wound || lr==='focusFollow';
        if(r==='volley')return lr==='power'&&m.rangedLevel===last.rangedLevel;
        if(r==='power')return !!last&&(['charge','quick','flying','ready'].includes(lr))&&m.rangedLevel===(lr==='charge'?Math.min(3,last.rangedLevel+1):lr==='quick'?1:3);
        if(r==='dragon'&&m.rangedInstant)return !!last&&!['ready','dragon','thousand'].includes(lr);
        if(r==='dragon'&&!m.rangedInstant)return !last||['ready','flying','guide'].includes(lr);
        if(lr==='rain')return r==='rainExplosion'||r==='ready';
        if(lr==='dragon'||lr==='thousand')return r==='ready';
        if(r==='charge'&&lr==='charge')return m.rangedLevel>last.rangedLevel||last.rangedLevel===3;
        if(r==='charge'&&lr==='power')return m.rangedLevel>=last.rangedLevel;
        if(r==='charge'&&lr==='volley')return m.rangedLevel>=last.rangedLevel;
        return ['charge','quick','thousand','guide','rain','focus','flying','melee'].includes(r);
      }
      if(r==='reload'||r==='mode')return true;
      if(weapon==='light_bowgun'){
        if(m.rangedRapid!==mode&&['shot','chase','stepShot'].includes(r))return false;
        if(r==='stepShot')return lr==='shot'&&mode&&m.rangedAmmo===last.rangedAmmo;
        if(r==='chase')return lr==='shot'&&m.rangedAmmo===last.rangedAmmo;
        if(r==='specialFollow')return lr==='special'&&/圧着/.test(last.nameJa||'');
        return ['shot','focus','special'].includes(r);
      }
      if(m.requiresHeat&&!mode)return false;
      if(r==='heatSpecial'||r==='specialFollow'){
        if(!mode)return false;
        if(m.rangedHeatGroup==='primary'&&primary&&primary!==m.rangedHeatType)return false;
        if(m.rangedHeatGroup==='secondary'&&secondary&&secondary!==m.rangedHeatType)return false;
        if(r==='specialFollow')return lr==='heatSpecial'&&m.rangedHeatType===last.rangedHeatType;
      }
      return ['shot','focus','heatSpecial','specialFollow'].includes(r);
    });
  }
  // ===================== 导出 =====================
  const API = {
    DATA_SCHEMA_VERSION: 1,
    CRIT_BASE, CRIT_NEG, STATUS_PROC, ELEMENT_TYPES, WEAPONS, DEFAULT_SHARPNESS,
    SHARPNESS_ORDER, SHARPNESS_CN,
    ELEMENT_CAP_RATE, ELEMENT_CAP_MIN, elementCap, floorAtk,
    groupValue, conditionActive, applySkills, rawCritMultiplier, elementCritMultiplier,
    calcHit, calculateCombo, buildMonsterParts,rangedNextMoves,rangedVariantChoices,rangedWholeMove,migrateRangedCombo,
    kinsectPowerMult, kinsectMultipliers, KINSECT_MUL: {
      base: KINSECT_BASE, sever: KINSECT_SEVER, extract: KINSECT_EXTRACT,
      link: KINSECT_LINK, linkElem: KINSECT_LINK_ELEM, charged: KINSECT_CHARGED,
      dive: KINSECT_DIVE, focus: KINSECT_FOCUS
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;              // Node 测试用
  }
  if (global) {
    global.MHCalculator = API;         // 浏览器：window.MHCalculator
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

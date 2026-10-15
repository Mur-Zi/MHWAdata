/* 用户确认的更新公告；新公告更换id。 */
(function () {
  'use strict';
  var announcement = {
    id: '2026-10-15-update',
    enabled: true,
    title: 'MHWA数据库更新公告',
    paragraphs: [
      '修正心眼、钝器能手的计算方式：作用于最终物理伤害，不再增加攻击力。',
      '新增异常属性强化旋律，默认按重奏效果计算，异常值×1.15；选中旋律后显示具体加成。',
      '移除“状态与条件”选择，技能默认满足触发前提，通过覆盖率调整效果。',
      '会心倍率同时显示物理、属性和异常会心；属性吸收受击次数移入技能选择。',
      '新增千刃斩味：物理倍率1.4，属性倍率暂定1.15。',
      '新增浸水刃纹，可分别勾选淋湿、泡沫异常，两项会心加成可叠加，三级最高增加30%会心率。',
      '衣装改为逐招选择。蚀攻衣装区分克服前后，新增回避衣装；后续添加的招式继承上一招的衣装设置，连段预设同步保存。',
      '修正暗器蛸套装技能与怪力种子类效果的叠加方式，同类攻击加成仅取较高值。',
      '网页版更新后刷新生效；安卓版本将在后续打包时同步。'
    ]
  };
  if (!announcement.enabled) return;
  var key = 'mhwa_announcement_dismissed';
  try { if (localStorage.getItem(key) === announcement.id) return; } catch (e) {}
  var overlay = document.createElement('div');
  overlay.className = 'announcement-overlay';
  var panel = document.createElement('section');
  panel.className = 'announcement-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'announcement-title');
  var title = document.createElement('h2');
  title.id = 'announcement-title';
  title.textContent = announcement.title;
  panel.appendChild(title);
  announcement.paragraphs.forEach(function (text) {
    var p = document.createElement('p');
    p.textContent = text;
    panel.appendChild(p);
  });
  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'calc-btn';
  close.textContent = '知道了，不再提示本条公告';
  var previousFocus = document.activeElement;
  function dismiss() {
    try { localStorage.setItem(key, announcement.id); } catch (e) {}
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') dismiss();
    if (e.key === 'Tab') { e.preventDefault(); close.focus(); }
  }
  close.addEventListener('click', dismiss);
  panel.appendChild(close);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  close.focus();
})();

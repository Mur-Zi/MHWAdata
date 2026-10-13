/* 公告草稿待审阅：确认文案后将enabled改为true；新公告更换id。 */
(function () {
  'use strict';
  var announcement = {
    id: '2026-10-13-update',
    enabled: false,
    title: 'MHWA数据库更新公告',
    paragraphs: [
      '修复45肉质未触发弱点特效的问题，并调整肉质颜色，45及以上与低于45的肉质明确区分。',
      '修正部分任务的历战倍率，包括八星历战王波衣龙的血量倍率；护锁刃龙改为不可捕获。',
      '修正双刀蓝鬼：属性伤害增加30%，属性面板不变，攻击力加成保持原有方式。',
      '修正攻击守势、套装技能和斩斧的攻击加成计算；霸主之魂与操虫棍三灯按同源加算处理。',
      '狂龙衣装更名为蚀攻衣装；设置预设与连段预设现在支持覆盖保存。',
      '优化更新检查与备用源切换。网页版刷新后生效；涉及计算代码的修正，安卓用户需要安装新版。',
      '发现问题可通过页面底部“联系 / 勘误”中的反馈文档提交。'
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

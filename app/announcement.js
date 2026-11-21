/* 已发布公告按日期倒序保留；发布新公告时新增一条，保留历史条目。 */
(function () {
  'use strict';
  var announcements = [
  {
    "id": "2026-11-21-update",
    "date": "2026-11-21",
    "enabled": true,
    "title": "MHWA数据库更新公告",
    "paragraphs": [
      "补充并校正大型怪物的肉质、部位状态与任务数据，完善训练小车软硬肉质，清理重复及错误条目。",
      "优化怪物页面，突出肉质信息，独立展示伤痕肉质，调整肉质颜色与任务倍率的位置。",
      "新增轻重弩计算页面，支持弹种、射击方式、弹匣计数及逐发伤害查看。",
      "补齐弓箭瓶种选择与对应计算，完善集中射击的伤口数量、追击命中数及伤口累计伤害。",
      "新增会心期望开关，支持逐招指定会心或非会心，并查看对应伤害。",
      "预设重名时提示覆盖，新增预设对比功能，方便比较不同配置和连段。",
      "修正攻击力上限、部分技能效果及招式派生；优化网页版布局、下拉选择、连段编辑和滚动操作。"
    ]
  },
  {
    "id": "2026-10-15-update",
    "enabled": true,
    "title": "MHWA数据库更新公告",
    "paragraphs": [
      "修正心眼、钝器能手的计算方式：作用于最终物理伤害，不再增加攻击力。",
      "新增异常属性强化旋律，默认按重奏效果计算，异常值×1.15；选中旋律后显示具体加成。",
      "移除“状态与条件”选择，技能默认满足触发前提，通过覆盖率调整效果。",
      "会心倍率同时显示物理、属性和异常会心；属性吸收受击次数移入技能选择。",
      "新增千刃斩味：物理倍率1.4，属性倍率暂定1.15。",
      "新增浸水刃纹，可分别勾选淋湿、泡沫异常，两项会心加成可叠加，三级最高增加30%会心率。",
      "衣装改为逐招选择。蚀攻衣装区分克服前后，新增回避衣装；后续添加的招式继承上一招的衣装设置，连段预设同步保存。",
      "修正暗器蛸套装技能与怪力种子类效果的叠加方式，同类攻击加成仅取较高值。",
      "网页版更新后刷新生效；安卓版本将在后续打包时同步。"
    ],
    "date": "2026-10-15"
  },
  {
    "id": "2026-10-13-update",
    "enabled": true,
    "title": "MHWA数据库更新公告",
    "paragraphs": [
      "修复45肉质未触发弱点特效的问题，并调整肉质颜色，45及以上与低于45的肉质明确区分。",
      "修正部分任务的历战倍率，包括八星历战王波衣龙的血量倍率；护锁刃龙改为不可捕获。",
      "收录33只怪物、60组临时弱点肉质，区分倒地、形态变化等条件。",
      "修正双刀蓝鬼：属性伤害增加30%，属性面板不变，攻击力加成保持原有方式。",
      "新增“解除异常状态”，触发因祸得福；“被队友赋予 buff”触发霸主之骄傲。",
      "优化更新检查与备用源切换。网页版刷新后生效；涉及计算代码的修正，安卓用户需要安装新版。",
      "发现问题可通过页面底部“联系 / 勘误”中的反馈文档提交。"
    ],
    "date": "2026-10-13"
  }
];
  var announcement = announcements.find(function (entry) { return entry.enabled; });
  if (!announcement) return;
  var key = 'mhwa_announcement_dismissed';

  function appendParagraphs(parent, entry) {
    entry.paragraphs.forEach(function (text, index) {
      var p = document.createElement('p');
      p.textContent = (index + 1) + '. ' + text;
      parent.appendChild(p);
    });
  }

  function openAnnouncement() {
    if (document.querySelector('.announcement-overlay')) return;
    var previousFocus = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'announcement-overlay';
    var panel = document.createElement('section');
    panel.className = 'announcement-panel';
    panel.dataset.announcementId = announcement.id;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'announcement-title');
    panel.tabIndex = -1;
    var title = document.createElement('h2');
    title.id = 'announcement-title';
    title.textContent = announcement.title;
    panel.appendChild(title);
    var date = document.createElement('time');
    date.className = 'announcement-date';
    date.dateTime = announcement.date;
    date.textContent = announcement.date;
    panel.appendChild(date);
    appendParagraphs(panel, announcement);

    var older = announcements.filter(function (entry) { return entry.enabled && entry.id !== announcement.id; });
    if (older.length) {
      var history = document.createElement('details');
      history.className = 'announcement-history';
      var historyTitle = document.createElement('summary');
      historyTitle.textContent = '历史公告';
      history.appendChild(historyTitle);
      older.forEach(function (entry) {
        var detail = document.createElement('details');
        detail.className = 'announcement-entry';
        detail.dataset.announcementId = entry.id;
        var heading = document.createElement('summary');
        var time = document.createElement('time');
        time.dateTime = entry.date;
        time.textContent = entry.date;
        heading.appendChild(time);
        heading.appendChild(document.createTextNode(' · ' + entry.title));
        detail.appendChild(heading);
        appendParagraphs(detail, entry);
        history.appendChild(detail);
      });
      panel.appendChild(history);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'calc-btn';
    close.textContent = '知道了，不再提示本条公告';
    function dismiss() {
      try { localStorage.setItem(key, announcement.id); } catch (e) {}
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus({ preventScroll: true });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
      if (e.key === 'Tab') {
        var focusable = Array.from(panel.querySelectorAll('button, summary, a[href], input, select, textarea, [tabindex="0"]'))
          .filter(function (node) { return !node.disabled && node.getClientRects().length; });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
          e.preventDefault(); first.focus();
        }
      }
    }
    close.addEventListener('click', dismiss);
    panel.appendChild(close);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    panel.focus({ preventScroll: true });
  }

  var historyButton = document.getElementById('footer-announcements');
  if (historyButton) historyButton.addEventListener('click', openAnnouncement);
  try { if (localStorage.getItem(key) === announcement.id) return; } catch (e) {}
  openAnnouncement();
})();

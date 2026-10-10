// 内置可更新配置（炸膛数据 + 部位名覆盖）
// 这是「出厂兜底」；联网时 loader.js 会用在线 data.json 里的 CONFIG 覆盖本对象。
// 单一数据源：这里改完，跑 build/gen-data-package.mjs 生成 data.json 推到 GitHub。
window.MHWILD_CONFIG = {
  "BLOWOUT": {
    "Ajarakan": [
      { "label": "高温", "vitals": [610, 770, 930, 1200] }
    ],
    "Arkveld": [
      { "label": "左锁翼刃", "vitals": [170, 230, 360, 500] },
      { "label": "右锁翼刃", "vitals": [170, 230, 360, 500] }
    ],
    "Nu Udra": [
      { "label": "附炎", "vitals": [700, 950, 1200] }
    ],
    "Uth Duna": [
      { "label": "水膜", "vitals": [288, 384, 512] }
    ],
    "Lagiacrus": [
      { "label": "充电", "vitals": [900, 1100, 1300] }
    ]
  },
  "PART_OVERRIDE": {
    "Arkveld": { "Wing": "翼爪" }
  }
};

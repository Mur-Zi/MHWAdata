// 在线怪物与计算器数据更新 + 本地缓存兜底（多源回退：jsDelivr → raw.githubusercontent → fastly.jsdelivr）
// 数据源：GitHub 仓库 Mur-Zi/MHWAdata（main 分支根目录的 version.json + data.json）
// 流程：
//   1) 启动时同步读 localStorage 缓存，覆盖内置 data.js/kuro-hzv.js/config.js（断网也能用缓存）。
//   2) 后台并行探测多个源的 version.json，取能连通且版本最新的源下载 data.json，存缓存并刷新。
//   3) 所有源失败 / 超时 / 数据无效 → 静默回退到内置或缓存数据，不影响使用。
(function () {
  'use strict';
  var BASES = [
    'https://cdn.jsdelivr.net/gh/Mur-Zi/MHWAdata@main/',
    'https://raw.githubusercontent.com/Mur-Zi/MHWAdata/main/',
    'https://fastly.jsdelivr.net/gh/Mur-Zi/MHWAdata@main/'
  ];
  var TIMEOUT = 6000; // 每个源最多等 6 秒
  var CACHE_KEY = 'mhwa_data';
  var VER_KEY = 'mhwa_data_version';

  // 把数据包应用到 window 全局（app.js 会在 reload 后重新读取这些全局）
  function apply(pkg) {
    if (!pkg || typeof pkg !== 'object') return false;
    try {
      if (pkg.RAW) window.MHWILD_RAW = pkg.RAW;
      if (pkg.TR) window.MHWILD_TR = pkg.TR;
      if (pkg.META) window.MHWILD_META = pkg.META;
      if (pkg.KURO_HZV) window.MHWILD_KURO_HZV = pkg.KURO_HZV;
      if (pkg.CONFIG) window.MHWILD_CONFIG = pkg.CONFIG;
      // 只加载与本地引擎兼容的纯数据；不执行远程代码。
      if (pkg.CALC_SCHEMA === 1 && window.MHCalculator && window.MHCalculator.DATA_SCHEMA_VERSION === 1
          && pkg.CALC_DATA && Array.isArray(pkg.CALC_DATA.skills) && pkg.CALC_DATA.weaponMoves) {
        window.MHWCALC = pkg.CALC_DATA;
      }
      return true;
    } catch (e) { return false; }
  }

  // 1) 同步读缓存（无网络依赖）
  try {
    var cached = localStorage.getItem(CACHE_KEY);
    if (cached) apply(JSON.parse(cached));
  } catch (e) { /* 缓存不存在或损坏则用内置数据 */ }

  // 带超时的 fetch JSON
  function fetchJson(url) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error('timeout')); } }, TIMEOUT);
      fetch(url, { cache: 'no-store' })
        .then(function (r) {
          if (settled) return;
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) { if (!settled) { settled = true; clearTimeout(timer); resolve(j); } })
        .catch(function (e) { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    });
  }

  // 2) 后台并行探测各源版本，取最新；有新版本则下载并刷新
  var applied = false;
  function checkUpdate() {
    var localVer = 0;
    try { localVer = parseInt(localStorage.getItem(VER_KEY) || '0', 10) || 0; } catch (e) {}

    Promise.all(BASES.map(function (base) {
      return fetchJson(base + 'version.json')
        .then(function (v) { return { base: base, version: (v && typeof v.version === 'number') ? v.version : 0 }; })
        .catch(function () { return null; });
    })).then(function (results) {
      var best = null;
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r && r.version > localVer && (!best || r.version > best.version)) best = r;
      }
      if (!best) return; // 无更新或全部失败
      return fetchJson(best.base + 'data.json').then(function (pkg) {
        if (!pkg || !pkg.RAW || pkg.version !== best.version) throw new Error('bad data or version mismatch');
        var cachedOK = false;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(pkg));
          localStorage.setItem(VER_KEY, String(pkg.version));
          cachedOK = true;
        } catch (e) { /* 缓存写入失败则本次不生效，下次再试 */ }
        if (applied) return;
        applied = true;
        if (cachedOK && apply(pkg)) { try { window.location.reload(); } catch (e) {} }
      });
    }).catch(function () { /* 静默回退 */ });
  }

  // 延迟到首屏渲染后再检查，避免阻塞启动
  setTimeout(checkUpdate, 400);
})();

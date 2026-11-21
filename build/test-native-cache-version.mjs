import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app/loader.js',import.meta.url),'utf8');
for(const version of [35,36,37]){
 const pkg={version,RAW:{version},CALC_SCHEMA:1,CALC_DATA:{skills:[],weaponMoves:{bow:[]}}},store=new Map([['mhwa_data',JSON.stringify(pkg)],['mhwa_data_version',String(version)],['preset-sentinel','keep']]),timers=[],requests=[];
 const window={location:{protocol:'file:',reload(){throw Error('Unexpected reload');}},MHCalculator:{DATA_SCHEMA_VERSION:1},MHWILD_RAW:{version:36},MHWCALC:{bundled:true}};
 const context={window,document:{querySelector:()=>({content:'36'})},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setTimeout:f=>{timers.push(f);},clearTimeout(){},fetch:url=>{requests.push(url);return Promise.resolve({ok:true,json:()=>Promise.resolve({version:36,dataFile:'data.v36.json'})});},Promise,Number,JSON,parseInt};
 vm.runInNewContext(source,context);assert.equal(window.MHWILD_RAW.version,Math.max(version,36));assert.equal(store.get('preset-sentinel'),'keep');
 timers[0]();await new Promise(r=>setTimeout(r,0));assert.ok(!requests.some(url=>url.endsWith('data.v36.json')));
}
console.log('Native app ignores older/equal cached data, accepts newer cache, preserves stored presets, and avoids downgrade downloads');

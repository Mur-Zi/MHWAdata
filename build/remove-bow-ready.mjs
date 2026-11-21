import fs from 'node:fs';import vm from 'node:vm';import {pathToFileURL}from'node:url';
export function removeBowReady(data){
 // Retain the zero-damage record for older installed engines; current selectors hide it.
 const moves=data.weaponMoves.bow;
 let legacy=moves.find(m=>m.id==='bow_ready');
 if(!legacy){legacy={id:'bow_ready',name:'回到自由态',domain:'ground',endsIn:'ground',starter:true,hits:[],branches:[],rangedRole:'ready',zeroDamage:'回到自由态'};moves.push(legacy);}
 legacy.legacyOnly=true;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const file=new URL('../app/calc-data.js',import.meta.url),src=fs.readFileSync(file,'utf8'),ctx={window:{}};vm.runInNewContext(src,ctx);removeBowReady(ctx.window.MHWCALC);
 fs.writeFileSync(file,src.slice(0,src.indexOf('window.MHWCALC = '))+'window.MHWCALC = '+JSON.stringify(ctx.window.MHWCALC)+';\n');console.log('Bow ready placeholder removed');
}

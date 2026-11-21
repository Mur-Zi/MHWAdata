// Focus lock targets, wounds broken, and follow-up piercing ticks are independent.
// Japanese source supplies decay thresholds, but does not establish a total tick cap.
import fs from 'node:fs';
import vm from 'node:vm';
export function fixBowFocus(data){
  const m=data.weaponMoves.bow.find(m=>m.id==='bow_051');
  if(!m)throw Error('Missing bow focus move');
  m.woundCountOption={label:'命中伤口数',min:0,max:3,default:1,unit:'处伤口',note:'仅命中临时弱点时选0处；伤口数量与锁定目标数、追击跳数分别计算。'};
  m.woundBurst={0:0,1:30,2:50,3:80};
  for(const v of m.rangedVariants){
    v.label=v.label.replace(/^锁定(\d+)处$/,'锁定$1个目标');
    if(v.rangedFollow){v.rangedFollow.max=99;v.rangedFollow.unverifiedMax=true;v.rangedFollow.label='追击贯通跳数';v.rangedFollow.note='按实际命中填写；资料尚未确认总命中上限。';}
  }
}
if(process.argv[1]&&new URL('file:///'+process.argv[1].replaceAll('\\','/')).href===import.meta.url){
  const file=new URL('../app/calc-data.js',import.meta.url),src=fs.readFileSync(file,'utf8'),ctx={window:{}};
  vm.runInNewContext(src,ctx);fixBowFocus(ctx.window.MHWCALC);
  fs.writeFileSync(file,src.slice(0,src.indexOf('window.MHWCALC = '))+'window.MHWCALC = '+JSON.stringify(ctx.window.MHWCALC)+';\n');
  console.log('Bow focus options updated');
}

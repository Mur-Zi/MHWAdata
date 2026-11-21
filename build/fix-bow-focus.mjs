// Apply reviewed per-wound coefficients for every weapon and bow focus controls.
// Japanese source supplies decay thresholds, but does not establish a total tick cap.
import fs from 'node:fs';
import vm from 'node:vm';
export function fixBowFocus(data){
  const m=data.weaponMoves.bow.find(m=>m.id==='bow_051');
  if(!m)throw Error('Missing bow focus move');
  m.woundCountOption={label:'命中伤口数',min:0,max:4,default:1,unit:'处伤口'};
  m.woundBurstSteps={1:50,2:82.5,3:132,4:136.7};
  m.woundBurst={0:0};
  for(const v of m.rangedVariants){
    v.label=v.label.replace(/^锁定(\d+)处$/,'锁定$1个目标');
    if(v.rangedFollow){v.rangedFollow.max=99;v.rangedFollow.unverifiedMax=true;v.rangedFollow.label='追击贯通跳数';delete v.rangedFollow.note;}
  }
  // Preserve the per-wound values and publish cumulative totals for older app engines.
  for(const moves of Object.values(data.weaponMoves))for(const move of moves){
    if(!move.woundBurst)continue;
    const steps=move.woundBurstSteps||{...move.woundBurst};
    move.woundBurstSteps=steps;
    let total=0;move.woundBurst={0:0};
    const max=move.woundCountOption?.max??Math.max(...Object.keys(steps).map(Number));
    for(let i=1;i<=max;i++){
      if(steps[i]==null)throw Error('Missing wound coefficient: '+move.id+' / '+i);
      total+=Number(steps[i]);move.woundBurst[i]=Math.round(total*1e6)/1e6;
    }
  }
}
if(process.argv[1]&&new URL('file:///'+process.argv[1].replaceAll('\\','/')).href===import.meta.url){
  const file=new URL('../app/calc-data.js',import.meta.url),src=fs.readFileSync(file,'utf8'),ctx={window:{}};
  vm.runInNewContext(src,ctx);fixBowFocus(ctx.window.MHWCALC);
  fs.writeFileSync(file,src.slice(0,src.indexOf('window.MHWCALC = '))+'window.MHWCALC = '+JSON.stringify(ctx.window.MHWCALC)+';\n');
  console.log('Bow focus options updated');
}

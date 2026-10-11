import fs from 'node:fs';
const root=new URL('../',import.meta.url),dir=new URL('app/updates/',root);
const data=fs.readFileSync(new URL('data.json',root)),pkg=JSON.parse(data),version=JSON.parse(fs.readFileSync(new URL('version.json',root),'utf8')).version;
if(!Number.isSafeInteger(version)||version<1||pkg.version!==version)throw Error('更新包版本不一致');
fs.mkdirSync(dir,{recursive:true});const dataFile=`data.v${version}.json`;
fs.writeFileSync(new URL(dataFile,dir),data);fs.writeFileSync(new URL('version.json',dir),JSON.stringify({version,dataFile})+'\n');
console.log('网站更新镜像 '+dataFile);

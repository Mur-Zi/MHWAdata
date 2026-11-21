import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {execFileSync}from'node:child_process';import {fileURLToPath}from'node:url';import {isAndroidAsset}from'./android-assets.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),apk=path.join(root,'dist/MHWA数据库.apk'),previous=path.join(root,'build/codex-backups/20261121-delivery20/MHWA数据库-1.05.apk');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(apk);let end=-1;
for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
assert.ok(end>=0);let offset=bytes.readUInt32LE(end+16);const entries=new Map();
for(let i=0;i<bytes.readUInt16LE(end+10);i++){
 assert.equal(bytes.readUInt32LE(offset),0x02014b50);
 const method=bytes.readUInt16LE(offset+10),size=bytes.readUInt32LE(offset+24),compressed=bytes.readUInt32LE(offset+20),nl=bytes.readUInt16LE(offset+28),el=bytes.readUInt16LE(offset+30),cl=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42),name=bytes.toString('utf8',offset+46,offset+46+nl);
 assert.ok(!name.includes('\\')&&!name.startsWith('/')&&!name.split('/').includes('..'));assert.ok(!entries.has(name));assert.ok([0,8].includes(method));
 const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),compressedBytes=bytes.subarray(start,start+compressed),content=method===0?compressedBytes:zlib.inflateRawSync(compressedBytes);
 assert.equal(content.length,size);entries.set(name,content);offset+=46+nl+el+cl;
}
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);
const files=walk(path.join(root,'app')).filter(isAndroidAsset).sort(),packed=[...entries.keys()].filter(n=>n.startsWith('assets/')&&!n.endsWith('/')).map(n=>n.slice(7)).sort();assert.deepEqual(packed,files);
const assetRoot=path.join(root,'build/delivery20/apk-assets');fs.mkdirSync(assetRoot,{recursive:true});const assetHashes={};
for(const name of files){const content=entries.get('assets/'+name);assert.ok(content.equals(fs.readFileSync(path.join(root,'app',name))),name);const target=path.resolve(assetRoot,name);assert.ok(target.startsWith(path.resolve(assetRoot)+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);assetHashes[name]=hash(content);}
const bt=fs.readdirSync(path.join(root,'sdk')).find(n=>fs.existsSync(path.join(root,'sdk',n,'aapt2.exe'))),tool=name=>path.join(root,'sdk',bt,name),run=(exe,args)=>execFileSync(exe,args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const badging=run(tool('aapt2.exe'),['dump','badging',apk]);assert.match(badging,/package: name='com\.mhwilds\.db' versionCode='84' versionName='2\.0'/);assert.match(badging,/application-label:'MHWA数据库'/);
const signature=file=>run('java',['-jar',tool('lib/apksigner.jar'),'verify','--print-certs',file]),fingerprint=s=>s.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1];
const signed=signature(apk),old=signature(previous);assert.ok(fingerprint(signed));assert.equal(fingerprint(signed),fingerprint(old));run(tool('zipalign.exe'),['-c','4',apk]);
const data={window:{}};new Function('window',entries.get('assets/calc-data.js').toString('utf8'))(data.window);assert.ok(data.window.MHWCALC.weaponMoves.bow.find(m=>m.id==='bow_001').bowCoatings.length===9);assert.ok(entries.get('assets/announcement.js').toString('utf8').includes('2026-11-21-update'));
const report={versionName:'2.0',versionCode:84,packageName:'com.mhwilds.db',date:'2026-11-21',dataVersion:36,signatureUnchanged:true,certificateSha256:fingerprint(signed),assetFileCount:files.length,assetsMatched:true,zipAlignmentPassed:true,androidDeviceTested:false,apk:{file:'MHWA数据库-2.0.apk',bytes:bytes.length,sha256:hash(bytes)},assetHashes};
fs.copyFileSync(apk,path.join(root,'dist',report.apk.file));fs.writeFileSync(path.join(root,'dist/交付校验-2.0.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(root,'dist/SHA256-2.0.txt'),report.apk.sha256+'  '+report.apk.file+'\n');
console.log(JSON.stringify({version:report.versionName,code:report.versionCode,assets:files.length,bytes:bytes.length,signatureUnchanged:true,sha256:report.apk.sha256,assetRoot}));

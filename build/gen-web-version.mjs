import fs from 'node:fs';import crypto from 'node:crypto';
const app=new URL('../app/',import.meta.url),htmlFile=new URL('index.html',app);
let html=fs.readFileSync(htmlFile,'utf8');
const files=['style.css','data.js','kuro-hzv.js','config.js','calc-data.js','calculator.js','loader.js','app.js'];
const hash=crypto.createHash('sha256');
for(const file of files){const content=fs.readFileSync(new URL(file,app));hash.update(file).update(content);const v=crypto.createHash('sha256').update(content).digest('hex').slice(0,16);html=html.replace(new RegExp('(["\'])'+file.replaceAll('.','\\.')+'(?:\\?v=[^"\']*)?(["\'])','g'),`$1${file}?v=${v}$2`);}
html=html.replace(/\s*<meta name="mhwa-web-build" content="[^"]*">/,'');
html=html.replace(/\s*<meta name="mhwa-data-version" content="[^"]*">/,'');
const dataVersion=JSON.parse(fs.readFileSync(new URL('../version.json',app),'utf8')).version;
html=html.replace('</head>',`  <meta name="mhwa-data-version" content="${dataVersion}">\n</head>`);
hash.update(html);const build=hash.digest('hex').slice(0,20);
html=html.replace('</head>',`  <meta name="mhwa-web-build" content="${build}">\n</head>`);
fs.writeFileSync(htmlFile,html);fs.writeFileSync(new URL('web-version.json',app),JSON.stringify({build})+'\n');console.log('网页构建标识 '+build);

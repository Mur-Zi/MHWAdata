// 构建 APK：WebView 壳 + app/ 资源。用 build-tools 的 aapt2/d8/apksigner/zipalign + JDK 的 javac/keytool/jar。
// 用法：node 05-MHWA肉质表/build/build-apk.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {isAndroidAsset} from './android-assets.mjs';

const ROOT = 'D:/deepseek-harness/05-MHWA肉质表';
const SDK = path.join(ROOT, 'sdk');
const BT = fs.readdirSync(SDK).find((d) => fs.existsSync(path.join(SDK, d, 'aapt2.exe')));
const PLAT = fs.readdirSync(SDK).find((d) => fs.existsSync(path.join(SDK, d, 'android.jar')));
if (!BT || !PLAT) { console.error('SDK not ready'); process.exit(1); }

const AAPT2 = path.join(SDK, BT, 'aapt2.exe');
const D8_JAR = path.join(SDK, BT, 'lib', 'd8.jar');
const APKSIGNER_JAR = path.join(SDK, BT, 'lib', 'apksigner.jar');
const ZIPALIGN = path.join(SDK, BT, 'zipalign.exe');
const ANDROID_JAR = path.join(SDK, PLAT, 'android.jar');

const ANDROID_DIR = path.join(ROOT, 'android');
const APP_DIR = path.join(ROOT, 'app');
const BUILD = path.join(ROOT, 'build', 'apk');
const OUT_APK = path.join(ROOT, 'dist', 'MHWA数据库.apk');

const JAVA = 'javac';
const KEYTOOL = 'keytool';
const JAR = 'jar';
const JAVA_EXE = 'java';

function run(cmd, cwd) {
  console.log('> ' + cmd);
  execSync(cmd, { cwd: cwd || BUILD, stdio: 'inherit', shell: 'cmd.exe' });
}

async function main() {
  // 清空并准备 build 目录
  const resolvedBuild=path.resolve(BUILD),expectedBuild=path.resolve(ROOT,'build','apk');
  if(resolvedBuild!==expectedBuild || !resolvedBuild.startsWith(path.resolve(ROOT)+path.sep))throw new Error('拒绝清理工作区外路径');
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(path.join(BUILD, 'res', 'values'), { recursive: true });
  fs.mkdirSync(path.join(BUILD, 'res', 'mipmap'), { recursive: true });
  fs.mkdirSync(path.join(BUILD, 'classes'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

  // 清单 + 资源
  fs.copyFileSync(path.join(ANDROID_DIR, 'AndroidManifest.xml'), path.join(BUILD, 'AndroidManifest.xml'));
  fs.copyFileSync(path.join(ANDROID_DIR, 'res', 'values', 'strings.xml'), path.join(BUILD, 'res', 'values', 'strings.xml'));
  // 图标：用缠蛙 Chatacabra 图标（已处理为透明背景 + 怪物不透明 + 放大）
  const iconSrc = path.join(ANDROID_DIR, 'res', 'mipmap', 'ic_launcher.png');
  if (!fs.existsSync(iconSrc)) { console.error('icon missing: ' + iconSrc); process.exit(1); }
  fs.copyFileSync(iconSrc, path.join(BUILD, 'res', 'mipmap', 'ic_launcher.png'));

  // assets：app 目录整体
  fs.cpSync(APP_DIR, path.join(BUILD, 'assets'), { recursive: true,
    filter: source => isAndroidAsset(path.relative(APP_DIR, source)) });

  // 1) aapt2 编译资源
  run(`"${AAPT2}" compile --dir res -o compiled.zip`);

  // 2) aapt2 链接生成基础 APK（不含 assets，assets 用 jar 添加以避免 Windows 反斜杠路径问题）
  run(`"${AAPT2}" link -o base.apk -I "${ANDROID_JAR}" --manifest AndroidManifest.xml compiled.zip`);

  // 3) javac 编译 MainActivity
  run(`"${JAVA}" -source 8 -target 8 -bootclasspath "${ANDROID_JAR}" -d classes "${path.join(ANDROID_DIR, 'src', 'com', 'mhwilds', 'db', 'MainActivity.java')}"`);

  // 4) d8 生成 classes.dex
  run(`"${JAVA_EXE}" -cp "${D8_JAR}" com.android.tools.r8.D8 --lib "${ANDROID_JAR}" --min-api 21 --output . classes/com/mhwilds/db/*.class`);

  // 5) 把 classes.dex 与 assets 加入 APK（jar 会把路径规范为 /）
  run(`"${JAR}" uf base.apk classes.dex assets`);

  // 6) zipalign
  run(`"${ZIPALIGN}" -f 4 base.apk aligned.apk`);

  // 7) 生成调试 keystore（持久化到 build/，避免每次构建换签名导致无法覆盖安装）
  const ks = path.join(ROOT, 'build', 'debug.keystore');
  if (!fs.existsSync(ks)) {
    run(`"${KEYTOOL}" -genkeypair -keystore "${ks}" -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`);
  }

  // 8) 签名
  run(`"${JAVA_EXE}" -jar "${APKSIGNER_JAR}" sign --ks "${ks}" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "${OUT_APK}" aligned.apk`);

  // 9) 校验
  run(`"${JAVA_EXE}" -jar "${APKSIGNER_JAR}" verify --print-certs "${OUT_APK}"`);

  const size = fs.statSync(OUT_APK).size;
  console.log(`\nAPK built: ${OUT_APK} (${(size / 1048576).toFixed(2)} MB)`);
}

main().catch((e) => { console.error('BUILD FAILED', e.message); process.exit(1); });

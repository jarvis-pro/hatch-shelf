// 本地构建 Release 包并上传到 App Store Connect（TestFlight），不走 EAS（见 README 决策记录）。
// 流程：app.json 的 expo.version 升 patch → build:assets → prebuild → xcodebuild archive → exportArchive 上传。
// 构建号固定为 Expo 默认的 1，不单独维护。--version x.y.z 指定新版本号（升 minor / major 时用）。
// 失败时把 app.json 恢复原样；上传成功后只把 app.json 单独提交为 `chore(release): v<版本>` 并打同名 tag，
// 不带上工作区其他改动，git log 里就能看到每个版本节点。加 --no-upload 只导出 .ipa 到 ios/build/export，不改版本号、不上传。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 正式包名 com.jarvis.shelf；不设时 app.config.js 生成的是 .dev 开发版。子进程都继承这个环境变量
process.env.APP_VARIANT = 'production';

const appDir = path.resolve(import.meta.dirname, '..');
const appJsonPath = path.join(appDir, 'app.json');
const buildDir = path.join(appDir, 'ios/build');
const archivePath = path.join(buildDir, 'Shelf.xcarchive');
const exportPath = path.join(buildDir, 'export');
// prebuild 按 expo.name 生成工程名和 scheme
const SCHEME = 'Shelf';
const args = process.argv.slice(2);
const upload = !args.includes('--no-upload');
const versionArg = args.includes('--version') ? args[args.indexOf('--version') + 1] : undefined;

function run(cmd, args, env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: appDir, stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) throw new Error(`${cmd} 退出码 ${res.status ?? res.signal}`);
}

const original = readFileSync(appJsonPath, 'utf8');
const config = JSON.parse(original);
const ios = config.expo.ios;

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`版本号必须是 x.y.z：${v}`);
  return m.slice(1).map(Number);
}

const current = parseVersion(config.expo.version);
let version = config.expo.version;
// 每次上传都发一个新版本（构建号 = 版本号，同一版本不能重复上传）；只导出不上传时不改
if (upload) {
  const next = versionArg ? parseVersion(versionArg) : [current[0], current[1], current[2] + 1];
  const cmp = next.map((n, i) => n - current[i]).find((d) => d !== 0) ?? 0;
  if (cmp <= 0) throw new Error(`新版本 ${next.join('.')} 必须大于当前的 ${config.expo.version}`);
  version = next.join('.');
}
config.expo.version = version;
writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`版本 ${version}（构建号 1）`);

try {
  run('pnpm', ['build:assets']);
  // EXPO_NO_GIT_STATUS：工作区有改动时 prebuild --clean 默认会停下来询问
  run('npx', ['expo', 'prebuild', '--clean', '--platform', 'ios'], { EXPO_NO_GIT_STATUS: '1' });
  run('xcodebuild', [
    '-workspace', `ios/${SCHEME}.xcworkspace`,
    '-scheme', SCHEME,
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', archivePath,
    '-allowProvisioningUpdates',
    'archive',
  ]);

  const exportOptions = path.join(buildDir, 'ExportOptions.plist');
  writeFileSync(
    exportOptions,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${upload ? 'upload' : 'export'}</string>
  <key>teamID</key><string>${ios.appleTeamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`,
  );
  run('xcodebuild', [
    '-exportArchive',
    '-archivePath', archivePath,
    '-exportOptionsPlist', exportOptions,
    '-exportPath', exportPath,
    '-allowProvisioningUpdates',
  ]);
} catch (err) {
  writeFileSync(appJsonPath, original);
  console.error(`\n失败，已恢复 app.json：${err.message}`);
  process.exit(1);
}

if (!upload) {
  console.log(`\n已导出到 ${path.relative(process.cwd(), exportPath)}（未上传）。`);
  process.exit(0);
}

console.log(`\n已上传 ${version}。App Store Connect 处理完后会出现在 TestFlight 中。`);
// 已经上传了，提交失败只提示，不再恢复 app.json（这个版本号已被占用）
try {
  // `--` 后带路径即 --only：只提交 app.json，暂存区里的其他改动不受影响
  run('git', ['commit', '-m', `chore(release): v${version}`, '--', 'app.json']);
  run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);
} catch (err) {
  console.error(`\n自动提交或打 tag 失败，请手动补上：${err.message}`);
  process.exit(1);
}

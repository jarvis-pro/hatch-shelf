// 本地构建 Release 包并上传到 App Store Connect（TestFlight），不走 EAS（见 README 决策记录）。
// 流程：app.json 的 ios.buildNumber +1 → build:assets → prebuild → xcodebuild archive → exportArchive 上传。
// 失败时把 app.json 恢复原样。加 --no-upload 只导出 .ipa 到 ios/build/export，不上传。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(import.meta.dirname, '..');
const appJsonPath = path.join(appDir, 'app.json');
const buildDir = path.join(appDir, 'ios/build');
const archivePath = path.join(buildDir, 'Shelf.xcarchive');
const exportPath = path.join(buildDir, 'export');
// prebuild 按 expo.name 生成工程名和 scheme
const SCHEME = 'Shelf';
const upload = !process.argv.includes('--no-upload');

function run(cmd, args, env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: appDir, stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) throw new Error(`${cmd} 退出码 ${res.status ?? res.signal}`);
}

const original = readFileSync(appJsonPath, 'utf8');
const config = JSON.parse(original);
const ios = config.expo.ios;
// 只导出不上传时不占用新的构建号
const buildNumber = upload ? String(Number(ios.buildNumber ?? '0') + 1) : ios.buildNumber;
ios.buildNumber = buildNumber;
writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`版本 ${config.expo.version}，构建号 ${buildNumber}`);

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

console.log(
  upload
    ? `\n已上传 ${config.expo.version} (${buildNumber})。App Store Connect 处理完后会出现在 TestFlight 中；记得提交 app.json。`
    : `\n已导出到 ${path.relative(process.cwd(), exportPath)}（未上传）。`,
);

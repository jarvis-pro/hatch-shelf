// 构建号直接用 version（如 1.0.6），只维护 app.json 的 expo.version 一个号；见 README 第 13 节
// 默认是开发版：包名加 .dev、名字带 Dev，和 TestFlight 装的正式版并存，不会覆盖它。
// 只有 testflight 脚本设 APP_VARIANT=production，用 app.json 里的正式包名
const production = process.env.APP_VARIANT === 'production';

module.exports = ({ config }) =>
  production
    ? { ...config, ios: { ...config.ios, buildNumber: config.version } }
    : {
        ...config,
        scheme: `${config.scheme}-dev`,
        ios: {
          ...config.ios,
          buildNumber: config.version,
          bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
          infoPlist: { ...config.ios.infoPlist, CFBundleDisplayName: `${config.ios.infoPlist.CFBundleDisplayName} Dev` },
        },
        android: { ...config.android, package: `${config.android.package}.dev` },
      };

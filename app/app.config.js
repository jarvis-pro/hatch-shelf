// 构建号直接用 version（如 1.0.6），只维护 app.json 的 expo.version 一个号；见 README 第 13 节
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, buildNumber: config.version },
});

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 阅读器打包成 assets/reader/index.html，作为资源文件随 App 发布
config.resolver.assetExts.push('html');

module.exports = config;

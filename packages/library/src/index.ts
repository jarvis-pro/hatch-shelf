/** 给 apps/dock 用的书库逻辑：找书、读书、校验、打包、原声包；命令行入口在 cli.ts */
export * from './books';
export { buildChapterPackage, readAudioManifest } from './audio';

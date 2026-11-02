#!/usr/bin/env -S npx tsx
import { Command } from 'commander';

// M4 实现；先占住命令形状，与 README 第 10 节保持一致
const todo = (name: string) => () => {
  console.error(`shelf-pack ${name}: 尚未实现（M4）`);
  process.exitCode = 1;
};

const program = new Command('shelf-pack').description('书架内容校验、打包与局域网推送');

program.command('check <path>').description('按 spec 校验一本书或整个 books/ 目录').action(todo('check'));
program
  .command('pack <book-dir>')
  .option('-o, --out <file>', '输出 zip 路径')
  .description('校验后打包成 zip')
  .action(todo('pack'));
program
  .command('push <path>')
  .requiredOption('--to <ip>', '设备 IP')
  .requiredOption('--pin <pin>', '传书页面显示的 PIN')
  .option('--changed', '对比设备上的 /books，只推送有变化的书')
  .description('打包并通过局域网上传')
  .action(todo('push'));

program.parse();

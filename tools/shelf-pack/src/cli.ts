#!/usr/bin/env -S npx tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_PACKAGE_BYTES, prepareImport } from '@shelf/spec';
import { Command } from 'commander';
import { findBooks, groupByCategory, lint, packBook, readBook, sameNotes, type LocalBook } from './books';
import { listDeviceBooks, PinError, pullBackup, pullDeviceNotes, pushRestore, upload } from './device';

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

/** 校验并打印问题；有错误时返回 null */
function checkBook(book: LocalBook, quiet = false) {
  const r = lint(book);
  const label = r.manifest ? `${book.dirName}  ${c.dim(r.manifest.title)}` : book.dirName;
  if (r.errors.length) console.log(`${c.red('✗')} ${label}`);
  else if (!quiet || r.warnings.length) console.log(`${c.green('✓')} ${label}`);
  for (const e of r.errors) console.log(`    ${c.red('错误')} ${e}`);
  for (const w of r.warnings) console.log(`    ${c.yellow('提示')} ${w}`);
  return r.errors.length || !r.manifest ? null : r;
}

function pack(book: LocalBook) {
  const r = checkBook(book, true);
  if (!r) return null;
  const data = packBook(book, r.manifest!.id);
  if (data.length > MAX_PACKAGE_BYTES) {
    console.log(`    ${c.red('错误')} 打包后超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB`);
    return null;
  }
  return { manifest: r.manifest!, data };
}

const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

const program = new Command('shelf-pack').description('书架内容校验、打包与局域网推送');

program
  .command('check')
  .argument('<path>', '一本书的目录，或 books/ 根目录')
  .description('按写书规范校验')
  .action((target: string) => {
    const books = findBooks(target);
    const failed = books.map((d) => checkBook(readBook(d))).filter((r) => !r).length;
    console.log(failed ? c.red(`\n${failed} / ${books.length} 本书有错误`) : c.green(`\n${books.length} 本书全部通过`));
    process.exitCode = failed ? 1 : 0;
  });

program
  .command('ls')
  .argument('[path]', 'books/ 根目录', 'books')
  .description('按分类列出书：id、章数、更新日期、书名')
  .action((target: string) => {
    const books = findBooks(target).map(readBook);
    const groups = groupByCategory(books);
    const width = Math.max(...books.map((b) => b.dirName.length));
    for (const [category, rows] of groups) {
      console.log(`\n${category} ${c.dim(`(${rows.length})`)}`);
      for (const r of rows) {
        const meta = c.dim(`${String(r.chapters).padStart(2)} 章  ${r.updated ?? '          '}`);
        console.log(`  ${r.dirName.padEnd(width)}  ${meta}  ${r.title ?? c.red('book.yaml 有误')}`);
      }
    }
    console.log(c.dim(`\n共 ${books.length} 本，${groups.length} 个分类`));
  });

program
  .command('pack')
  .argument('<book-dir>', '一本书的目录')
  .option('-o, --out <file>', '输出 zip 路径，默认 <id>.zip')
  .description('校验后打包成 zip，可以 AirDrop 到手机')
  .action((dir: string, opts: { out?: string }) => {
    const r = pack(readBook(path.resolve(dir)));
    if (!r) return void (process.exitCode = 1);
    const out = path.resolve(opts.out ?? `${r.manifest.id}.zip`);
    writeFileSync(out, r.data);
    const shown = path.relative(process.cwd(), out);
    console.log(`${c.green('→')} ${shown.startsWith('..') ? out : shown} (${kb(r.data.length)})`);
  });

program
  .command('push')
  .argument('<path>', '一本书的目录，或 books/ 根目录')
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .option('--changed', '对比手机上已有书籍的内容指纹，只推送新增或有变化的书')
  .description('打包并通过局域网推送到手机')
  .action(async (target: string, opts: { to: string; pin: string; changed?: boolean }) => {
    try {
      const books = findBooks(target).map(readBook);
      const onDevice = opts.changed
        ? new Map((await listDeviceBooks(opts.to, opts.pin)).map((b) => [b.id, b]))
        : null;

      let failed = 0;
      let pushed = 0;
      for (const book of books) {
        const r = pack(book);
        if (!r) {
          failed += 1;
          continue;
        }
        if (onDevice) {
          // 用 App 同一套导入逻辑算指纹，保证与设备上记录的一致
          const prepared = prepareImport({ kind: 'zip', fileName: `${r.manifest.id}.zip`, bytes: r.data });
          const remote = onDevice.get(r.manifest.id);
          if (prepared.ok && remote?.hash === prepared.hash) {
            console.log(`${c.dim('-')} ${book.dirName} ${c.dim('未变化，跳过')}`);
            continue;
          }
        }
        pushed += 1;
        const res = await upload(opts.to, opts.pin, `${r.manifest.id}.zip`, r.data);
        if (res.ok) {
          console.log(`${c.green('↑')} ${book.dirName} ${c.dim(`${res.status === 'updated' ? '已更新' : '已新增'} · ${kb(r.data.length)}`)}`);
          for (const w of res.warnings ?? []) console.log(`    ${c.yellow('提示')} ${w}`);
        } else {
          failed += 1;
          console.log(`${c.red('✗')} ${book.dirName} ${res.error}`);
        }
      }
      if (pushed === 0 && failed === 0) console.log('没有需要推送的书');
      process.exitCode = failed ? 1 : 0;
    } catch (e) {
      // PIN 错误时立即停止，避免连续失败把手机上的服务锁掉
      console.error(c.red(e instanceof PinError ? `${e.message}，已停止推送` : (e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command('pull-notes')
  .argument('[dir]', '笔记目录', 'notes')
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .description('从手机拉取全部阅读笔记，写成 <dir>/<book-id>.notes.md')
  .action(async (dir: string, opts: { to: string; pin: string }) => {
    try {
      const notes = await pullDeviceNotes(opts.to, opts.pin);
      if (notes.length === 0) return console.log('手机上还没有高亮和笔记');
      mkdirSync(dir, { recursive: true });
      let written = 0;
      for (const n of notes) {
        const file = path.join(dir, `${n.id}.notes.md`);
        const old = existsSync(file) ? readFileSync(file, 'utf8') : null;
        const label = `${n.id}  ${c.dim(`${n.title} · ${n.count} 条`)}`;
        if (old !== null && sameNotes(old, n.markdown)) {
          console.log(`${c.dim('-')} ${label} ${c.dim('未变化')}`);
          continue;
        }
        writeFileSync(file, n.markdown);
        written += 1;
        console.log(`${c.green('↓')} ${label} ${c.dim(old === null ? '新增' : '已更新')}`);
      }
      const shown = path.relative(process.cwd(), path.resolve(dir));
      console.log(c.dim(`\n${written} 个文件有变化，写入 ${shown.startsWith('..') ? path.resolve(dir) : shown || '.'}/`));
    } catch (e) {
      console.error(c.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command('backup')
  .argument('[dir]', '备份目录', 'backups')
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .description('把手机上的阅读进度、高亮与笔记、阅读设置备份成 <dir>/shelf-backup-<日期>.json')
  .action(async (dir: string, opts: { to: string; pin: string }) => {
    try {
      const backup = await pullBackup(opts.to, opts.pin);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `shelf-backup-${new Date(backup.exportedAt).toISOString().slice(0, 10)}.json`);
      writeFileSync(file, `${JSON.stringify(backup, null, 2)}\n`);
      const books = new Set(backup.progress.map((p) => p.book_id)).size;
      const shown = path.relative(process.cwd(), path.resolve(file));
      console.log(`${c.green('↓')} ${shown.startsWith('..') ? path.resolve(file) : shown}`);
      console.log(c.dim(`  ${books} 本书的阅读进度 · ${backup.highlights.length} 条高亮与笔记`));
    } catch (e) {
      console.error(c.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command('restore')
  .argument('<file>', 'backup 命令或 App 导出的备份文件')
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .description('把备份合并回手机：本机没有的写入，两边都有的保留较新的一份')
  .action(async (file: string, opts: { to: string; pin: string }) => {
    try {
      console.log(`${c.green('↑')} ${await pushRestore(opts.to, opts.pin, readFileSync(file, 'utf8'))}`);
    } catch (e) {
      console.error(c.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program.parse();

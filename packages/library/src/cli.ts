#!/usr/bin/env -S npx tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { audioPackageName, LIBRARY_AUDIO_DIR, MAX_PACKAGE_BYTES, prepareImport, sameChapterAudio } from '@shelf/spec';
import { Command } from 'commander';
import {
  buildChapterPackage,
  DEFAULT_PARAMS,
  DEFAULT_VOICE,
  estimateSeconds,
  fishApiKey,
  generateAudio,
  planAudio,
  readAudioManifest,
  voiceName,
  writeAudioManifest,
} from './audio';
import {
  bookIndex,
  bookLabel,
  findBook,
  findBooks,
  groupByCategory,
  libraryBooks,
  lint,
  moveBook,
  newBook,
  packBook,
  readBook,
  REPO_ROOT,
  resolveTarget,
  sameNotes,
  type LocalBook,
} from './books';
import { segmentChapter } from './segment';
import { fetchDeviceAudio, listDeviceBooks, PinError, pullBackup, pullDeviceNotes, pushRestore, upload } from './device';

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

/** 校验并打印问题；有错误时返回 null */
function checkBook(book: LocalBook, quiet = false) {
  const r = lint(book);
  const label = r.manifest ? `${bookLabel(book, r)}  ${c.dim(r.manifest.title)}` : bookLabel(book);
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

const program = new Command('shelf-pack').description(
  '书架内容校验、打包与局域网推送。书库默认是代码仓库旁边的 hatch-shelf-library（环境变量 SHELF_LIBRARY 可改）；\n' +
    '指定一本书时传书名（或书名的一部分）、书库里的路径、id 或目录都可以',
);

/** 显示路径：在当前目录下用相对路径，否则用绝对路径 */
const shownPath = (p: string) => {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith('..') ? p : rel || '.';
};

program
  .command('check')
  .argument('[target]', '一本书、书库里的分组名或任意目录；不传就校验整个书库')
  .description('按写书规范校验')
  .action((target?: string) => {
    const books = findBooks(resolveTarget(target));
    const failed = books.map((d) => checkBook(readBook(d))).filter((r) => !r).length;
    console.log(failed ? c.red(`\n${failed} / ${books.length} 本书有错误`) : c.green(`\n${books.length} 本书全部通过`));
    process.exitCode = failed ? 1 : 0;
  });

program
  .command('ls')
  .argument('[target]', '书库里的分组名或任意目录；不传就列出整个书库')
  .description('按分类列出书：书名、章数、更新日期、有没有原声、id 前 8 位')
  .action((target?: string) => {
    const books = findBooks(resolveTarget(target)).map(readBook);
    const groups = groupByCategory(books);
    const width = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
    const nameWidth = Math.max(...groups.flatMap(([, rows]) => rows.map((r) => width(r.title ?? r.id))));
    for (const [category, rows] of groups) {
      console.log(`\n${category} ${c.dim(`(${rows.length})`)}`);
      for (const r of rows) {
        const name = r.title ?? c.red(`${r.id}（book.yaml 有误）`);
        const pad = ' '.repeat(Math.max(0, nameWidth - width(r.title ?? r.id)));
        const meta = c.dim(`${String(r.chapters).padStart(2)} 章  ${r.updated ?? '          '}  ${r.audio ? '原声' : '    '}  ${r.id.slice(0, 8)}`);
        console.log(`  ${name}${pad}  ${meta}`);
      }
    }
    console.log(c.dim(`\n共 ${books.length} 本，${groups.length} 个分类`));
  });

program
  .command('pack')
  .argument('<book>', '一本书')
  .option('-o, --out <file>', '输出 zip 路径，默认 <书名>.zip')
  .description('校验后打包成 zip，可以 AirDrop 到手机')
  .action((arg: string, opts: { out?: string }) => {
    const r = pack(readBook(findBook(arg)));
    if (!r) return void (process.exitCode = 1);
    const out = path.resolve(opts.out ?? `${r.manifest.title.replace(/[/\\:]/g, '-')}.zip`);
    writeFileSync(out, r.data);
    console.log(`${c.green('→')} ${shownPath(out)} (${kb(r.data.length)})`);
  });

program
  .command('push')
  .argument('<target>', '一本书、书库里的分组名或任意目录；传 books 或书库路径就是整个书库')
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .option('--changed', '对比手机上已有书籍的内容指纹，只推送新增或有变化的书')
  .description('打包并通过局域网推送到手机')
  .action(async (target: string, opts: { to: string; pin: string; changed?: boolean }) => {
    try {
      const books = findBooks(target === 'books' ? libraryBooks() : resolveTarget(target)).map(readBook);
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
            console.log(`${c.dim('-')} ${bookLabel(book, r)} ${c.dim('未变化，跳过')}`);
            continue;
          }
        }
        pushed += 1;
        const res = await upload(opts.to, opts.pin, `${r.manifest.id}.zip`, r.data);
        if (res.ok) {
          console.log(`${c.green('↑')} ${bookLabel(book, r)} ${c.dim(`${res.status === 'updated' ? '已更新' : '已新增'} · ${kb(r.data.length)}`)}`);
          for (const w of res.warnings ?? []) console.log(`    ${c.yellow('提示')} ${w}`);
        } else {
          failed += 1;
          console.log(`${c.red('✗')} ${bookLabel(book, r)} ${res.error}`);
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
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .description('从手机拉取全部阅读笔记，写到书库里各本书目录下的 notes.md')
  .action(async (opts: { to: string; pin: string }) => {
    try {
      const notes = await pullDeviceNotes(opts.to, opts.pin);
      if (notes.length === 0) return console.log('手机上还没有高亮和笔记');
      const root = libraryBooks();
      let written = 0;
      for (const n of notes) {
        const entry = bookIndex(root).find((e) => e.manifest?.id === n.id);
        const label = `${entry?.relPath ?? n.title}  ${c.dim(`${n.count} 条`)}`;
        if (!entry) {
          console.log(`${c.yellow('?')} ${label} ${c.dim(`书库里没有这本书（${n.id}），跳过`)}`);
          continue;
        }
        const file = path.join(entry.dir, 'notes.md');
        const old = existsSync(file) ? readFileSync(file, 'utf8') : null;
        if (old !== null && sameNotes(old, n.markdown)) {
          console.log(`${c.dim('-')} ${label} ${c.dim('未变化')}`);
          continue;
        }
        writeFileSync(file, n.markdown);
        written += 1;
        console.log(`${c.green('↓')} ${label} ${c.dim(old === null ? '新增' : '已更新')}`);
      }
      console.log(c.dim(`\n${written} 本书的笔记有变化，写在 ${shownPath(root)}/ 各书目录的 notes.md`));
    } catch (e) {
      console.error(c.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command('backup')
  .argument('[dir]', '备份目录，默认代码仓库的 backups/（不入库）', path.join(REPO_ROOT, 'backups'))
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
      console.log(`${c.green('↓')} ${shownPath(path.resolve(file))}`);
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

const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} 小时`;

program
  .command('audio')
  .argument('<book>', '一本书')
  .option('--voice <id>', 'Fish Audio 音色 id', DEFAULT_VOICE)
  .option('--speed <n>', '语速 0.5–2', '1')
  .option('--only <chapters>', '只生成这些章：逗号分隔的章节文件名或序号前缀，如 01,02')
  .option('-j, --concurrency <n>', '同时合成的请求数', '3')
  .option('--dry', '只打印朗读稿（按段落），不合成')
  .description('用 Fish Audio 把书按阅读器的段落预先读成录音（原声），写到书目录下的 audio/；可以随时中断，重跑只补缺的')
  .action(async (arg: string, opts: { voice: string; speed: string; only?: string; concurrency: string; dry?: boolean }) => {
    const book = readBook(findBook(arg));
    const r = checkBook(book, true);
    if (!r) return void (process.exitCode = 1);
    const meta = r.manifest!;
    const speed = Number(opts.speed);
    if (!(speed >= 0.5 && speed <= 2)) throw new Error('--speed 应在 0.5 到 2 之间');
    const only = opts.only?.split(',').map((s) => s.trim()).filter(Boolean);
    const picked = meta.chapters.filter((ch) => !only || only.some((p) => ch === p || ch.startsWith(p)));
    if (picked.length === 0) throw new Error(`--only 没有匹配的章节：${opts.only}`);

    const voice = { provider: 'fish' as const, id: opts.voice };
    const params = { ...DEFAULT_PARAMS, speed };
    const plan = planAudio(book, meta, voice, params);

    if (opts.dry) {
      for (const ch of picked) {
        const md = book.files.find((f) => f.path === ch)!.text!;
        console.log(`\n# ${ch}`);
        for (const [i, text] of segmentChapter(md).entries()) console.log(`${String(i + 1).padStart(4)}  ${text}`);
      }
      return;
    }

    const fps = [...new Set(picked.flatMap((ch) => plan.chapterFiles.get(ch)!))];
    const outDir = path.join(book.dir, LIBRARY_AUDIO_DIR);
    const missing = fps.filter((fp) => !existsSync(path.join(outDir, `${fp}.mp3`)));
    const missingChars = missing.reduce((n, fp) => n + plan.jobs.get(fp)!.length, 0);
    console.log(
      `${meta.title}：${plan.paragraphs} 段，${plan.chars} 字，约 ${hours(estimateSeconds(plan.chars, speed))}；` +
        `本次 ${picked.length} 章，需要合成 ${missing.length} / ${fps.length} 个录音（${missingChars} 字）`,
    );

    const key = fishApiKey();
    plan.manifest.voice = { ...voice, name: await voiceName(key, voice.id) };
    // Ctrl-C 时先把已经齐全的章节写进清单
    process.once('SIGINT', () => {
      const n = writeAudioManifest(outDir, plan);
      console.log(c.yellow(`\n已中断；${n} 章录音齐全，重跑同一命令即可接着生成`));
      process.exit(130);
    });
    const started = Date.now();
    const { failed } = await generateAudio(outDir, plan, missing, {
      key,
      concurrency: Number(opts.concurrency),
      onProgress: (done, total) => {
        const eta = ((Date.now() - started) / done) * (total - done);
        process.stdout.write(`\r  ${done} / ${total}  ${c.dim(`剩余约 ${Math.ceil(eta / 60000)} 分钟`)}   `);
      },
    });
    if (missing.length) process.stdout.write('\n');
    const complete = writeAudioManifest(outDir, plan);
    for (const f of failed) console.log(`    ${c.red('失败')} ${f.fp}  ${f.error}  ${c.dim(plan.jobs.get(f.fp)!.slice(0, 40))}`);
    console.log(
      (failed.length ? c.yellow : c.green)(
        `${complete} / ${meta.chapters.length} 章录音齐全 → ${shownPath(outDir)}` +
          (failed.length ? `；${failed.length} 个失败，重跑同一命令会补上` : ''),
      ),
    );
    process.exitCode = failed.length ? 1 : 0;
  });

program
  .command('push-audio')
  .argument('<book>', '一本书（录音在书目录下的 audio/）')
  .requiredOption('--to <ip>', '手机传书页面上显示的 IP（可带 :端口）')
  .requiredOption('--pin <pin>', '传书页面上显示的 PIN')
  .option('--all', '不对比手机上已有的原声，全部重推')
  .description('按章把原声推送到手机；手机上已有且相同的章节跳过')
  .action(async (arg: string, opts: { to: string; pin: string; all?: boolean }) => {
    try {
      const outDir = path.join(findBook(arg), LIBRARY_AUDIO_DIR);
      const local = readAudioManifest(outDir);
      const bookId = local.bookId;
      const onDevice = await listDeviceBooks(opts.to, opts.pin);
      if (!onDevice.some((b) => b.id === bookId)) throw new Error(`手机上还没有这本书（${bookId}），先用 shelf-pack push 推送`);
      const remote = opts.all ? null : await fetchDeviceAudio(opts.to, opts.pin, bookId);

      let failed = 0;
      let pushed = 0;
      for (const chapter of Object.keys(local.chapters)) {
        if (sameChapterAudio(remote, local, chapter)) {
          console.log(`${c.dim('-')} ${chapter} ${c.dim('手机上已有，跳过')}`);
          continue;
        }
        const data = buildChapterPackage(outDir, local, chapter);
        if (data.length > MAX_PACKAGE_BYTES) {
          failed += 1;
          console.log(`${c.red('✗')} ${chapter} 超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB，App 收不下`);
          continue;
        }
        pushed += 1;
        const res = await upload(opts.to, opts.pin, audioPackageName(bookId, chapter), data);
        if (res.ok) console.log(`${c.green('↑')} ${chapter} ${c.dim(`${(data.length / 1024 / 1024).toFixed(1)} MB`)}`);
        else {
          failed += 1;
          console.log(`${c.red('✗')} ${chapter} ${res.error}`);
        }
      }
      if (pushed === 0 && failed === 0) console.log('手机上的原声已是最新');
      process.exitCode = failed ? 1 : 0;
    } catch (e) {
      console.error(c.red(e instanceof PinError ? `${e.message}，已停止推送` : (e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command('new')
  .argument('<category>', '分类，如 人工智能 或 人工智能/RAG（第一段是书架分组，也是目录）')
  .argument('<title>', '书名')
  .description('新建一本书：生成 UUID，建好 books/<分组>/<书名>/、book.yaml 和第一章')
  .action((category: string, title: string) => {
    const dir = newBook(category, title);
    console.log(`${c.green('+')} ${shownPath(dir)}`);
  });

program
  .command('mv')
  .argument('<book>', '一本书')
  .option('--title <title>', '新书名')
  .option('--category <category>', '新分类')
  .description('改书名或分类：改 book.yaml、移动目录，并改写书库里指向这本书的链接和 next；id 不变')
  .action((arg: string, opts: { title?: string; category?: string }) => {
    if (opts.title === undefined && opts.category === undefined) throw new Error('--title 和 --category 至少给一个');
    const r = moveBook(findBook(arg), opts);
    console.log(r.from === r.to ? '目录不用动' : `${c.green('→')} ${r.from} → ${r.to}`);
    for (const f of r.rewritten) console.log(`    ${c.dim('改写引用')} ${f}`);
  });

program.parse();

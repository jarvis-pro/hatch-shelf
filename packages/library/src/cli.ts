#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIBRARY_AUDIO_DIR } from '@shelf/spec';
import { Command } from 'commander';
import {
  DEFAULT_PARAMS,
  DEFAULT_VOICE,
  estimateSeconds,
  fishApiKey,
  generateAudio,
  planAudio,
  voiceName,
  writeAudioManifest,
} from './audio';
import {
  bookLabel,
  findBook,
  findBooks,
  groupByCategory,
  libraryBooks,
  lint,
  moveBook,
  newBook,
  readBook,
  resolveTarget,
  type LocalBook,
} from './books';
import { segmentChapter } from './segment';

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

const program = new Command('shelf-pack').description(
  '书库的校验、新建、整理与原声生成（推书用 Dock）。书库默认是代码仓库旁边的 hatch-shelf-library（环境变量 SHELF_LIBRARY 可改）；\n' +
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

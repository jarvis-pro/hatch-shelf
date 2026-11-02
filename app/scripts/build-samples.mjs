// 把 books/ 下的示例书生成成 src/samples.generated.ts，首次启动时写入设备的 books/。
// 这样不需要解压库，books/ 目录本身也不会进安装包。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SAMPLE_IDS = ['shelf-guide', 'markdown-cheatsheet'];
const TEXT_EXT = new Set(['.md', '.yaml', '.yml', '.svg']);

const booksRoot = path.resolve(import.meta.dirname, '../../books');
const outFile = path.resolve(import.meta.dirname, '../src/samples.generated.ts');

function walk(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('.')) return [];
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) return walk(full, rel);
    const buf = readFileSync(full);
    return TEXT_EXT.has(path.extname(name).toLowerCase())
      ? [{ path: rel, text: buf.toString('utf8') }]
      : [{ path: rel, base64: buf.toString('base64') }];
  });
}

const books = SAMPLE_IDS.map((id) => ({ id, files: walk(path.join(booksRoot, id)) }));

writeFileSync(
  outFile,
  `// 由 scripts/build-samples.mjs 生成，不要手改\n` +
    `export interface SampleFile { path: string; text?: string; base64?: string }\n` +
    `export const SAMPLE_BOOKS: { id: string; files: SampleFile[] }[] = ${JSON.stringify(books)};\n`,
);
console.log(`samples → ${path.relative(process.cwd(), outFile)} (${books.map((b) => b.id).join(', ')})`);

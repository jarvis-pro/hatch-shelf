import { lintLinks, headingAnchors, type ChapterAnchors } from './links';
import { resolveBook } from './manifest';
import { scanMarkdown } from './markdown';
import { isAllowedFile, MAX_PACKAGE_BYTES } from './rules';
import { CHAPTER_FILE_RE, type BookManifest } from './schema';

export interface LintFile {
  /** 相对书目录的路径 */
  path: string;
  size: number;
  /** .md / book.yaml 的内容 */
  text?: string;
}

export interface LintResult {
  manifest?: BookManifest;
  /** 实际会被阅读器读到的章节 */
  chapters: string[];
  errors: string[];
  warnings: string[];
}

const isRemote = (src: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && !src.startsWith('data:');

/** 去掉行内代码，避免把 `![x](y)` 这样的示例当成真的图片 */
const stripInlineCode = (line: string) => line.replace(/(`+)[\s\S]*?\1/g, '');

/**
 * 按写书规范（books/AGENTS.md）检查一章，返回问题列表。
 * `assets` 是本书 assets/ 下实际存在的文件路径集合。
 */
export function lintChapter(file: string, markdown: string, assets: Set<string>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const at = (no: number) => `${file}:${no}`;
  let h1 = 0;

  for (const line of scanMarkdown(markdown)) {
    if (line.fenceInfo !== undefined && line.fenceInfo === '') errors.push(`${at(line.no)} 代码块没有标注语言`);
    if (line.inFence) continue;
    if (/^#\s+\S/.test(line.text)) h1 += 1;

    const text = stripInlineCode(line.text);
    const srcs = [
      ...[...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]),
    ];
    for (const raw of srcs) {
      if (isRemote(raw)) {
        errors.push(`${at(line.no)} 远程图片（离线时无法显示）：${raw}`);
        continue;
      }
      if (raw.startsWith('data:')) continue;
      const path = decodeURI(raw.split(/[?#]/)[0]).replace(/^\.\//, '');
      if (!path.startsWith('assets/')) errors.push(`${at(line.no)} 图片必须放在 assets/ 下：${raw}`);
      else if (!assets.has(path)) errors.push(`${at(line.no)} 图片不存在：${raw}`);
    }
  }

  if (h1 === 0) errors.push(`${file} 没有 H1 章标题`);
  else if (h1 > 1) errors.push(`${file} 有 ${h1} 个 H1，每章只能有一个`);
  return { errors, warnings };
}

/** 一本书的 id 和各章标题锚点；校验跨书链接时用来描述目标书。book.yaml 有误时返回 null */
export function bookAnchors(dirName: string, files: LintFile[]): { id: string; chapters: ChapterAnchors } | null {
  const rootMd = files.filter((f) => !f.path.includes('/') && f.path.endsWith('.md'));
  const yaml = files.find((f) => f.path === 'book.yaml');
  const resolved = resolveBook({ dirName, yamlText: yaml?.text, mdFiles: rootMd.map((f) => f.path) });
  if (!resolved.ok) return null;
  const chapters: ChapterAnchors = new Map(
    resolved.chapters.map((ch) => [ch, headingAnchors(files.find((f) => f.path === ch)?.text ?? '')]),
  );
  return { id: resolved.manifest.id, chapters };
}

export interface LintOptions {
  /** 另一本书的章节锚点，书不存在时返回 null，无从判断时返回 undefined；不传时跨书链接和 next 都按不存在处理 */
  resolveBook?(id: string): ChapterAnchors | null | undefined;
}

/**
 * 检查一整本书（shelf-pack check 使用）。比 App 导入时的容错更严格：
 * 导入时会被跳过、兜底的情况，在这里都作为问题报出来，让作者在电脑上修好。
 */
export function lintBook(dirName: string, files: LintFile[], opts: LintOptions = {}): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rootMd = files.filter((f) => !f.path.includes('/') && f.path.endsWith('.md'));
  const yaml = files.find((f) => f.path === 'book.yaml');

  const resolved = resolveBook({ dirName, yamlText: yaml?.text, mdFiles: rootMd.map((f) => f.path) });
  if (!resolved.ok) return { chapters: [], errors: resolved.errors, warnings };

  const { manifest, chapters } = resolved;
  if (!yaml) errors.push('缺少 book.yaml');
  else if (manifest.id !== dirName) errors.push(`book.yaml 中的 id（${manifest.id}）与目录名（${dirName}）不一致`);

  for (const f of manifest.chapters) if (!chapters.includes(f)) errors.push(`chapters 中列出的文件不存在：${f}`);
  for (const f of rootMd) if (!manifest.chapters.includes(f.path)) warnings.push(`未列入 chapters，不会被导入：${f.path}`);
  for (const f of rootMd) if (!CHAPTER_FILE_RE.test(f.path)) errors.push(`文件名只能使用 [a-z0-9-]：${f.path}`);

  const resolveOther = opts.resolveBook ?? (() => null);
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (!isAllowedFile(f.path)) warnings.push(`不支持的文件类型，导入时会被丢弃：${f.path}`);
    else if (f.path.includes('/') && !f.path.startsWith('assets/')) {
      warnings.push(`assets/ 以外的子目录文件不会被用到：${f.path}`);
    }
  }
  if (total > MAX_PACKAGE_BYTES) errors.push(`整本书超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB`);

  for (const { id } of manifest.next ?? []) {
    if (id === manifest.id) errors.push('next 不能推荐本书自己');
    else if (resolveOther(id) === null) errors.push(`next 推荐的书不存在：${id}`);
  }

  const assets = new Set(files.filter((f) => f.path.startsWith('assets/')).map((f) => f.path));
  const self = bookAnchors(dirName, files)!;
  for (const ch of chapters) {
    const text = files.find((f) => f.path === ch)?.text ?? '';
    const r = lintChapter(ch, text, assets);
    errors.push(...r.errors, ...lintLinks(ch, text, self, resolveOther));
    warnings.push(...r.warnings);
  }

  return { manifest, chapters, errors, warnings };
}

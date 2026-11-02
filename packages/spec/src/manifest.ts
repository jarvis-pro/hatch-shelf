import { parse as parseYaml } from 'yaml';
import { bookManifestSchema, SLUG_RE, type BookManifest } from './schema';

export type ParseResult =
  | { ok: true; manifest: BookManifest }
  | { ok: false; errors: string[] };

/** 解析并校验 book.yaml 文本 */
export function parseBookYaml(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return { ok: false, errors: [`book.yaml 不是合法的 YAML：${(e as Error).message}`] };
  }
  const result = bookManifestSchema.safeParse(raw);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** 把任意名字规整成合法 id，用于没有 book.yaml 时的兜底 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SLUG_RE.test(slug) ? slug : `book-${Date.now().toString(36)}`;
}

export interface ResolveInput {
  /** 书目录名（或单个 .md 的文件名） */
  dirName: string;
  /** book.yaml 原文；不存在时为 undefined */
  yamlText?: string;
  /** 目录内实际存在的 .md 文件名（不含子目录） */
  mdFiles: string[];
}

export type ResolveResult =
  | {
      ok: true;
      manifest: BookManifest;
      /** 实际可读的章节，已按 manifest 顺序排好 */
      chapters: string[];
      /** 非致命问题：缺失章节、使用了兜底规则等 */
      warnings: string[];
    }
  | { ok: false; errors: string[] };

/**
 * 按 README 第 4.4 节的容错规则得出一本书的最终结构。
 * App 导入管线与 shelf-pack check 共用此函数，保证两边判断一致。
 */
export function resolveBook({ dirName, yamlText, mdFiles }: ResolveInput): ResolveResult {
  const present = new Set(mdFiles);

  if (yamlText === undefined) {
    const chapters = [...mdFiles].sort();
    if (chapters.length === 0) return { ok: false, errors: ['没有 book.yaml，也没有任何 .md 文件'] };
    const id = slugify(dirName);
    return {
      ok: true,
      manifest: { id, title: dirName.replace(/\.md$/, ''), chapters },
      chapters,
      warnings: ['缺少 book.yaml，已使用目录名作为 id 和标题，章节按文件名排序'],
    };
  }

  const parsed = parseBookYaml(yamlText);
  if (!parsed.ok) return parsed;

  const warnings: string[] = [];
  const chapters = parsed.manifest.chapters.filter((file) => {
    if (present.has(file)) return true;
    warnings.push(`章节文件不存在，已跳过：${file}`);
    return false;
  });
  if (chapters.length === 0) return { ok: false, errors: ['chapters 中列出的文件都不存在'] };

  return { ok: true, manifest: parsed.manifest, chapters, warnings };
}

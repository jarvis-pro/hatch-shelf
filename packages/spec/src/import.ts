import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';
import { stringify as stringifyYaml } from 'yaml';
import { resolveBook, slugify } from './manifest';
import { contentHash } from './hash';
import { firstHeading } from './markdown';
import { isAllowedFile, isSafeEntryPath, MAX_PACKAGE_BYTES } from './rules';
import type { BookManifest } from './schema';

/** 解压后的总大小上限，防 zip 炸弹 */
export const MAX_UNPACKED_BYTES = 4 * MAX_PACKAGE_BYTES;

const TEXT_EXTENSIONS = ['.md', '.yaml', '.yml', '.svg'];

export interface PackedFile {
  /** 相对书目录的路径，如 `assets/a.png` */
  path: string;
  text?: string;
  /** 二进制文件内容 */
  bytes?: Uint8Array;
}

export type ImportInput =
  | { kind: 'zip'; fileName: string; bytes: Uint8Array }
  | { kind: 'md'; fileName: string; text: string };

export type PreparedImport =
  | {
      ok: true;
      id: string;
      manifest: BookManifest;
      files: PackedFile[];
      /** 写入设备的全部文件的内容指纹，见 contentHash */
      hash: string;
      warnings: string[];
    }
  | { ok: false; error: string };

const fail = (error: string): PreparedImport => ({ ok: false, error });
const baseName = (fileName: string) => fileName.replace(/^.*[\\/]/, '').replace(/\.(zip|md)$/i, '');

/** macOS 压缩时附带的元数据，直接丢弃，不算警告 */
const isJunk = (path: string) =>
  path.startsWith('__MACOSX/') || path.split('/').some((seg) => seg === '.DS_Store' || seg.startsWith('._'));

/**
 * 把一个导入包变成可直接写入 books/<id>/ 的文件列表（README 第 6 节第 2、3 步）。
 * 纯函数，不碰文件系统：App 导入管线与 shelf-pack 共用。
 *
 * - zip 里可以直接放书的文件，也可以套一层书目录
 * - 缺少 book.yaml、单个 .md 时按第 4.4 节兜底，并补写一份 book.yaml，
 *   保证设备上的目录名、id 与标题之后重建索引时保持一致
 */
export function prepareImport(input: ImportInput): PreparedImport {
  if (input.kind === 'md') return prepareMarkdown(input.fileName, input.text);

  if (input.bytes.byteLength > MAX_PACKAGE_BYTES) {
    return fail(`文件超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB`);
  }

  // 先只看条目信息，确认安全后再真正解压
  const warnings: string[] = [];
  let unsafe: string | null = null;
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(input.bytes, {
      filter: (f: UnzipFileInfo) => {
        if (f.name.endsWith('/') || isJunk(f.name)) return false;
        if (!isSafeEntryPath(f.name)) {
          unsafe ??= f.name;
          return false;
        }
        if (!isAllowedFile(f.name)) {
          warnings.push(`不支持的文件类型，已忽略：${f.name}`);
          return false;
        }
        total += f.originalSize;
        return total <= MAX_UNPACKED_BYTES;
      },
    });
  } catch (e) {
    return fail(`无法解压：${(e as Error).message}`);
  }
  if (unsafe) return fail(`压缩包包含不安全的路径：${unsafe}`);
  if (total > MAX_UNPACKED_BYTES) return fail('解压后的内容过大');

  let paths = Object.keys(entries);
  if (paths.length === 0) return fail('压缩包里没有可导入的文件');

  // 所有文件都在同一个顶层目录下时，把它当作书目录并去掉这一层
  let dirName = baseName(input.fileName);
  const tops = new Set(paths.map((p) => p.split('/')[0]));
  if (tops.size === 1 && paths.every((p) => p.includes('/'))) {
    const [top] = tops;
    dirName = top;
    entries = Object.fromEntries(paths.map((p) => [p.slice(top.length + 1), entries[p]]));
    paths = Object.keys(entries);
  }

  const rootFiles = paths.filter((p) => !p.includes('/'));
  const yamlPath = rootFiles.find((p) => p === 'book.yaml');
  const yamlText = yamlPath ? strFromU8(entries[yamlPath]) : undefined;
  const resolved = resolveBook({
    dirName,
    yamlText,
    mdFiles: rootFiles.filter((p) => p.endsWith('.md')),
  });
  if (!resolved.ok) return fail(resolved.errors.join('\n'));

  const files: PackedFile[] = paths
    .filter((p) => p !== 'book.yaml')
    .map((p) =>
      TEXT_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext))
        ? { path: p, text: strFromU8(entries[p]) }
        : { path: p, bytes: entries[p] },
    );

  if (yamlText !== undefined) {
    files.push({ path: 'book.yaml', text: yamlText });
  } else {
    // 兜底时目录名可能不是合法 id；标题保留原始目录名
    const manifest = { ...resolved.manifest, title: dirName };
    files.push({ path: 'book.yaml', text: stringifyYaml(manifest) });
    resolved.manifest = manifest;
  }

  return {
    ok: true,
    id: resolved.manifest.id,
    manifest: resolved.manifest,
    files,
    hash: contentHash(files),
    warnings: [...resolved.warnings, ...warnings],
  };
}

function prepareMarkdown(fileName: string, text: string): PreparedImport {
  if (text.length > MAX_PACKAGE_BYTES) return fail(`文件超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB`);
  const name = baseName(fileName);
  const id = slugify(name);
  const chapter = `${id}.md`;
  const manifest: BookManifest = { id, title: firstHeading(text) ?? name, chapters: [chapter] };
  const files = [
    { path: chapter, text },
    { path: 'book.yaml', text: stringifyYaml(manifest) },
  ];
  return { ok: true, id, manifest, files, hash: contentHash(files), warnings: [] };
}

/**
 * 同 id 更新时要删除的阅读进度：只保留新版本里仍然存在的章节（README 第 6 节第 5 步）
 */
export function staleProgressFiles(progressFiles: string[], newChapters: string[]): string[] {
  const keep = new Set(newChapters);
  return progressFiles.filter((f) => !keep.has(f));
}

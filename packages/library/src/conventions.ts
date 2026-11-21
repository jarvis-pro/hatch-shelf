import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { scanMarkdown } from '@shelf/spec';
import { parse } from 'yaml';
import type { LocalBook } from './books';

/**
 * 书库自己的写作约定（`check --strict`）。和 @shelf/spec 的校验不同，这些不影响 App 能否导入，
 * 只是书库对内容的要求：不能出现的词、每章末尾必须有的小节。取值写在书库根目录的 lint.yaml，
 * 「禁止字符画」是写书规范的硬规则，不需要配置。
 */
export interface Conventions {
  /** 书里任何文件（.md、book.yaml、.svg）都不能出现的词，不分大小写 */
  banned: string[];
  /** 按书架分组（category 第一段）列出每章都必须有的 H2 标题，如 `技术: [本章要点, 动手练习]`；没列的分组不查 */
  chapterEndings: Record<string, string[]>;
}

export const CONVENTIONS_FILE = 'lint.yaml';

const strings = (v: unknown, key: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new Error(`${CONVENTIONS_FILE} 的 ${key} 应是非空字符串列表`);
  }
  return v.map((s: string) => s.trim());
};

/** 读书库根目录（books/ 的上一级）的 lint.yaml；没有这个文件时返回 null */
export function readConventions(libraryRootDir: string): Conventions | null {
  const file = path.join(libraryRootDir, CONVENTIONS_FILE);
  if (!existsSync(file)) return null;
  const data: unknown = parse(readFileSync(file, 'utf8')) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${CONVENTIONS_FILE} 应是一个映射`);
  const d = data as Record<string, unknown>;
  const endings = d.chapterEndings ?? {};
  if (typeof endings !== 'object' || Array.isArray(endings)) throw new Error(`${CONVENTIONS_FILE} 的 chapterEndings 应是「分组: 标题列表」的映射`);
  return {
    banned: strings(d.banned, 'banned'),
    chapterEndings: Object.fromEntries(
      Object.entries(endings as Record<string, unknown>).map(([group, v]) => [group.normalize('NFC'), strings(v, `chapterEndings.${group}`)]),
    ),
  };
}

/** 框线和方块字符（U+2500–U+259F）：字符画的特征 */
const BOX = /[\u2500-\u259F]/;
/** 目录树和命令输出里的树（`├── a.md`、`│   └─sda1`、只有竖线）本来就是文本，允许；`└──────┘` 这样分支后面还是框线的不算 */
const TREE_LINE = /^\s*(?:\u2502\s*)*(?:[\u251C\u2514]\u2500+[^\u2500-\u259F].*)?$/;

/**
 * 按书库约定检查一本书。`chapters` 是 book.yaml 里列出的章节文件，`group` 是书架分组（category 第一段）。
 * 返回的都是错误：`--strict` 用在新写的书上，要么改掉，要么改约定。
 */
export function lintConventions(book: LocalBook, chapters: string[], group: string, conv: Conventions): string[] {
  const endings = conv.chapterEndings[group.normalize('NFC')] ?? [];
  const errors: string[] = [];
  const banned = conv.banned.map((w) => w.toLowerCase());

  for (const f of book.files) {
    const isSvg = f.path.toLowerCase().endsWith('.svg');
    const text = f.text ?? (isSvg ? readFileSync(f.abs, 'utf8') : undefined);
    if (text === undefined) continue;
    const lines = text.split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      const lower = line.toLowerCase();
      for (const [k, w] of banned.entries()) {
        if (lower.includes(w)) errors.push(`${f.path}:${i + 1} 出现禁用词「${conv.banned[k]}」`);
      }
    }
  }

  for (const file of chapters) {
    const md = book.files.find((f) => f.path === file)?.text;
    if (md === undefined) continue;
    const h2 = new Set<string>();
    for (const line of scanMarkdown(md)) {
      if (BOX.test(line.text) && !TREE_LINE.test(line.text)) {
        errors.push(`${file}:${line.no} 字符画（框线 / 方块字符），改用 Mermaid 或 SVG；目录树可以保留`);
      }
      const m = !line.inFence && /^##\s+(.+?)\s*#*\s*$/.exec(line.text);
      if (m) h2.add(m[1]);
    }
    for (const want of endings) if (!h2.has(want)) errors.push(`${file} 缺少「${want}」一节`);
  }
  return errors;
}

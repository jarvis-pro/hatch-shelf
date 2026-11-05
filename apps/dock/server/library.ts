import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBooks, forgetIndex, lint, packBook, readAudioManifest, readBook, type LocalBook } from '@shelf/library';
import type { LibBook } from '../shared/types';
import { LIBRARY_AUDIO_DIR, MAX_PACKAGE_BYTES, prepareImport, type AudioManifest, type BookManifest } from '@shelf/spec';

/** 推送、拉笔记时还要用到的本地信息，不发给网页 */
export interface LibEntry {
  info: LibBook;
  dir: string;
  manifest: BookManifest | null;
  /** 打好的包；校验失败时为 null */
  zip: Uint8Array | null;
  audio: AudioManifest | null;
}

export const NO_GROUP = '未分类';

/** `~/xxx` 展开成绝对路径 */
export const expandHome = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

/** 书库路径：给的是书库仓库根目录时用其中的 books/，直接给 books/ 也行 */
export function booksDirOf(input: string): string {
  const abs = expandHome(input.trim());
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`找不到这个目录：${abs}`);
  const books = path.join(abs, 'books');
  return existsSync(books) && statSync(books).isDirectory() ? books : abs;
}

/** 书目录里文件的最近修改时间：内容不变就不重新打包 */
function latestMtime(dir: string): number {
  let latest = statSync(dir).mtimeMs;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    latest = Math.max(latest, st.isDirectory() ? latestMtime(p) : st.mtimeMs);
  }
  return latest;
}

const cache = new Map<string, { mtime: number; entry: LibEntry }>();
/** 最近一次扫描里每本书的目录，取封面时用，不用为每张封面再扫一遍书库 */
const dirs = new Map<string, string>();
export const bookDirOf = (id: string) => dirs.get(id);

function readEntry(dir: string, booksDir: string, mtime: number): LibEntry {
  const book: LocalBook = readBook(dir);
  const r = lint(book);
  const m = r.manifest ?? null;
  const errors = [...r.errors];
  let zip: Uint8Array | null = null;
  let hash: string | null = null;
  if (m && errors.length === 0) {
    zip = packBook(book, m.id);
    if (zip.length > MAX_PACKAGE_BYTES) {
      errors.push(`打包后超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB，App 收不下`);
      zip = null;
    } else {
      // 用 App 同一套导入逻辑算指纹，保证与手机上记录的一致
      const prepared = prepareImport({ kind: 'zip', fileName: `${m.id}.zip`, bytes: zip });
      if (prepared.ok) hash = prepared.hash;
      else errors.push(prepared.error);
    }
  }
  const audioDir = path.join(dir, LIBRARY_AUDIO_DIR);
  let audio: AudioManifest | null = null;
  if (existsSync(path.join(audioDir, 'manifest.json'))) {
    try {
      audio = readAudioManifest(audioDir);
    } catch {
      audio = null;
    }
  }
  const relPath = path.relative(booksDir, dir).split(path.sep).join('/');
  return {
    dir,
    manifest: m,
    zip: errors.length ? null : zip,
    audio,
    info: {
      id: m?.id ?? path.basename(dir),
      title: m?.title ?? path.basename(dir),
      subtitle: m?.subtitle ?? null,
      category: m?.category ?? null,
      relPath,
      group: m?.category?.split('/')[0] ?? (relPath.includes('/') ? relPath.split('/')[0] : NO_GROUP),
      chapters: m?.chapters.length ?? 0,
      mtime,
      errors,
      warnings: r.warnings,
      hash: errors.length ? null : hash,
      bytes: zip?.length ?? 0,
      cover: existsSync(path.join(dir, 'cover.png')),
      audio: audio ? Object.keys(audio.chapters).length : 0,
    },
  };
}

/** 扫一遍书库；没改过的书沿用上次的结果 */
export function scanLibrary(input: string): { booksDir: string; entries: LibEntry[] } {
  const booksDir = booksDirOf(input);
  forgetIndex();
  const entries = findBooks(booksDir)
    .filter((d) => d !== booksDir)
    .map((dir) => {
      const mtime = latestMtime(dir);
      const hit = cache.get(dir);
      if (hit && hit.mtime === mtime) return hit.entry;
      const entry = readEntry(dir, booksDir, mtime);
      cache.set(dir, { mtime, entry });
      return entry;
    });
  dirs.clear();
  for (const e of entries) dirs.set(e.info.id, e.dir);
  return { booksDir, entries };
}

/** 书目录下的 notes.md；没有时为 null */
export function readNotes(dir: string): string | null {
  const f = path.join(dir, 'notes.md');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

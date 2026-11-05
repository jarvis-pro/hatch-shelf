/** 服务端和网页共用的类型与状态判断；不依赖 Node */
import type { DeviceBook, SessionItem } from '@shelf/spec';

/** 列表里的一本书 */
export interface LibBook {
  /** book.yaml 里的 id；读不出来时用目录名，这时 errors 不为空 */
  id: string;
  title: string;
  subtitle: string | null;
  /** book.yaml 的 category；没有封面时文字封面按它取色、显示系列名 */
  category: string | null;
  /** 相对 books/ 的路径 */
  relPath: string;
  /** category 的第一段，书架和 Dock 都按它分组 */
  group: string;
  chapters: number;
  /** 书目录里最近一次改动的时间 */
  mtime: number;
  errors: string[];
  warnings: string[];
  /** 打包后用 App 同一套导入逻辑算出的内容指纹；有错误时为 null */
  hash: string | null;
  bytes: number;
  cover: boolean;
  /** 本地录好的原声章数 */
  audio: number;
}

export interface LibraryResponse {
  booksDir: string;
  books: LibBook[];
}

export type PhoneState =
  | {
      status: 'online';
      addr: string;
      device: string;
      books: DeviceBook[];
      /** 有原声的书在手机上还缺几章（不在手机上的书算全部） */
      audioMissing: Record<string, number>;
      /** 手机上有、且和书库里 notes.md 不一样的笔记：高亮条数 */
      notes: Record<string, number>;
    }
  | { status: 'unpaired' | 'outdated'; addr: string }
  | { status: 'offline' };

export type BookStatus = 'error' | 'unknown' | 'new' | 'update' | 'synced';

export function statusOf(b: LibBook, phone: PhoneState | null): BookStatus {
  if (b.errors.length) return 'error';
  if (phone?.status !== 'online') return 'unknown';
  const d = phone.books.find((x) => x.id === b.id);
  if (!d) return 'new';
  return d.hash && d.hash === b.hash ? 'synced' : 'update';
}

/** 这本书有没有东西要推：新书、有更新，或原声没补齐 */
export function pushable(b: LibBook, phone: PhoneState | null): boolean {
  const s = statusOf(b, phone);
  return s === 'new' || s === 'update' || (s === 'synced' && phone?.status === 'online' && (phone.audioMissing[b.id] ?? 0) > 0);
}

/** 一次推送的进度（服务端维护，网页轮询） */
export interface JobItem extends SessionItem {
  state: 'queued' | 'uploading' | 'done' | 'failed';
  /** 这本书要传的字节数（书 + 原声） */
  bytes: number;
  sent: number;
  /** 正在传原声时是第几章 / 共几章 */
  audio?: { index: number; total: number };
  error?: string;
}

export interface Job {
  state: 'confirm' | 'pushing' | 'done' | 'rejected' | 'failed' | 'stopped';
  items: JobItem[];
  error?: string;
}

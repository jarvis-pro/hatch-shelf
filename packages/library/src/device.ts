import type { AudioManifest } from '@shelf/spec';
import { strToU8 } from 'fflate';

export interface DeviceBook {
  id: string;
  title: string;
  updated: string | null;
  /** 设备上这本书的内容指纹；旧版 App 导入的书没有 */
  hash?: string | null;
}

export class PinError extends Error {}

/** `192.168.1.5` 或 `192.168.1.5:8080` */
export function baseUrl(to: string) {
  return `http://${to.includes(':') ? to : `${to}:8080`}`;
}

async function request(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new Error(`连接 ${url} 失败：${(e as Error).cause ?? (e as Error).message}。手机上的传书页面是否打开？`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || res.status === 403) throw new PinError(String(body.error ?? 'PIN 错误'));
  return { status: res.status, body };
}

export async function listDeviceBooks(to: string, pin: string): Promise<DeviceBook[]> {
  const { body } = await request(`${baseUrl(to)}/books`, { headers: { 'X-Pin': pin } });
  if (!body.ok) throw new Error(String(body.error ?? '获取设备书单失败'));
  return body.books as DeviceBook[];
}

export interface DeviceNotes {
  id: string;
  title: string;
  /** 高亮条数 */
  count: number;
  /** 与 App 分享导出的 <id>.notes.md 内容相同 */
  markdown: string;
}

/** 手机上每本有高亮的书的笔记 */
export async function pullDeviceNotes(to: string, pin: string): Promise<DeviceNotes[]> {
  const { status, body } = await request(`${baseUrl(to)}/notes`, { headers: { 'X-Pin': pin } });
  if (status === 404) throw new Error('手机上的 App 版本不支持拉取笔记，请先更新 App');
  if (!body.ok) throw new Error(String(body.error ?? '获取笔记失败'));
  return body.notes as DeviceNotes[];
}

/** 备份内容由 App 定义和校验（apps/mobile/src/backup/format.ts），CLI 只负责原样存取 */
export interface DeviceBackup {
  exportedAt: number;
  progress: { book_id: string }[];
  highlights: unknown[];
}

export async function pullBackup(to: string, pin: string): Promise<DeviceBackup> {
  const { status, body } = await request(`${baseUrl(to)}/backup`, { headers: { 'X-Pin': pin } });
  if (status === 404) throw new Error('手机上的 App 版本不支持备份，请先更新 App');
  if (!body.ok) throw new Error(String(body.error ?? '获取备份失败'));
  return body.backup as DeviceBackup;
}

/** 把备份文件原样发给手机合并；返回 App 给出的结果说明 */
export async function pushRestore(to: string, pin: string, json: string): Promise<string> {
  const data = strToU8(json);
  const { status, body } = await request(`${baseUrl(to)}/restore`, {
    method: 'POST',
    headers: { 'X-Pin': pin, 'Content-Type': 'application/json', 'Content-Length': String(data.length) },
    body: data,
  });
  if (status === 404) throw new Error('手机上的 App 版本不支持恢复，请先更新 App');
  if (!body.ok) throw new Error(String(body.error ?? '恢复失败'));
  return String(body.message);
}

/** 手机上这本书的原声清单；没有原声为 null */
export async function fetchDeviceAudio(to: string, pin: string, bookId: string): Promise<AudioManifest | null> {
  const { status, body } = await request(`${baseUrl(to)}/audio/${bookId}`, { headers: { 'X-Pin': pin } });
  if (status === 404) throw new Error('手机上的 App 版本不支持原声，请先更新 App');
  if (!body.ok) throw new Error(String(body.error ?? '获取原声清单失败'));
  return (body.manifest as AudioManifest | null) ?? null;
}

export interface UploadResult {
  ok: boolean;
  status?: 'added' | 'updated' | 'audio';
  /** 原声包：本书现在有原声的章数 */
  total?: number;
  error?: string;
  warnings?: string[];
}

/**
 * 手动拼 multipart：App 的 HTTP 服务只接受带 Content-Length 的请求，
 * 而 fetch 对 FormData 可能使用分块传输。
 */
export async function upload(to: string, pin: string, fileName: string, data: Uint8Array): Promise<UploadResult> {
  const boundary = `----shelf-pack-${Math.random().toString(36).slice(2)}`;
  const head = strToU8(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = strToU8(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);

  const { body: res } = await request(`${baseUrl(to)}/upload`, {
    method: 'POST',
    headers: { 'X-Pin': pin, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) },
    body,
  });
  return res as unknown as UploadResult;
}

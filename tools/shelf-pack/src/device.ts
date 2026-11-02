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

export interface UploadResult {
  ok: boolean;
  status?: 'added' | 'updated';
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

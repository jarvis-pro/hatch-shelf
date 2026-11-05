import http from 'node:http';
import os from 'node:os';
import {
  LAN_PORT,
  PROTOCOL_VERSION,
  WATCH_MS,
  type AudioManifest,
  type DeviceBook,
  type PingResponse,
  type SessionLog,
  type SessionRequest,
} from '@shelf/spec';

/**
 * 连手机（README 第 5.2 节）：手机在接收模式下开着 HTTP 服务，Dock 是客户端。
 * 不用手填 IP：先试上次连上的地址，不行再扫描本机所在的 /24 网段，找回应 /ping 的书巢。
 */

export type FindResult =
  | { status: 'online'; addr: string; device: string }
  /** 网段里有书巢在接收，但都不认这个密钥（手机上取消了配对，或换了一台手机） */
  | { status: 'unpaired'; addr: string }
  /** 手机上的 App 太旧，协议对不上 */
  | { status: 'outdated'; addr: string }
  /** 没找到：手机没打开接收，或不在同一个局域网 */
  | { status: 'offline' };

export class PhoneError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const PING_TIMEOUT = 900;

async function getJson(url: string, key: string | null, timeout: number) {
  const res = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeout) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function ping(addr: string): Promise<PingResponse | null> {
  try {
    const { body } = await getJson(`http://${addr}:${LAN_PORT}/ping`, null, PING_TIMEOUT);
    return body.app === 'shelf' ? (body as unknown as PingResponse) : null;
  } catch {
    return null;
  }
}

/** 本机各网卡所在的 /24 网段里的所有地址（不含本机） */
function candidates(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const prefix = a.address.split('.').slice(0, 3).join('.');
      for (let i = 1; i < 255; i++) {
        const ip = `${prefix}.${i}`;
        if (ip !== a.address && !out.includes(ip)) out.push(ip);
      }
    }
  }
  return out;
}

/** 本机的局域网地址，扫码弹窗里显示「正在扫描 x.x.x.0/24」用 */
export function subnets(): string[] {
  return [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flatMap((l) => l ?? [])
        .filter((a) => a.family === 'IPv4' && !a.internal)
        .map((a) => `${a.address.split('.').slice(0, 3).join('.')}.0/24`),
    ),
  ];
}

async function check(addr: string, key: string, p: PingResponse): Promise<FindResult> {
  if (p.protocol !== PROTOCOL_VERSION) return { status: 'outdated', addr };
  try {
    const { status, body } = await getJson(`http://${addr}:${LAN_PORT}/hello`, key, 3000);
    if (status === 401) return { status: 'unpaired', addr };
    return { status: 'online', addr, device: String(body.device ?? 'iPhone') };
  } catch {
    return { status: 'offline' };
  }
}

/** 找手机：hint 是上次连上的地址；模拟器上运行的 App 在本机，也试一下 127.0.0.1 */
export async function findPhone(key: string, hint?: string | null): Promise<FindResult> {
  for (const addr of [hint, '127.0.0.1'].filter((a): a is string => !!a)) {
    const p = await ping(addr);
    if (p) {
      const r = await check(addr, key, p);
      if (r.status === 'online') return r;
    }
  }
  const all = candidates();
  let found: FindResult = { status: 'offline' };
  // 并发扫描：一批 64 个，每个最多等 PING_TIMEOUT
  for (let i = 0; i < all.length; i += 64) {
    const batch = await Promise.all(all.slice(i, i + 64).map(async (addr) => ({ addr, p: await ping(addr) })));
    for (const { addr, p } of batch) {
      if (!p) continue;
      const r = await check(addr, key, p);
      if (r.status === 'online') return r;
      if (found.status === 'offline') found = r;
    }
  }
  return found;
}

/** 已经连上的手机 */
export class Phone {
  constructor(
    readonly addr: string,
    private readonly key: string,
  ) {}

  private url(p: string) {
    return `http://${this.addr}:${LAN_PORT}${p}`;
  }

  private async get<T>(p: string, field: string, timeout = 30_000): Promise<T> {
    let r;
    try {
      r = await getJson(this.url(p), this.key, timeout);
    } catch {
      throw new PhoneError('连不上手机：手机上的接收是否还开着？');
    }
    if (!r.body.ok) throw new PhoneError(String(r.body.error ?? '请求失败'), r.status);
    return r.body[field] as T;
  }

  private async post(p: string, data: unknown, signal?: AbortSignal) {
    const body = Buffer.from(JSON.stringify(data));
    const res = await send(this.url(p), this.key, 'application/json', body, { signal });
    if (!res.body.ok) throw new PhoneError(String(res.body.error ?? '请求失败'), res.status);
    return res.body;
  }

  books = () => this.get<DeviceBook[]>('/books', 'books');
  audio = (id: string) => this.get<AudioManifest | null>(`/audio/${id}`, 'manifest');
  notes = () => this.get<{ id: string; title: string; count: number; markdown: string }[]>('/notes', 'notes');
  backup = () => this.get<{ exportedAt: number; progress: { book_id: string }[]; highlights: unknown[] }>('/backup', 'backup');

  /** 请求推送，挂起直到手机上点了「开始接收」或「拒绝」 */
  async request(req: SessionRequest, signal: AbortSignal): Promise<boolean> {
    const body = await this.post('/session/request', req, signal);
    return body.accepted === true;
  }
  log = (log: SessionLog) => this.post('/session/log', log).catch(() => undefined);
  end = () => this.post('/session/end', {}).catch(() => undefined);
  /**
   * 挂着等手机结束接收：手机结束时立即返回 false，WATCH_MS 内没变化返回 true。
   * 连接断了（手机被挂起、网络掉了）也当作结束；signal 是网页那头断开时取消
   */
  async watch(signal: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(this.url('/watch'), {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(WATCH_MS + 10_000)]),
      });
      const body = (await res.json()) as { ok?: boolean; receiving?: boolean };
      return body.ok === true && body.receiving === true;
    } catch {
      return false;
    }
  }

  /** 断开连接：手机结束接收模式。手机已经关了接收也算断开 */
  bye = () => this.post('/bye', {}).catch(() => undefined);

  /** 上传一个包；onProgress 报告已发出的比例 */
  async upload(fileName: string, data: Uint8Array, onProgress: (ratio: number) => void, signal: AbortSignal) {
    // 手动拼 multipart：App 的 HTTP 服务只接受带 Content-Length 的请求
    const boundary = `----shelf-dock-${Math.random().toString(36).slice(2)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await send(this.url('/upload'), this.key, `multipart/form-data; boundary=${boundary}`, body, { onProgress, signal });
    return res.body as { ok: boolean; status?: 'added' | 'updated' | 'audio'; error?: string; warnings?: string[] };
  }
}

/** 用 node:http 发 POST：要固定的 Content-Length，还要知道发出去了多少 */
function send(
  url: string,
  key: string,
  type: string,
  body: Buffer,
  opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal },
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': type, 'Content-Length': body.length }, signal: opts.signal },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          } catch {
            /* 不是 JSON 时按失败处理 */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', (e) => reject(opts.signal?.aborted ? e : new PhoneError('连不上手机：手机上的接收是否还开着？')));
    const CHUNK = 256 * 1024;
    let sent = 0;
    const write = () => {
      while (sent < body.length) {
        const next = body.subarray(sent, sent + CHUNK);
        sent += next.length;
        opts.onProgress?.(sent / body.length);
        if (!req.write(next)) return void req.once('drain', write);
      }
      req.end();
    };
    write();
  });
}

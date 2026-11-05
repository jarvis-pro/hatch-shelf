import type { Job, LibraryResponse, PhoneState } from '../../shared/types';

/** 浏览器里记住的东西：书库路径、配对密钥、手机地址都只在 localStorage，服务端不落盘 */
const KEYS = { library: 'dock.library', pairKey: 'dock.pairKey', phone: 'dock.phone', view: 'dock.view' } as const;

export const saved = {
  get(k: keyof typeof KEYS): string | null {
    try {
      return localStorage.getItem(KEYS[k]);
    } catch {
      return null;
    }
  },
  set(k: keyof typeof KEYS, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(KEYS[k]);
      else localStorage.setItem(KEYS[k], v);
    } catch {
      /* 隐私模式下存不了就算了 */
    }
  },
};

/** 配对密钥：16 字节随机数，base64url */
export function newPairKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [name, k] of [
    ['X-Library', 'library'],
    ['X-Pair-Key', 'pairKey'],
    ['X-Phone', 'phone'],
  ] as const) {
    const v = saved.get(k);
    if (v) h[name] = encodeURIComponent(v);
  }
  return h;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data;
}

export const api = {
  info: () => call<{ name: string; scheme: string; subnets: string[] }>('GET', '/api/info'),
  check: (lib: string) =>
    call<{ ok: true; booksDir: string; books: number; groups: number } | { ok: false; error: string }>('GET', `/api/check?lib=${encodeURIComponent(lib)}`),
  library: () => call<LibraryResponse>('GET', '/api/library'),
  phone: () => call<PhoneState>('GET', '/api/phone'),
  push: (ids: string[]) => call<Job>('POST', '/api/push', { ids }),
  job: () => call<Job | null>('GET', '/api/job'),
  stop: () => call<unknown>('POST', '/api/job/stop', {}),
  notes: () => call<{ written: number; count: number; total: number }>('POST', '/api/notes', {}),
  backup: () => call<{ exportedAt: number; progress: unknown[]; highlights: unknown[] }>('POST', '/api/backup', {}),
};

export const coverUrl = (id: string, mtime: number) => `/api/cover?id=${encodeURIComponent(id)}&v=${Math.round(mtime)}`;
export const qrUrl = (text: string) => `/api/qr?text=${encodeURIComponent(text)}`;

export const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

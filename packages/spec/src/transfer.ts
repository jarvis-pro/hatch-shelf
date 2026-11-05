/**
 * 电脑（Dock）与手机之间的局域网协议（README 第 5.2 节）。手机做服务端，Dock 做客户端；
 * 两端共用这里的常量、配对链接和请求 / 响应类型。
 */

export const LAN_PORT = 8080;
/** 协议版本：/ping 返回，Dock 据此判断手机上的 App 是否需要更新 */
export const PROTOCOL_VERSION = 2;

/** 配对密钥：Dock 生成的随机串（base64url），扫码后两边长期保存 */
export const PAIR_KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;
const MAX_PEER_NAME = 40;

export interface Pairing {
  key: string;
  /** 电脑的名字，显示在手机的接收页和已配对列表里 */
  name: string;
}

/** 二维码里的链接：`shelf://pair?k=<key>&name=<电脑名>`，开发版的 scheme 是 shelf-dev */
export function pairUrl(scheme: string, p: Pairing) {
  return `${scheme}://pair?k=${p.key}&name=${encodeURIComponent(p.name)}`;
}

/** 解析扫码打开 App 时带来的参数；密钥不合法时返回 null */
export function parsePairing(params: { k?: unknown; name?: unknown }): Pairing | null {
  const key = typeof params.k === 'string' ? params.k : '';
  if (!PAIR_KEY_RE.test(key)) return null;
  const raw = typeof params.name === 'string' ? params.name.replace(/[\u0000-\u001f]/g, '').trim() : '';
  return { key, name: raw.slice(0, MAX_PEER_NAME) || '电脑' };
}

/** 请求头 `Authorization: Bearer <key>` 里的密钥 */
export function bearerKey(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m && PAIR_KEY_RE.test(m[1]) ? m[1] : null;
}

/** GET /ping：不需要密钥，Dock 扫描网段时用它认出书巢 */
export interface PingResponse {
  ok: true;
  app: 'shelf';
  protocol: number;
}

/** GET /hello：校验密钥，返回手机的名字 */
export interface HelloResponse {
  ok: true;
  device: string;
}

/**
 * GET /watch：Dock 连上后一直挂着的请求，手机结束接收时立即返回 `receiving: false`，
 * 否则 WATCH_MS 后返回 `receiving: true`，Dock 再挂下一次。这样手机上点「结束」后 Dock 马上知道
 */
export interface WatchResponse {
  ok: true;
  receiving: boolean;
}

/** /watch 最长挂多久 */
export const WATCH_MS = 25_000;

/** GET /books 的一项 */
export interface DeviceBook {
  id: string;
  title: string;
  updated: string | null;
  /** 设备上这本书的内容指纹；旧版 App 导入的书没有 */
  hash?: string | null;
}

/** 推送请求里的一本书 */
export interface SessionItem {
  id: string;
  title: string;
  /** new 新书 / update 书有变化 / audio 只补原声 */
  kind: 'new' | 'update' | 'audio';
  /** 如「12 章」「内容有更新 · 补 4 章原声」，接收页上显示 */
  detail: string;
  /** 这次要推的原声章数（按章一个包），接收页据此显示「第几 / 共几章」 */
  audioChapters?: number;
  /** 这本书这次要传的总字节数（书的包 + 原声），接收页据此把整本书算成一条进度 */
  bytes?: number;
  /** 书的章数和书库里录好的原声章数，确认框里显示 */
  chapters?: number;
  hasAudio?: boolean;
  /** 确认框里显示简介、分类；手机上还没有这本书时也用来画文字封面 */
  subtitle?: string;
  category?: string;
  /** 封面缩略图 `data:image/jpeg;base64,…`，不超过 COVER_THUMB_MAX；没有时画文字封面 */
  cover?: string;
}

/** 推送请求里单张封面缩略图 data URI 的长度上限 */
export const COVER_THUMB_MAX = 64 * 1024;

const optString = (v: unknown) => v === undefined || typeof v === 'string';
const isThumb = (v: unknown) =>
  v === undefined || (typeof v === 'string' && v.length <= COVER_THUMB_MAX && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v));

/**
 * POST /session/request：Dock 每次推送前先问手机。请求会一直挂着，等手机上点「开始接收」或「拒绝」后才返回
 * `{ ok: true, accepted }`；已经在接收中时返回 409。接受后才能 /upload，推送完发 /session/end
 */
export interface SessionRequest {
  items: SessionItem[];
  /** 预计传输的字节数 */
  bytes: number;
}

/** POST /session/log：Dock 做了不经过 /upload 的事（拉笔记、备份），接收页记一行 */
export interface SessionLog {
  kind: 'notes' | 'backup';
  /** 如「11 条高亮 · 3 本书」 */
  detail: string;
}

const KINDS = new Set(['new', 'update', 'audio']);

export function isSessionRequest(v: unknown): v is SessionRequest {
  const r = v as SessionRequest;
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray(r.items) &&
    r.items.length > 0 &&
    typeof r.bytes === 'number' &&
    r.items.every(
      (i) =>
        typeof i?.id === 'string' &&
        typeof i.title === 'string' &&
        KINDS.has(i.kind) &&
        typeof i.detail === 'string' &&
        (i.audioChapters === undefined || typeof i.audioChapters === 'number') &&
        (i.bytes === undefined || typeof i.bytes === 'number') &&
        (i.chapters === undefined || typeof i.chapters === 'number') &&
        (i.hasAudio === undefined || typeof i.hasAudio === 'boolean') &&
        optString(i.subtitle) &&
        optString(i.category) &&
        isThumb(i.cover),
    )
  );
}

export function isSessionLog(v: unknown): v is SessionLog {
  const l = v as SessionLog;
  return typeof v === 'object' && v !== null && (l.kind === 'notes' || l.kind === 'backup') && typeof l.detail === 'string';
}

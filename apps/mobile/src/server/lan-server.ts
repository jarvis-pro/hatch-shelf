import {
  bearerKey,
  isSessionLog,
  isSessionRequest,
  LAN_PORT,
  MAX_PACKAGE_BYTES,
  PROTOCOL_VERSION,
  SLUG_RE,
  type DeviceBook,
  type SessionLog,
  type SessionRequest,
} from '@shelf/spec';
import { Directory, File, Paths } from 'expo-file-system';
import { strToU8 } from 'fflate';
import TcpSocket from 'react-native-tcp-socket';
import { exportBackup } from '@/backup/store';
import { getBook, listBooks } from '@/db/queries';
import { importFile, type ImportResult } from '@/import/pipeline';
import { loadAudioManifest } from '@/library/audio';
import { bookNotesMarkdown, listNotesSummary } from '@/notes/store';
import {
  CONTINUE_RESPONSE,
  jsonResponse,
  parseMultipart,
  peekMultipartFilename,
  RequestParser,
  textOf,
  type HttpRequest,
} from './http';

export { LAN_PORT };

/** 正在等手机确认或已确认的那次推送；放在服务外面，回到前台重新监听时不丢 */
export interface LanSession {
  key: string;
  accepted: boolean;
}

export interface LanServerEvents {
  session: { get(): LanSession | null; set(s: LanSession | null): void };
  /** 这个密钥是否属于已配对的电脑 */
  isPaired(key: string): boolean;
  /** 已配对的电脑发来任何请求（用来重置空闲计时） */
  onActivity(key: string): void;
  /** Dock 请求推送：返回 true 表示手机上点了「开始接收」；Dock 中途断开时 cancelled 被调用 */
  onSessionRequest(key: string, request: SessionRequest, cancelled: Promise<void>): Promise<boolean>;
  onSessionLog(log: SessionLog): void;
  onSessionEnd(): void;
  /**
   * 上传中的进度（ratio 0–1，到 1 后进入导入）和上传的文件名（收到文件字段的头部后才有）；
   * 同一个连接用同一个 key，结束时传 null
   */
  onReceiving(key: number, upload: ReceivingUpload | null): void;
  onUpload(result: ImportResult): void;
  onError(message: string): void;
}

export interface ReceivingUpload {
  ratio: number;
  name?: string;
}

export interface LanServer {
  stop(): void;
}

/** multipart 头和其他字段的余量 */
const MAX_BODY_BYTES = MAX_PACKAGE_BYTES + 1024 * 1024;

const uploadDir = new Directory(Paths.cache, 'lan-upload');

const AUTH_ERROR = jsonResponse(401, { ok: false, error: '这台电脑还没有和手机配对，请重新扫码' });

/**
 * 接收模式的 HTTP 服务（README 第 5.2 节），协议定义在 @shelf/spec 的 transfer.ts。
 * 除 /ping 外都要带配对密钥 `Authorization: Bearer <key>`；/upload 只在手机确认了一次推送之后才接受。
 *
 * GET  /ping             认出书巢（不需要密钥）
 * GET  /hello            校验密钥，返回手机名字
 * GET  /books            手机上的书和内容指纹
 * GET  /audio/<id>       这本书的原声清单
 * GET  /notes            每本有高亮的书导出的笔记 Markdown
 * GET  /backup           阅读数据备份 JSON
 * POST /session/request  请求推送，挂起直到手机确认或拒绝
 * POST /session/log      记一行（拉了笔记、做了备份）
 * POST /session/end      这次推送结束
 * POST /upload           multipart/form-data，字段 file
 */
export function startLanServer(events: LanServerEvents): LanServer {
  let stopped = false;
  // 导入串行执行，避免两个上传同时写同一本书
  let queue: Promise<unknown> = Promise.resolve();

  async function handle(req: HttpRequest, closed: Promise<void>): Promise<Uint8Array> {
    if (req.method === 'GET' && req.path === '/ping') {
      return jsonResponse(200, { ok: true, app: 'shelf', protocol: PROTOCOL_VERSION });
    }

    const key = bearerKey(req.headers.authorization);
    if (!key || !events.isPaired(key)) return AUTH_ERROR;
    events.onActivity(key);

    if (req.method === 'GET' && req.path === '/hello') {
      return jsonResponse(200, { ok: true, device: 'iPhone' });
    }

    if (req.method === 'GET' && req.path.startsWith('/audio/')) {
      const id = req.path.slice('/audio/'.length);
      const manifest = SLUG_RE.test(id) ? await loadAudioManifest(id) : null;
      return jsonResponse(200, { ok: true, manifest });
    }

    if (req.method === 'GET' && req.path === '/books') {
      const books: DeviceBook[] = (await listBooks()).map((b) => ({ id: b.id, title: b.title, updated: b.updatedAt, hash: b.contentHash }));
      return jsonResponse(200, { ok: true, books });
    }

    if (req.method === 'GET' && req.path === '/notes') {
      const notes = [];
      for (const { bookId } of await listNotesSummary()) {
        const n = await bookNotesMarkdown(bookId);
        if (n) notes.push({ id: bookId, ...n });
      }
      return jsonResponse(200, { ok: true, notes });
    }

    if (req.method === 'GET' && req.path === '/backup') {
      return jsonResponse(200, { ok: true, backup: await exportBackup() });
    }

    const session = events.session.get();
    if (req.method === 'POST' && req.path === '/session/request') {
      const body = parseJson(req.body);
      if (!isSessionRequest(body)) return jsonResponse(400, { ok: false, error: '推送请求格式不对' });
      // 同一台电脑上一次推送没收尾（Dock 被关掉）时，新的请求直接接替它
      if (session?.key === key && session.accepted) events.onSessionEnd();
      else if (session) return jsonResponse(409, { ok: false, error: '手机正在接收另一次推送' });
      events.session.set({ key, accepted: false });
      const accepted = await events.onSessionRequest(key, body, closed).catch(() => false);
      if (stopped) return jsonResponse(503, { ok: false, error: '手机已结束接收' });
      events.session.set(accepted ? { key, accepted: true } : null);
      return jsonResponse(200, { ok: true, accepted });
    }

    if (req.method === 'POST' && req.path === '/session/log') {
      const body = parseJson(req.body);
      if (!isSessionLog(body)) return jsonResponse(400, { ok: false, error: '格式不对' });
      events.onSessionLog(body);
      return jsonResponse(200, { ok: true });
    }

    if (req.method === 'POST' && req.path === '/session/end') {
      if (session?.key === key) {
        events.session.set(null);
        events.onSessionEnd();
      }
      return jsonResponse(200, { ok: true });
    }

    if (req.method === 'POST' && req.path === '/upload') {
      if (session?.key !== key || !session.accepted) return jsonResponse(409, { ok: false, error: '请先在手机上确认这次推送' });
      const parts = parseMultipart(req.body, req.headers['content-type']);
      if (!parts) return jsonResponse(400, { ok: false, error: '请使用 multipart/form-data 上传' });
      const file = parts.find((p) => p.name === 'file' && p.filename);
      if (!file) return jsonResponse(400, { ok: false, error: '缺少 file 字段' });

      const task = queue.then(() => importUpload(file.filename!, file.data));
      queue = task.catch(() => undefined);
      const result = await task;
      events.onUpload(result);
      if (!result.ok) return jsonResponse(422, { ok: false, error: result.error });
      if (result.status === 'audio') {
        return jsonResponse(200, { ok: true, bookId: result.bookId, status: 'audio', title: result.title, chapters: result.chapters, total: result.total });
      }
      const book = await getBook(result.bookId);
      return jsonResponse(200, {
        ok: true,
        bookId: result.bookId,
        status: result.status,
        title: result.title,
        chapters: book?.chapterCount ?? 0,
        warnings: result.warnings,
      });
    }

    return jsonResponse(404, { ok: false, error: '没有这个接口' });
  }

  let connections = 0;
  const server = TcpSocket.createServer((socket) => {
    const parser = new RequestParser(MAX_BODY_BYTES);
    const key = ++connections;
    let done = false;
    let reported = -1;
    let name: string | undefined;
    let onClosed = () => {};
    const closed = new Promise<void>((resolve) => (onClosed = resolve));
    const reply = (bytes: Uint8Array) => {
      if (done) return;
      done = true;
      if (reported >= 0) events.onReceiving(key, null);
      socket.end(bytes);
    };
    /** 每 5% 报一次上传进度；认出文件名时也报一次 */
    const report = () => {
      const p = parser.progress;
      if (!p || p.method !== 'POST' || p.path !== '/upload' || p.total === 0) return;
      const found = name === undefined && (name = peekMultipartFilename(p.body.subarray(0, 16 * 1024), p.headers['content-type']));
      const ratio = Math.floor((p.received / p.total) * 20) / 20;
      if (ratio === reported && !found) return;
      reported = ratio;
      events.onReceiving(key, { ratio, name });
    };

    socket.on('data', (chunk) => {
      if (done) return;
      const bytes = typeof chunk === 'string' ? strToU8(chunk) : new Uint8Array(chunk);
      const r = parser.push(bytes);
      report();
      if (r.type === 'continue') socket.write(CONTINUE_RESPONSE);
      else if (r.type === 'error') reply(jsonResponse(r.status, { ok: false, error: r.message }));
      else if (r.type === 'complete') {
        handle(r.request, closed).then(reply, (e: Error) => reply(jsonResponse(500, { ok: false, error: e.message })));
      }
    });
    socket.on('error', () => socket.destroy());
    // 电脑中途断开时清掉进度；挂着的推送请求也随之取消
    socket.on('close', () => {
      onClosed();
      if (!done && reported >= 0) events.onReceiving(key, null);
      done = true;
    });
  });

  server.on('error', (e) => events.onError(e.message));
  server.listen({ port: LAN_PORT, host: '0.0.0.0', reuseAddress: true });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      server.close();
    },
  };
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(textOf(body));
  } catch {
    return null;
  }
}

/** 把上传内容落成临时文件，交给统一的导入管线 */
async function importUpload(filename: string, data: Uint8Array): Promise<ImportResult> {
  // 只取文件名部分；保留原名是因为没有 book.yaml 时书的 id 和标题取自文件名
  const safeName = filename.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f]/g, '') || 'upload.zip';
  const dir = new Directory(uploadDir, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  dir.create({ intermediates: true });
  try {
    const file = new File(dir, safeName);
    file.create();
    file.writeSync(data);
    return await importFile(file.uri);
  } finally {
    if (dir.exists) dir.delete();
  }
}

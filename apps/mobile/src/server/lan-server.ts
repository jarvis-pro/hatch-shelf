import {
  bearerKey,
  isSessionLog,
  isSessionRequest,
  LAN_PORT,
  MAX_PACKAGE_BYTES,
  PROTOCOL_VERSION,
  SLUG_RE,
  WATCH_MS,
  type DeviceBook,
  type SessionLog,
  type SessionRequest,
} from '@shelf/spec';
import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { strToU8 } from 'fflate';
import TcpSocket from 'react-native-tcp-socket';
import { exportBackup } from '@/backup/store';
import { getBook, listBooks } from '@/db/queries';
import { importFile, type ImportResult } from '@/import/pipeline';
import { loadAudioManifest } from '@/library/audio';
import { bookNotesMarkdown, listNotesSummary } from '@/notes/store';
import {
  base64ByteLength,
  base64ToBytes,
  CONTINUE_RESPONSE,
  jsonResponse,
  locateMultipartFile,
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
  /** Dock 上点了「断开连接」：删掉这台电脑的配对，结束接收模式 */
  onBye(key: string): void;
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
  /** 这次上传的总字节数（Content-Length） */
  total: number;
}

export interface LanServer {
  stop(): void;
}

/** multipart 头和其他字段的余量 */
const MAX_BODY_BYTES = MAX_PACKAGE_BYTES + 1024 * 1024;

const uploadDir = new Directory(Paths.cache, 'lan-upload');

/**
 * 告诉 Dock 的手机名字。iOS 16 起读用户起的名字（「某某的 iPhone」）要 Apple 审批的权限，
 * 拿不到时 deviceName 只是「iPhone」，这时用机型名（如「iPhone 16 Pro」）
 */
function deviceName() {
  // 直接读 expo-device 的原生常量：还没按新依赖重新构建的 dev client 里没有这个模块，回退成「iPhone」而不是启动就报错
  const device = requireOptionalNativeModule<{ deviceName?: string | null; modelName?: string | null }>('ExpoDevice');
  const name = device?.deviceName?.trim();
  if (name && !/^(iPhone|iPad|iPod touch)$/i.test(name)) return name;
  return device?.modelName ?? name ?? 'iPhone';
}

const AUTH_ERROR = jsonResponse(401, { ok: false, error: '这台电脑还没有和手机配对，请重新扫码' });

/**
 * 接收模式的 HTTP 服务（README 第 5.2 节），协议定义在 @shelf/spec 的 transfer.ts。
 * 除 /ping 外都要带配对密钥 `Authorization: Bearer <key>`；/upload 只在手机确认了一次推送之后才接受。
 *
 * GET  /ping             认出书巢（不需要密钥）
 * GET  /hello            校验密钥，返回手机名字
 * GET  /watch            挂着直到手机结束接收（或 WATCH_MS 后），让 Dock 即时知道
 * GET  /books            手机上的书和内容指纹
 * GET  /audio/<id>       这本书的原声清单
 * GET  /notes            每本有高亮的书导出的笔记 Markdown
 * GET  /backup           阅读数据备份 JSON
 * POST /session/request  请求推送，挂起直到手机确认或拒绝
 * POST /session/log      记一行（拉了笔记、做了备份）
 * POST /session/end      这次推送结束
 * POST /bye              Dock 断开连接：手机删掉这台电脑的配对，结束接收模式
 * POST /upload           multipart/form-data，字段 file
 */
export function startLanServer(events: LanServerEvents): LanServer {
  let stopped = false;
  let onStopped = () => {};
  const stoppedSignal = new Promise<void>((resolve) => (onStopped = resolve));
  // 导入串行执行，避免两个上传同时写同一本书
  let queue: Promise<unknown> = Promise.resolve();

  async function handle(req: HttpRequest, closed: Promise<void>): Promise<Uint8Array> {
    if (req.method === 'GET' && req.path === '/ping') {
      return jsonResponse(200, { ok: true, app: 'shelf', protocol: PROTOCOL_VERSION });
    }

    const key = bearerKey(req.headers.authorization);
    if (!key || !events.isPaired(key)) return AUTH_ERROR;

    // 不算「有动作」：Dock 一直挂着它，算的话空闲 5 分钟自动结束就永远不会发生
    if (req.method === 'GET' && req.path === '/watch') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([stoppedSignal, closed, new Promise<void>((resolve) => (timer = setTimeout(resolve, WATCH_MS)))]);
      clearTimeout(timer);
      return jsonResponse(200, { ok: true, receiving: !stopped });
    }

    events.onActivity(key);

    if (req.method === 'GET' && req.path === '/hello') {
      return jsonResponse(200, { ok: true, device: deviceName() });
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

    if (req.method === 'POST' && req.path === '/bye') {
      if (session?.key === key) events.session.set(null);
      // 先回复再结束，免得 Dock 等不到响应
      setTimeout(() => events.onBye(key), 0);
      return jsonResponse(200, { ok: true });
    }

    // 带正文的上传走 receiveUpload，到这里的是空正文
    if (req.method === 'POST' && req.path === '/upload') {
      return uploadRefusal(key) ?? jsonResponse(400, { ok: false, error: '请使用 multipart/form-data 上传' });
    }

    return jsonResponse(404, { ok: false, error: '没有这个接口' });
  }

  /** 上传要先配对、再由手机确认这次推送；可以上传时返回 null */
  function uploadRefusal(key: string): Uint8Array | null {
    if (!events.isPaired(key)) return AUTH_ERROR;
    const session = events.session.get();
    if (session?.key !== key || !session.accepted) return jsonResponse(409, { ok: false, error: '请先在手机上确认这次推送' });
    return null;
  }

  /** 正文已经整个写到磁盘：取出文件字段，排队交给导入管线 */
  async function receiveUpload(req: Omit<HttpRequest, 'body'>, body: UploadBody): Promise<Uint8Array> {
    const key = bearerKey(req.headers.authorization);
    if (!key) return AUTH_ERROR;
    const refused = uploadRefusal(key);
    if (refused) return refused;
    events.onActivity(key);

    const task = queue.then(() => importUpload(body, req.headers['content-type']));
    queue = task.catch(() => undefined);
    const result = await task;
    if (!result) return jsonResponse(400, { ok: false, error: '请使用 multipart/form-data 上传，并带上 file 字段' });
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

  let connections = 0;
  const server = TcpSocket.createServer((socket) => {
    const parser = new RequestParser(MAX_BODY_BYTES, (r) => r.method === 'POST' && r.path === '/upload');
    const key = ++connections;
    let done = false;
    let reported = -1;
    let name: string | undefined;
    let upload: { request: Omit<HttpRequest, 'body'>; body: UploadBody } | null = null;
    let onClosed = () => {};
    const closed = new Promise<void>((resolve) => (onClosed = resolve));
    const reply = (bytes: Uint8Array) => {
      if (done) return;
      done = true;
      if (reported >= 0) events.onReceiving(key, null);
      socket.end(bytes);
    };
    const fail = (e: Error) => reply(jsonResponse(500, { ok: false, error: e.message }));

    /** 每 5% 报一次上传进度；认出文件名时也报一次 */
    const report = () => {
      if (!upload) return;
      const { request, body } = upload;
      const found = name === undefined && (name = peekMultipartFilename(body.head, request.headers['content-type']));
      const ratio = Math.floor((body.received / body.total) * 20) / 20;
      if (ratio === reported && !found) return;
      reported = ratio;
      events.onReceiving(key, { ratio, name, total: body.total });
    };

    const receive = (chunk: string | Uint8Array) => {
      if (done) return;
      if (upload) {
        upload.body.push(chunk);
        report();
        if (upload.body.complete) {
          // 收完就不再算「接收中」：之后多出来的字节交给已结束的解析器忽略掉，断开时也不去删正在导入的文件
          const { request, body } = upload;
          upload = null;
          receiveUpload(request, body)
            .then(reply, fail)
            .finally(() => body.dispose());
        }
        return;
      }
      const r = parser.push(typeof chunk === 'string' ? base64ToBytes(chunk) : chunk);
      if (r.type === 'continue') socket.write(CONTINUE_RESPONSE);
      else if (r.type === 'error') reply(jsonResponse(r.status, { ok: false, error: r.message }));
      else if (r.type === 'complete') handle(r.request, closed).then(reply, fail);
      else if (r.type === 'stream') {
        // 没配对或没确认推送的上传照样收完（直接回错误会让电脑那头写到一半断开、看不到原因），只是不写盘
        const authKey = bearerKey(r.request.headers.authorization);
        const body = new UploadBody(r.length, !authKey || uploadRefusal(authKey) !== null);
        upload = { request: r.request, body };
        if (r.expectContinue) socket.write(CONTINUE_RESPONSE);
        if (r.rest.length > 0 || r.length === 0) receive(r.rest);
        else report();
      }
    };

    // 正文直接拿原生发来的 base64 交给原生解码写盘；接不上内部字段时退回普通的 data 事件
    if (!onRawData(socket, receive)) socket.on('data', (chunk) => receive(typeof chunk === 'string' ? strToU8(chunk) : new Uint8Array(chunk)));
    socket.on('error', () => socket.destroy());
    // 电脑中途断开时清掉进度；挂着的推送请求也随之取消
    socket.on('close', () => {
      onClosed();
      if (!done && reported >= 0) events.onReceiving(key, null);
      if (!done) upload?.body.dispose();
      done = true;
    });
  });

  server.on('error', (e) => events.onError(e.message));
  server.listen({ port: LAN_PORT, host: '0.0.0.0', reuseAddress: true });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      // 先让挂着的 /watch 回复「结束了」，再关监听（已建立的连接不受 close 影响）
      onStopped();
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

/** react-native-tcp-socket 的 Socket 内部字段（6.x） */
interface RawSocket {
  _id: number;
  _eventEmitter: { addListener(event: 'data', listener: (evt: { id: number; data: string }) => void): { remove(): void } };
  _dataListener?: { remove(): void };
}

/**
 * 原生把每个 TCP 分片编成 base64 发给 JS，库再在 JS 里解码成 Buffer：几十 MB 的上传全在 JS 线程上解码，
 * 传输时 Tab 栏这类逐帧在 JS 里算的动画会一直掉帧。换掉库的 data 监听，直接拿 base64 字符串，
 * 正文原样交给原生解码写盘。库的内部结构对不上时返回 false
 */
function onRawData(socket: unknown, listener: (b64: string) => void): boolean {
  const raw = socket as Partial<RawSocket>;
  if (typeof raw._id !== 'number' || !raw._eventEmitter || !raw._dataListener) return false;
  const id = raw._id;
  raw._dataListener.remove();
  // 库在断开时会 remove 掉 _dataListener，换成这个之后照样能清理
  raw._dataListener = raw._eventEmitter.addListener('data', (evt) => {
    if (evt.id === id) listener(evt.data);
  });
  return true;
}

/** 正文开头留在 JS 里的部分：找文件名、定位文件字段用 */
const HEAD_BYTES = 16 * 1024;
/** 读回正文结尾的长度：要盖住结尾的 `\r\n--boundary--\r\n` */
const TAIL_BYTES = 1024;

/**
 * 一次上传的正文：分片按到达顺序追加写到临时文件（base64 由原生解码），JS 里只留开头 HEAD_BYTES。
 * discard 时只计数不写盘（这次上传反正会被拒绝）
 */
class UploadBody {
  readonly dir = new Directory(uploadDir, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  readonly file = new File(this.dir, 'body');
  head = new Uint8Array(0);
  received = 0;
  private writing: Promise<void> = Promise.resolve();
  private error: Error | null = null;

  constructor(
    readonly total: number,
    private readonly discard: boolean,
  ) {
    if (discard) return;
    this.dir.create({ intermediates: true });
    this.file.create();
  }

  get complete() {
    return this.received >= this.total;
  }

  push(chunk: string | Uint8Array) {
    this.received += typeof chunk === 'string' ? base64ByteLength(chunk) : chunk.length;
    if (this.head.length < HEAD_BYTES) {
      const need = HEAD_BYTES - this.head.length;
      // 只解开头需要的那一段：base64 每 4 个字符对应 3 个字节
      const bytes = typeof chunk === 'string' ? base64ToBytes(chunk.slice(0, Math.ceil(need / 3) * 4)) : chunk;
      const head = new Uint8Array(this.head.length + Math.min(need, bytes.length));
      head.set(this.head);
      head.set(bytes.subarray(0, need), this.head.length);
      this.head = head;
    }
    if (this.discard) return;
    // 一个接一个写，保证顺序；写失败后的分片直接丢掉，finish 时报错
    this.writing = this.writing
      .then(() => {
        if (this.error) return;
        return typeof chunk === 'string' ? this.file.write(chunk, { encoding: 'base64', append: true }) : this.file.write(chunk, { append: true });
      })
      .catch((e: Error) => {
        this.error ??= e;
      });
  }

  /** 等全部写完；写盘出错时抛出 */
  async finish() {
    await this.writing;
    if (this.error) throw this.error;
  }

  /** 删掉临时文件（等还在排队的写入结束） */
  dispose() {
    void this.writing.then(() => {
      if (this.dir.exists) this.dir.delete();
    });
  }
}

/**
 * 从写好的正文里取出文件字段，落成带原文件名的临时文件，交给统一的导入管线。
 * 正文不是 multipart 或找不到文件字段时返回 null
 */
async function importUpload(body: UploadBody, contentType: string | undefined): Promise<ImportResult | null> {
  await body.finish();
  const size = body.file.size;
  const handle = body.file.open();
  let data: Uint8Array;
  let filename: string;
  try {
    const tailOffset = Math.max(0, size - TAIL_BYTES);
    handle.offset = tailOffset;
    const tail = await handle.readBytes(size - tailOffset);
    const part = locateMultipartFile(body.head, tail, tailOffset, contentType);
    if (!part || part.name !== 'file') return null;
    handle.offset = part.start;
    data = await handle.readBytes(part.end - part.start);
    filename = part.filename;
  } finally {
    handle.close();
  }
  // 只取文件名部分；保留原名是因为没有 book.yaml 时书的 id 和标题取自文件名
  const safeName = filename.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f]/g, '') || 'upload.zip';
  const file = new File(body.dir, safeName === 'body' ? 'body.zip' : safeName);
  file.create();
  await file.write(data);
  return importFile(file.uri);
}

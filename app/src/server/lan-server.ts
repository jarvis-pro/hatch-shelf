import { MAX_PACKAGE_BYTES } from '@shelf/spec';
import { Directory, File, Paths } from 'expo-file-system';
import { strToU8 } from 'fflate';
import TcpSocket from 'react-native-tcp-socket';
import { listBooks } from '@/db/queries';
import { importFile, type ImportResult } from '@/import/pipeline';
import {
  buildResponse,
  CONTINUE_RESPONSE,
  jsonResponse,
  parseMultipart,
  RequestParser,
  textOf,
  type HttpRequest,
} from './http';
import { UPLOAD_PAGE } from './upload-page';

export const LAN_PORT = 8080;
export const MAX_PIN_FAILURES = 5;

export interface LanServerEvents {
  onListening(): void;
  /** 上传中的进度（0–1）；同一个连接用同一个 key，结束时传 null */
  onReceiving?(key: number, ratio: number | null): void;
  onUpload(result: ImportResult): void;
  /** PIN 连续错误达到上限，服务已自动关闭 */
  onLocked(): void;
  onError(message: string): void;
}

export interface LanServer {
  stop(): void;
}

/** multipart 头和其他字段的余量 */
const MAX_BODY_BYTES = MAX_PACKAGE_BYTES + 1024 * 1024;

const uploadDir = new Directory(Paths.cache, 'lan-upload');

/**
 * 传书页面的 HTTP 服务（README 第 5.2 节）。只在传书页面可见时运行。
 *
 * GET  /        上传页面
 * POST /upload  multipart/form-data，字段 file；PIN 放在 X-Pin 请求头或表单字段 pin
 * GET  /books   本地已有书籍（需要 X-Pin）
 */
export function startLanServer(pin: string, events: LanServerEvents): LanServer {
  let failures = 0;
  let stopped = false;
  // 导入串行执行，避免两个上传同时写同一本书
  let queue: Promise<unknown> = Promise.resolve();

  /** 校验 PIN；错误次数达到上限时关闭服务 */
  const checkPin = (given: string | undefined) => {
    if (given === pin) {
      failures = 0;
      return true;
    }
    failures += 1;
    if (failures >= MAX_PIN_FAILURES) {
      setTimeout(() => {
        stop();
        events.onLocked();
      }, 100);
    }
    return false;
  };

  const pinError = () =>
    jsonResponse(failures >= MAX_PIN_FAILURES ? 403 : 401, {
      ok: false,
      error: failures >= MAX_PIN_FAILURES ? 'PIN 错误次数过多，本次服务已关闭' : 'PIN 错误',
    });

  async function handle(req: HttpRequest): Promise<Uint8Array> {
    if (req.method === 'GET' && req.path === '/') {
      return buildResponse(200, 'text/html; charset=utf-8', UPLOAD_PAGE);
    }

    if (req.method === 'GET' && req.path === '/books') {
      if (!checkPin(req.headers['x-pin'])) return pinError();
      const books = await listBooks();
      return jsonResponse(200, {
        ok: true,
        books: books.map((b) => ({ id: b.id, title: b.title, updated: b.updatedAt, hash: b.contentHash })),
      });
    }

    if (req.method === 'POST' && req.path === '/upload') {
      const parts = parseMultipart(req.body, req.headers['content-type']);
      if (!parts) return jsonResponse(400, { ok: false, error: '请使用 multipart/form-data 上传' });
      const formPin = parts.find((p) => p.name === 'pin' && p.filename === undefined);
      if (!checkPin(req.headers['x-pin'] ?? (formPin && textOf(formPin.data)))) return pinError();

      const file = parts.find((p) => p.name === 'file' && p.filename);
      if (!file) return jsonResponse(400, { ok: false, error: '缺少 file 字段' });

      const task = queue.then(() => importUpload(file.filename!, file.data));
      queue = task.catch(() => undefined);
      const result = await task;
      events.onUpload(result);
      return result.ok
        ? jsonResponse(200, { ok: true, bookId: result.bookId, status: result.status, warnings: result.warnings })
        : jsonResponse(422, { ok: false, error: result.error });
    }

    if (['/', '/books', '/upload'].includes(req.path)) {
      return jsonResponse(405, { ok: false, error: '不支持的请求方法' });
    }
    return jsonResponse(404, { ok: false, error: '没有这个接口' });
  }

  let connections = 0;
  const server = TcpSocket.createServer((socket) => {
    const parser = new RequestParser(MAX_BODY_BYTES);
    const key = ++connections;
    let done = false;
    let reported = -1;
    const reply = (bytes: Uint8Array) => {
      done = true;
      if (reported >= 0) events.onReceiving?.(key, null);
      socket.end(bytes);
    };
    /** 每 5% 报一次上传进度 */
    const report = () => {
      const p = parser.progress;
      if (!p || p.method !== 'POST' || p.path !== '/upload' || p.total === 0) return;
      const ratio = Math.floor((p.received / p.total) * 20) / 20;
      if (ratio === reported) return;
      reported = ratio;
      events.onReceiving?.(key, ratio);
    };

    socket.on('data', (chunk) => {
      if (done) return;
      const bytes = typeof chunk === 'string' ? strToU8(chunk) : new Uint8Array(chunk);
      const r = parser.push(bytes);
      report();
      if (r.type === 'continue') socket.write(CONTINUE_RESPONSE);
      else if (r.type === 'error') reply(jsonResponse(r.status, { ok: false, error: r.message }));
      else if (r.type === 'complete') {
        handle(r.request).then(reply, (e: Error) => reply(jsonResponse(500, { ok: false, error: e.message })));
      }
    });
    socket.on('error', () => socket.destroy());
    // 浏览器中途断开时也要清掉进度
    socket.on('close', () => {
      if (!done && reported >= 0) events.onReceiving?.(key, null);
    });
  });

  server.on('error', (e) => events.onError(e.message));
  server.listen({ port: LAN_PORT, host: '0.0.0.0', reuseAddress: true }, () => events.onListening());

  function stop() {
    if (stopped) return;
    stopped = true;
    server.close();
  }
  return { stop };
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

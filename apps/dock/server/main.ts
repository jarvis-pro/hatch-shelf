import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PAIR_KEY_RE } from '@shelf/spec';
import QRCode from 'qrcode';
import type { LibraryResponse } from '../shared/types';
import { DOCK_PORT } from './config';
import { bookDirOf, booksDirOf, expandHome, scanLibrary, type LibEntry } from './library';
import { subnets } from './phone';
import { backup, currentJob, phoneState, pullNotes, startPush, stopJob } from './sync';

/**
 * Dock 的本地服务（README 第 5.2 节）：只监听 127.0.0.1，提供网页和 /api。
 * 书库路径、配对密钥、手机地址都存在浏览器的 localStorage 里，每个请求通过请求头带过来，服务端不落盘。
 */

const dev = process.argv.includes('--dev');
const dist = path.resolve(import.meta.dirname, '../dist');
/** 开发版 App 的 URL scheme 是 shelf-dev：`SHELF_APP=dev pnpm dock` 时二维码换成它 */
const scheme = process.env.SHELF_APP === 'dev' ? 'shelf-dev' : 'shelf';

function computerName() {
  try {
    if (process.platform === 'darwin') return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim();
  } catch {
    /* 退回主机名 */
  }
  return os.hostname().replace(/\.local$/, '');
}
const name = computerName();

/** 只有 macOS 能弹系统的选择文件夹对话框；其他平台网页上改为手填路径 */
const canPick = process.platform === 'darwin';

const PICK_SCRIPT = [
  'on run argv',
  'try',
  'set p to choose folder with prompt "选择书库文件夹（hatch-shelf-library 或其中的 books）" default location (POSIX file (item 1 of argv))',
  'on error number -128',
  'return ""',
  'end try',
  'return POSIX path of p',
  'end run',
];

/**
 * 浏览器拿不到文件夹的真实路径（showDirectoryPicker 只给句柄），所以由本机服务弹系统对话框。
 * 用户取消时返回 null
 */
function pickFolder(from: string | null): Promise<string | null> {
  const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
  const start = from && isDir(expandHome(from)) ? expandHome(from) : path.join(os.homedir(), 'Documents');
  return new Promise((resolve, reject) => {
    execFile('osascript', [...PICK_SCRIPT.flatMap((l) => ['-e', l]), start], { timeout: 10 * 60_000 }, (err, stdout) => {
      if (err) return reject(new Error(`打不开选择文件夹的对话框：${err.message}`));
      const picked = stdout.trim().replace(/\/$/, '');
      resolve(picked || null);
    });
  });
}

/** 只认本机地址：防止别的网页通过 DNS 重绑定借浏览器调用这里的接口 */
const allowedHosts = new Set([DOCK_PORT, DOCK_PORT + 1].flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

const header = (req: http.IncomingMessage, name: string) => {
  const v = req.headers[name];
  return typeof v === 'string' && v ? decodeURIComponent(v) : null;
};

function library(req: http.IncomingMessage): { booksDir: string; entries: LibEntry[] } {
  const lib = header(req, 'x-library');
  if (!lib) throw new HttpError(400, '还没有填书库路径');
  try {
    return scanLibrary(lib);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

function pairKey(req: http.IncomingMessage) {
  const key = header(req, 'x-pair-key');
  if (!key || !PAIR_KEY_RE.test(key)) throw new HttpError(400, '还没有连接手机');
  return key;
}

function phoneAddr(req: http.IncomingMessage) {
  const addr = header(req, 'x-phone');
  if (!addr || !/^[\d.]+$/.test(addr)) throw new HttpError(409, '手机没有连上');
  return addr;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '请求体不是 JSON');
  }
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/info':
      return json(res, 200, { name, scheme, subnets: subnets(), home: os.homedir(), canPick });

    case 'GET /api/library': {
      const { booksDir, entries } = library(req);
      const body: LibraryResponse = { booksDir, books: entries.map((e) => e.info) };
      return json(res, 200, body);
    }

    case 'GET /api/cover': {
      // 只给最近一次扫描过的书：页面总是先拿书单再显示封面
      const id = url.searchParams.get('id');
      const dir = id && bookDirOf(id);
      const file = dir && path.join(dir, 'cover.png');
      if (!file || !existsSync(file)) throw new HttpError(404, '没有封面');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(file));
    }

    case 'GET /api/phone': {
      const { entries } = library(req);
      const { state } = await phoneState(entries, pairKey(req), header(req, 'x-phone'));
      return json(res, 200, state);
    }

    case 'POST /api/push': {
      const body = (await readBody(req)) as { ids?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
      if (ids.length === 0) throw new HttpError(400, '没有选书');
      try {
        return json(res, 200, await startPush(library(req).entries, pairKey(req), phoneAddr(req), ids));
      } catch (e) {
        throw e instanceof HttpError ? e : new HttpError(409, (e as Error).message);
      }
    }

    case 'GET /api/job':
      return json(res, 200, currentJob());

    case 'POST /api/job/stop':
      stopJob();
      return json(res, 200, { ok: true });

    case 'POST /api/notes':
      return json(res, 200, await pullNotes(library(req).entries, pairKey(req), phoneAddr(req)));

    case 'POST /api/backup':
      return json(res, 200, await backup(pairKey(req), phoneAddr(req)));

    case 'POST /api/pick-folder': {
      if (!canPick) throw new HttpError(501, '这个系统上不能弹出选择文件夹的对话框，请手动填写路径');
      const body = (await readBody(req)) as { from?: unknown };
      const picked = await pickFolder(typeof body.from === 'string' ? body.from : null);
      return json(res, 200, { path: picked });
    }

    case 'GET /api/qr': {
      const text = url.searchParams.get('text') ?? '';
      const svg = await QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111318', light: '#0000' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }

    case 'GET /api/check': {
      // 首次填路径时实时检查：能不能找到书
      const lib = url.searchParams.get('lib') ?? '';
      try {
        const booksDir = booksDirOf(lib);
        const { entries } = scanLibrary(lib);
        const groups = new Set(entries.map((e) => e.info.group)).size;
        return json(res, 200, { ok: true, booksDir, books: entries.length, groups });
      } catch (e) {
        return json(res, 200, { ok: false, error: (e as Error).message });
      }
    }
  }
  throw new HttpError(404, '没有这个接口');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveStatic(res: http.ServerResponse, pathname: string) {
  if (!existsSync(dist)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('网页还没有构建：在仓库根目录运行 pnpm dock');
  }
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || rel === '/' || rel === '.') file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

const server = http.createServer((req, res) => {
  if (!allowedHosts.has(req.headers.host ?? '')) {
    res.writeHead(403);
    return res.end();
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  const origin = req.headers.origin;
  if (req.method !== 'GET' && (!origin || !allowedOrigins.has(origin))) return json(res, 403, { error: '只接受来自 Dock 页面的请求' });
  api(req, res, url).catch((e: Error) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    json(res, status, { error: e.message });
  });
});

server.listen(DOCK_PORT, '127.0.0.1', () => {
  const url = `http://localhost:${dev ? DOCK_PORT + 1 : DOCK_PORT}`;
  console.log(`Dock 已启动：${url}${scheme === 'shelf-dev' ? '（配对开发版 App）' : ''}`);
  if (!dev && process.platform === 'darwin') execFile('open', [url]);
});

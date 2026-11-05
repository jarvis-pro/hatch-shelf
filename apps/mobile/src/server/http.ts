import { strFromU8, strToU8 } from 'fflate';

/**
 * 局域网传书用的最小 HTTP/1.1 解析（README 第 5.2 节）。
 * 只支持本 App 需要的子集：带 Content-Length 的请求、multipart/form-data 上传、每个连接一个请求。
 * 不依赖 RN，可在 Node 中测试。
 */

export interface HttpRequest {
  method: string;
  path: string;
  /** 小写 header 名 */
  headers: Record<string, string>;
  body: Uint8Array;
}

export type ParseResult =
  | { type: 'incomplete' }
  /** 头部刚收完且带 `Expect: 100-continue`（curl 上传大文件时会发），需要先回 100 */
  | { type: 'continue' }
  | { type: 'complete'; request: HttpRequest }
  | { type: 'error'; status: number; message: string };

const MAX_HEADER_BYTES = 16 * 1024;
const CRLFCRLF = new Uint8Array([13, 10, 13, 10]);

// 用 fflate 的 UTF-8 编解码：运行时没有 TextDecoder 时它有纯 JS 兜底
const encoder = { encode: (s: string) => strToU8(s) };
const decoder = { decode: (b: Uint8Array) => strFromU8(b) };

/** 在 haystack 中查找 needle，返回起始下标，找不到返回 -1 */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export class RequestParser {
  private head = new Uint8Array(0);
  private req: Omit<HttpRequest, 'body'> | null = null;
  private body: Uint8Array | null = null;
  private received = 0;
  private finished = false;

  constructor(private readonly maxBodyBytes: number) {}

  /** 请求头解析完之后的接收进度，用于传书页面显示上传进度；body 是已收到的部分 */
  get progress(): (Omit<HttpRequest, 'body'> & { body: Uint8Array; received: number; total: number }) | null {
    if (!this.req || !this.body) return null;
    return { ...this.req, body: this.body.subarray(0, this.received), received: this.received, total: this.body.length };
  }

  push(chunk: Uint8Array): ParseResult {
    if (this.finished) return { type: 'incomplete' };
    if (!this.req) return this.pushHead(chunk);
    return this.pushBody(chunk);
  }

  private pushHead(chunk: Uint8Array): ParseResult {
    const merged = new Uint8Array(this.head.length + chunk.length);
    merged.set(this.head);
    merged.set(chunk, this.head.length);
    this.head = merged;

    const end = indexOfBytes(merged, CRLFCRLF, Math.max(0, merged.length - chunk.length - 3));
    if (end < 0) {
      return merged.length > MAX_HEADER_BYTES ? this.fail(431, '请求头过大') : { type: 'incomplete' };
    }

    const lines = decoder.decode(merged.subarray(0, end)).split('\r\n');
    const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(lines[0]);
    if (!m) return this.fail(400, '无法解析请求行');
    const headers: Record<string, string> = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i <= 0) return this.fail(400, '无法解析请求头');
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    this.req = { method: m[1], path: m[2].split('?')[0], headers };

    if (headers['transfer-encoding']) return this.fail(411, '不支持分块传输，请提供 Content-Length');
    const length = headers['content-length'] === undefined ? 0 : Number(headers['content-length']);
    if (!Number.isInteger(length) || length < 0) return this.fail(400, 'Content-Length 无效');
    if (length > this.maxBodyBytes) return this.fail(413, '文件过大');

    this.body = new Uint8Array(length);
    const rest = merged.subarray(end + CRLFCRLF.length);
    this.head = new Uint8Array(0);
    const result = this.pushBody(rest);
    if (result.type === 'incomplete' && headers.expect?.toLowerCase() === '100-continue') {
      return { type: 'continue' };
    }
    return result;
  }

  private pushBody(chunk: Uint8Array): ParseResult {
    const body = this.body!;
    const n = Math.min(chunk.length, body.length - this.received);
    body.set(chunk.subarray(0, n), this.received);
    this.received += n;
    if (this.received < body.length) return { type: 'incomplete' };
    this.finished = true;
    return { type: 'complete', request: { ...this.req!, body } };
  }

  private fail(status: number, message: string): ParseResult {
    this.finished = true;
    return { type: 'error', status, message };
  }
}

const STATUS_TEXT: Record<number, string> = {
  100: 'Continue',
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  411: 'Length Required',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  431: 'Request Header Fields Too Large',
  500: 'Internal Server Error',
};

/** 组装完整响应；每个连接只处理一个请求，统一 Connection: close */
export function buildResponse(status: number, contentType: string, body: string | Uint8Array): Uint8Array {
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  const head = encoder.encode(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ''}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Length: ${bytes.length}\r\n` +
      `Cache-Control: no-store\r\n` +
      `Connection: close\r\n\r\n`,
  );
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head);
  out.set(bytes, head.length);
  return out;
}

export const CONTINUE_RESPONSE = encoder.encode('HTTP/1.1 100 Continue\r\n\r\n');

export function jsonResponse(status: number, data: unknown) {
  return buildResponse(status, 'application/json; charset=utf-8', JSON.stringify(data));
}

// ---------- multipart/form-data ----------

export interface FormPart {
  name: string;
  filename?: string;
  data: Uint8Array;
}

export function parseMultipart(body: Uint8Array, contentType: string | undefined): FormPart[] | null {
  const m = /multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  if (!m) return null;
  const delimiter = encoder.encode(`--${m[1] ?? m[2]}`);
  const parts: FormPart[] = [];

  let pos = indexOfBytes(body, delimiter);
  if (pos < 0) return null;
  for (;;) {
    pos += delimiter.length;
    // 结束标记 `--boundary--`
    if (body[pos] === 45 && body[pos + 1] === 45) break;
    pos += 2; // CRLF
    const headEnd = indexOfBytes(body, CRLFCRLF, pos);
    if (headEnd < 0) return null;
    const next = indexOfBytes(body, delimiter, headEnd + 4);
    if (next < 0) return null;

    const { name, filename } = partHeader(decoder.decode(body.subarray(pos, headEnd)));
    // 数据到下一个分隔符前的 CRLF 为止
    if (name !== undefined) parts.push({ name, filename, data: body.subarray(headEnd + 4, next - 2) });
    pos = next;
  }
  return parts;
}

function partHeader(head: string): { name?: string; filename?: string } {
  const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(head)?.[1] ?? '';
  const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
  // filename*=UTF-8''… 优先，否则用 filename="…"（浏览器会直接放 UTF-8 原文）
  const extended = /filename\*=UTF-8''([^;\s]+)/i.exec(disposition)?.[1];
  const plain = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
  return { name, filename: extended ? decodeURIComponent(extended) : plain };
}

/**
 * 请求体还没收完时，从已收到的开头部分找出第一个带文件名的字段的文件名，
 * 传书页据此在上传过程中就显示是哪本书。找不到（还没收到那部分）返回 undefined。
 */
export function peekMultipartFilename(head: Uint8Array, contentType: string | undefined): string | undefined {
  const m = /multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  if (!m) return undefined;
  const delimiter = encoder.encode(`--${m[1] ?? m[2]}`);
  let pos = indexOfBytes(head, delimiter);
  while (pos >= 0) {
    pos += delimiter.length + 2;
    const headEnd = indexOfBytes(head, CRLFCRLF, pos);
    if (headEnd < 0) return undefined;
    const { filename } = partHeader(decoder.decode(head.subarray(pos, headEnd)));
    if (filename) return filename;
    pos = indexOfBytes(head, delimiter, headEnd + 4);
  }
  return undefined;
}

export const textOf = (bytes: Uint8Array) => decoder.decode(bytes);

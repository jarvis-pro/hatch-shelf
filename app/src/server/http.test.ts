import { describe, expect, it } from 'vitest';
import { parseMultipart, peekMultipartFilename, RequestParser, textOf } from './http';

const enc = (s: string) => new TextEncoder().encode(s);

function multipart(boundary: string, parts: { name: string; filename?: string; body: string }[]) {
  return (
    parts
      .map(
        (p) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"` +
          (p.filename ? `; filename="${p.filename}"\r\nContent-Type: application/octet-stream` : '') +
          `\r\n\r\n${p.body}\r\n`,
      )
      .join('') + `--${boundary}--\r\n`
  );
}

describe('RequestParser', () => {
  it('parses a GET in one chunk', () => {
    const r = new RequestParser(100).push(enc('GET /books?x=1 HTTP/1.1\r\nHost: a\r\nX-Pin: 1234\r\n\r\n'));
    expect(r).toMatchObject({ type: 'complete', request: { method: 'GET', path: '/books', headers: { 'x-pin': '1234' } } });
  });

  it('assembles a body split across many chunks, including a split header terminator', () => {
    const raw = 'POST /upload HTTP/1.1\r\nContent-Length: 11\r\n\r\nhello world';
    const p = new RequestParser(100);
    let last;
    for (const ch of raw) last = p.push(enc(ch));
    expect(last).toMatchObject({ type: 'complete' });
    if (last?.type === 'complete') expect(textOf(last.request.body)).toBe('hello world');
  });

  it('asks for 100-continue before the body arrives', () => {
    const p = new RequestParser(100);
    expect(p.push(enc('POST /upload HTTP/1.1\r\nContent-Length: 3\r\nExpect: 100-continue\r\n\r\n'))).toEqual({ type: 'continue' });
    expect(p.push(enc('abc'))).toMatchObject({ type: 'complete' });
  });

  it('rejects oversized bodies as soon as headers arrive', () => {
    expect(new RequestParser(10).push(enc('POST / HTTP/1.1\r\nContent-Length: 11\r\n\r\n'))).toMatchObject({ type: 'error', status: 413 });
  });

  it('rejects chunked encoding and garbage', () => {
    expect(new RequestParser(10).push(enc('POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n'))).toMatchObject({ status: 411 });
    expect(new RequestParser(10).push(enc('hello\r\n\r\n'))).toMatchObject({ status: 400 });
  });

  it('rejects endless headers', () => {
    expect(new RequestParser(10).push(enc(`GET / HTTP/1.1\r\nX: ${'a'.repeat(20000)}`))).toMatchObject({ status: 431 });
  });
});

describe('parseMultipart', () => {
  it('extracts fields and a file with a UTF-8 name', () => {
    const body = enc(multipart('XyZ', [
      { name: 'pin', body: '1234' },
      { name: 'file', filename: '书.zip', body: 'PK\r\n--not-a-boundary\r\nbinary' },
    ]));
    const parts = parseMultipart(body, 'multipart/form-data; boundary=XyZ')!;
    expect(parts.map((p) => [p.name, p.filename, textOf(p.data)])).toEqual([
      ['pin', undefined, '1234'],
      ['file', '书.zip', 'PK\r\n--not-a-boundary\r\nbinary'],
    ]);
  });

  it('returns null without a boundary', () => {
    expect(parseMultipart(enc('x'), 'application/json')).toBeNull();
  });
});

describe('peekMultipartFilename', () => {
  const ct = 'multipart/form-data; boundary=XYZ';
  const raw = multipart('XYZ', [{ name: 'pin', body: '1234' }, { name: 'file', filename: '算法.zip', body: 'PK'.repeat(50) }]);
  const body = enc(raw);
  // 文件内容刚开始到达：头部已完整，内容只收到一点
  const fileStart = enc(raw.slice(0, raw.indexOf('PK') + 2)).length;

  it('finds the file name after a leading text field, before the body is complete', () => {
    expect(peekMultipartFilename(body.subarray(0, fileStart), ct)).toBe('算法.zip');
  });

  it('returns undefined until the file part header has arrived', () => {
    expect(peekMultipartFilename(body.subarray(0, 60), ct)).toBeUndefined();
    expect(peekMultipartFilename(body, 'text/plain')).toBeUndefined();
  });
});

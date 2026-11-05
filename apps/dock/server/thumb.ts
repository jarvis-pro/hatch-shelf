import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COVER_THUMB_MAX } from '@shelf/spec';

/** 缩略图宽度：手机接收页上封面最宽 44pt，按 3 倍屏取 */
const WIDTH = 132;

const cache = new Map<string, string | null>();

/**
 * 书目录 cover.png 的 JPEG 缩略图（data URI），放进推送请求里，让手机在确认框里就能看到新书封面。
 * 用 macOS 自带的 sips 缩放；不是 macOS、没有封面或缩出来太大时返回 undefined，手机上画文字封面
 */
export async function coverThumb(dir: string): Promise<string | undefined> {
  const file = path.join(dir, 'cover.png');
  if (process.platform !== 'darwin' || !existsSync(file)) return undefined;
  const key = `${file}:${statSync(file).mtimeMs}`;
  if (!cache.has(key)) cache.set(key, await resize(file));
  return cache.get(key) ?? undefined;
}

async function resize(file: string): Promise<string | null> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelf-dock-'));
  const out = path.join(tmp, 'thumb.jpg');
  try {
    await new Promise<void>((resolve, reject) =>
      execFile('sips', ['--resampleWidth', String(WIDTH), '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', file, '--out', out], (err) =>
        err ? reject(err) : resolve(),
      ),
    );
    const uri = `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`;
    return uri.length <= COVER_THUMB_MAX ? uri : null;
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

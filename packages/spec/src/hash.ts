import { strToU8 } from 'fflate';

/**
 * 整本书内容的指纹：按路径排序后，把「路径 + 长度 + 内容」依次喂给两路 FNV-1a，拼成 16 位十六进制。
 * 只用来判断内容是否变化（push --changed），不需要抗碰撞。
 */
export function contentHash(files: { path: string; text?: string; bytes?: Uint8Array }[]): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  const feed = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      a = Math.imul(a ^ bytes[i], 0x01000193);
      b = Math.imul(b ^ bytes[i], 0x01000193) ^ (b >>> 15);
    }
  };
  for (const f of [...files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))) {
    const data = f.bytes ?? strToU8(f.text ?? '');
    feed(strToU8(`${f.path}\0${data.length}\0`));
    feed(data);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(a) + hex(b);
}

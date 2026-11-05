import { describe, expect, it } from 'vitest';
import { formatBytes, reconcileSizes, splitBytes } from './size-format';

describe('formatBytes', () => {
  it('不足 1000 KB 显示整数 KB', () => {
    expect(formatBytes(956 * 1024)).toBe('956 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });

  it('更大时显示一位小数的 MB', () => {
    expect(formatBytes(1040 * 1024)).toBe('1.0 MB');
    expect(formatBytes(58.2 * 1024 * 1024)).toBe('58.2 MB');
  });

  it('splitBytes 拆出数值与单位', () => {
    expect(splitBytes(21.4 * 1024 * 1024)).toEqual({ value: '21.4', unit: 'MB' });
  });
});

describe('reconcileSizes', () => {
  it('指纹一致取缓存，新书和更新过的书需要重新统计', () => {
    const books = [
      { id: 'a', contentHash: 'h1' },
      { id: 'b', contentHash: 'h2' },
      { id: 'c', contentHash: null },
    ];
    const { known, audio, missing } = reconcileSizes(books, {
      a: { hash: 'h1', bytes: 100, audio: 30 },
      b: { hash: 'old', bytes: 200, audio: 0 },
      gone: { hash: 'x', bytes: 1, audio: 0 },
    });
    expect([...known]).toEqual([['a', 100]]);
    expect([...audio]).toEqual([['a', 30]]);
    expect(missing).toEqual(['b', 'c']);
  });

  it('旧版缓存没有原声大小，按需要重新统计处理', () => {
    const { known, missing } = reconcileSizes([{ id: 'a', contentHash: 'h1' }], { a: { hash: 'h1', bytes: 100 } });
    expect(known.size).toBe(0);
    expect(missing).toEqual(['a']);
  });
});

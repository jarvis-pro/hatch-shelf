import { describe, expect, it } from 'vitest';
import { pushable, statusOf, type LibBook, type PhoneState } from './types';

const book = (over: Partial<LibBook> = {}): LibBook => ({
  id: 'b1',
  title: '书',
  relPath: '分组/书',
  group: '分组',
  chapters: 3,
  mtime: 0,
  errors: [],
  warnings: [],
  hash: 'h1',
  bytes: 100,
  cover: true,
  audio: 0,
  ...over,
});

const online = (over: Partial<Extract<PhoneState, { status: 'online' }>> = {}): PhoneState => ({
  status: 'online',
  addr: '127.0.0.1',
  device: 'iPhone',
  books: [],
  audioMissing: {},
  notes: {},
  ...over,
});

describe('书的状态', () => {
  it('校验没过的书不能推', () => {
    const b = book({ errors: ['x'], hash: null });
    expect(statusOf(b, online())).toBe('error');
    expect(pushable(b, online())).toBe(false);
  });

  it('手机没连上时不知道状态', () => {
    expect(statusOf(book(), null)).toBe('unknown');
    expect(statusOf(book(), { status: 'offline' })).toBe('unknown');
    expect(pushable(book(), null)).toBe(false);
  });

  it('按内容指纹比对：没有、不同、相同', () => {
    expect(statusOf(book(), online())).toBe('new');
    expect(statusOf(book(), online({ books: [{ id: 'b1', title: '书', updated: null, hash: 'h0' }] }))).toBe('update');
    // 早期导入的书没有指纹，当作有更新
    expect(statusOf(book(), online({ books: [{ id: 'b1', title: '书', updated: null, hash: null }] }))).toBe('update');
    const synced = online({ books: [{ id: 'b1', title: '书', updated: null, hash: 'h1' }] });
    expect(statusOf(book(), synced)).toBe('synced');
    expect(pushable(book(), synced)).toBe(false);
  });

  it('书一样但原声没补齐时仍然可以推', () => {
    const phone = online({ books: [{ id: 'b1', title: '书', updated: null, hash: 'h1' }], audioMissing: { b1: 2 } });
    expect(statusOf(book({ audio: 3 }), phone)).toBe('synced');
    expect(pushable(book({ audio: 3 }), phone)).toBe(true);
  });
});

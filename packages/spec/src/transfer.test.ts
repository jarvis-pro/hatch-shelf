import { describe, expect, it } from 'vitest';
import { bearerKey, COVER_THUMB_MAX, isSessionLog, isSessionRequest, pairUrl, parsePairing } from './transfer';

const KEY = 'Zk3n9QwErTyUiOpAsDfGhJ';

describe('配对链接', () => {
  it('生成的链接能原样解析回来', () => {
    const url = new URL(pairUrl('shelf-dev', { key: KEY, name: 'Jarvis 的 MacBook Pro' }));
    expect(url.protocol).toBe('shelf-dev:');
    expect(parsePairing({ k: url.searchParams.get('k'), name: url.searchParams.get('name') })).toEqual({
      key: KEY,
      name: 'Jarvis 的 MacBook Pro',
    });
  });

  it('密钥不合法时拒绝', () => {
    expect(parsePairing({ k: 'short' })).toBeNull();
    expect(parsePairing({ k: `${KEY}!` })).toBeNull();
    expect(parsePairing({})).toBeNull();
  });

  it('名字去掉控制字符、截断，缺省为「电脑」', () => {
    expect(parsePairing({ k: KEY, name: ' a\nb ' })?.name).toBe('ab');
    expect(parsePairing({ k: KEY, name: 'x'.repeat(100) })?.name).toHaveLength(40);
    expect(parsePairing({ k: KEY })?.name).toBe('电脑');
  });
});

describe('请求校验', () => {
  it('从 Authorization 取密钥', () => {
    expect(bearerKey(`Bearer ${KEY}`)).toBe(KEY);
    expect(bearerKey(`bearer ${KEY}`)).toBe(KEY);
    expect(bearerKey(KEY)).toBeNull();
    expect(bearerKey('Bearer 123')).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
  });

  it('session 请求体', () => {
    const item = { id: 'a', title: '书', kind: 'new', detail: '9 章' };
    expect(isSessionRequest({ items: [item], bytes: 10 })).toBe(true);
    expect(isSessionRequest({ items: [], bytes: 0 })).toBe(false);
    expect(isSessionRequest({ items: [{ ...item, kind: 'x' }], bytes: 0 })).toBe(false);
    expect(isSessionRequest({ items: [{ ...item, category: '技术/前端', cover: 'data:image/jpeg;base64,/9j/4AAQ' }], bytes: 10 })).toBe(true);
    // 缩略图只收 data URI，不能是外链，也不能太大
    expect(isSessionRequest({ items: [{ ...item, cover: 'https://example.com/a.png' }], bytes: 10 })).toBe(false);
    expect(isSessionRequest({ items: [{ ...item, cover: `data:image/jpeg;base64,${'A'.repeat(COVER_THUMB_MAX)}` }], bytes: 10 })).toBe(false);
    expect(isSessionRequest({ items: [{ ...item, audioChapters: '4' }], bytes: 10 })).toBe(false);
    expect(isSessionLog({ kind: 'notes', detail: '11 条' })).toBe(true);
    expect(isSessionLog({ kind: 'other', detail: '' })).toBe(false);
  });
});

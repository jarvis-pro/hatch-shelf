import { describe, expect, it } from 'vitest';
import { makeSnippet } from './snippet';

describe('makeSnippet', () => {
  it('centers on the match case-insensitively and collapses whitespace', () => {
    const body = `${'前文'.repeat(30)}\n\nThe Attention   机制${'后文'.repeat(40)}`;
    const s = makeSnippet(body, 'attention', 6);
    expect(s.match).toBe('Attention');
    expect(s.before).toBe('…文 The ');
    expect(s.after.startsWith(' 机制')).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
  });

  it('has no ellipsis when the body is short', () => {
    expect(makeSnippet('短句里的词', '里的')).toEqual({ before: '短句', match: '里的', after: '词' });
  });
});

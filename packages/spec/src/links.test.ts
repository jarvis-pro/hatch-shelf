import { describe, expect, it } from 'vitest';
import { bookAnchors, collectLinks, deviceLinks, deviceNext, headingAnchors, lintBook, parseBookLink, parseLibraryLink, rewriteLinks } from './index';

describe('parseBookLink', () => {
  it('recognizes anchors, chapters, other books and external urls', () => {
    expect(parseBookLink('#%E5%B0%8F%E8%8A%82')).toEqual({ kind: 'anchor', anchor: '小节' });
    expect(parseBookLink('./02-x.md#a')).toEqual({ kind: 'chapter', file: '02-x.md', anchor: 'a' });
    expect(parseBookLink('02-x.md')).toEqual({ kind: 'chapter', file: '02-x.md', anchor: undefined });
    expect(parseBookLink('../rag-systems')).toEqual({ kind: 'book', bookId: 'rag-systems', file: undefined, anchor: undefined });
    expect(parseBookLink('../rag-systems/')).toEqual({ kind: 'book', bookId: 'rag-systems', file: undefined, anchor: undefined });
    expect(parseBookLink('../rag-systems/03-x.md#b')).toEqual({ kind: 'book', bookId: 'rag-systems', file: '03-x.md', anchor: 'b' });
    expect(parseBookLink('https://example.com')).toEqual({ kind: 'external', url: 'https://example.com' });
  });
  it('rejects paths outside the book layout', () => {
    expect(parseBookLink('../rag-systems#b')).toBeNull();
    expect(parseBookLink('../../x/01.md')).toBeNull();
    expect(parseBookLink('assets/a.svg')).toBeNull();
  });
});

describe('collectLinks / headingAnchors', () => {
  it('skips images and code', () => {
    const md = '[a](01.md) ![i](assets/a.png)\n`[c](x.md)`\n```md\n[d](y.md)\n```\n[e](../b/ "t")';
    expect(collectLinks(md)).toEqual([
      { line: 1, href: '01.md' },
      { line: 6, href: '../b/' },
    ]);
  });
  it('slugs headings like the reader, with duplicate suffixes', () => {
    expect(headingAnchors('# 标题\n## 小节 `code`\n## 小节 code\n```sh\n# not\n```')).toEqual(
      new Set(['标题', '小节-code', '小节-code-1']),
    );
  });
});

describe('lintBook links', () => {
  const file = (path: string, text: string) => ({ path, size: text.length, text });
  const other = bookAnchors('other', [
    file('book.yaml', 'id: other\ntitle: O\nchapters: [01-a.md]'),
    file('01-a.md', '# A\n## 目标'),
  ])!;
  const files = [
    file('book.yaml', 'id: me\ntitle: M\nchapters: [01-x.md, 02-y.md]'),
    file(
      '01-x.md',
      [
        '# X',
        '## 本节',
        '[ok](#本节) [ok](02-y.md#y) [ok](../other/) [ok](../other/01-a.md#目标) [ok](../me/02-y.md)',
        '[bad](#nope) [bad](03-z.md) [bad](02-y.md#nope)',
        '[bad](../missing/) [bad](../other/09.md) [bad](../other/01-a.md#nope) [bad](assets/a.svg)',
      ].join('\n'),
    ),
    file('02-y.md', '# Y'),
  ];

  it('reports missing chapters, anchors and books', () => {
    const r = lintBook('me', files, { resolveBook: (id) => (id === 'other' ? other.chapters : null) });
    expect(r.errors).toEqual([
      '01-x.md:4 链接的小节不存在：#nope',
      '01-x.md:4 链接的章节不存在：03-z.md',
      '01-x.md:4 链接的小节不存在：02-y.md#nope',
      '01-x.md:5 链接的书不存在：../missing/',
      '01-x.md:5 链接的章节不存在：../other/09.md',
      '01-x.md:5 链接的小节不存在：../other/01-a.md#nope',
      '01-x.md:5 无法识别的链接（跨书请写成 ../<book-id>/<章节>.md#小节）：assets/a.svg',
    ]);
  });

  it('skips cross-book links when there is no library to check against', () => {
    const r = lintBook('me', files, { resolveBook: () => undefined });
    expect(r.errors.filter((e) => e.includes('../'))).toEqual(['01-x.md:5 无法识别的链接（跨书请写成 ../<book-id>/<章节>.md#小节）：assets/a.svg']);
  });
});

describe('library links', () => {
  it('decodes chinese chapter names as the reader sees them', () => {
    expect(parseBookLink('02-%E5%B9%B6%E5%8F%91.md#%E5%B0%8F%E8%8A%82')).toEqual({ kind: 'chapter', file: '02-并发.md', anchor: '小节' });
    expect(parseBookLink('../a1/03-通道.md')).toEqual({ kind: 'book', bookId: 'a1', file: '03-通道.md', anchor: undefined });
  });

  it('parses path links and translates them for the device', () => {
    expect(parseLibraryLink('../../人工智能/RAG 与知识系统/05-评估.md#召回')).toEqual({
      path: '人工智能/RAG 与知识系统',
      file: '05-评估.md',
      anchor: '召回',
    });
    expect(parseLibraryLink('../../人工智能/RAG 与知识系统/')).toMatchObject({ path: '人工智能/RAG 与知识系统', file: undefined });
    expect(parseLibraryLink('../rag/')).toBeNull();
    const md = '见 [评估](<../../人工智能/RAG 与知识系统/05-评估.md#召回>) 和 `[x](<../../a/b/>)`\n```md\n[y](<../../人工智能/RAG 与知识系统/>)\n```';
    const ids = (p: string) => (p === '人工智能/RAG 与知识系统' ? 'u1' : null);
    expect(deviceLinks(md, ids)).toBe(md.replace('<../../人工智能/RAG 与知识系统/05-评估.md#召回>', '../u1/05-评估.md#召回'));
    expect(collectLinks('[a](<../../x y/z/>)')).toEqual([{ line: 1, href: '../../x y/z/' }]);
    expect(rewriteLinks('[a](01.md "t")', () => '../../新 组/书/')).toBe('[a](<../../新 组/书/> "t")');
  });

  it('translates next books written as paths', () => {
    const yaml = 'id: a\nnext:\n  - book: 人工智能/RAG 与知识系统\n    reason: 接着读\n  - book: "技术/没有"\n';
    expect(deviceNext(yaml, (p) => (p === '人工智能/RAG 与知识系统' ? 'u1' : null))).toBe(
      'id: a\nnext:\n  - id: u1\n    reason: 接着读\n  - book: "技术/没有"\n',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { firstHeading, lintBook, lintChapter, scanMarkdown } from './index';

describe('scanMarkdown', () => {
  it('handles a 4-backtick fence wrapping a 3-backtick fence', () => {
    const lines = scanMarkdown('````md\n```go\nx\n```\n````\n# after');
    expect(lines.map((l) => l.inFence)).toEqual([true, true, true, true, true, false]);
    expect(firstHeading('````md\n# no\n````\n# yes')).toBe('yes');
  });
});

describe('lintChapter', () => {
  const assets = new Set(['assets/a.png']);
  it('accepts a clean chapter', () => {
    expect(lintChapter('c.md', '# T\n\n![x](assets/a.png)\n\n```go\nx\n```', assets)).toEqual({ errors: [], warnings: [] });
  });
  it('reports remote, missing, misplaced images and untagged fences, but ignores code', () => {
    const md = [
      '# T',
      '![r](https://x.com/a.png)',
      '![m](assets/missing.png) <img src="img/b.png">',
      '```',
      '![ignored](https://x.com/b.png)',
      '```',
      'inline `![ignored](http://x)` ok',
    ].join('\n');
    const { errors } = lintChapter('c.md', md, assets);
    expect(errors).toEqual([
      'c.md:2 远程图片（离线时无法显示）：https://x.com/a.png',
      'c.md:3 图片不存在：assets/missing.png',
      'c.md:3 图片必须放在 assets/ 下：img/b.png',
      'c.md:4 代码块没有标注语言',
    ]);
  });
  it('requires exactly one H1', () => {
    expect(lintChapter('c.md', 'no title', assets).errors).toEqual(['c.md 没有 H1 章标题']);
    expect(lintChapter('c.md', '# a\n# b', assets).errors).toEqual(['c.md 有 2 个 H1，每章只能有一个']);
  });
});

describe('lintBook', () => {
  const yaml = 'id: demo\ntitle: D\nupdated: 2026-11-02\nchapters: [01-a.md, 02-b.md]';
  it('reports structural problems', () => {
    const r = lintBook('other', [
      { path: 'book.yaml', size: 1, text: yaml },
      { path: '01-a.md', size: 1, text: '# A' },
      { path: 'extra.md', size: 1, text: '# E' },
      { path: 'notes.txt', size: 1 },
    ]);
    expect(r.errors).toEqual(['chapters 中列出的文件不存在：02-b.md']);
    expect(r.warnings).toEqual(['未列入 chapters，不会被导入：extra.md', '不支持的文件类型，导入时会被丢弃：notes.txt']);
  });

  it('checks that next books exist on the shelf, skipping when there is nothing to compare', () => {
    const files = (next: string) => [
      { path: 'book.yaml', size: 1, text: `id: demo\ntitle: D\nchapters: [01-a.md]\nnext:\n${next}` },
      { path: '01-a.md', size: 1, text: '# A' },
    ];
    const shelf = (id: string) => (id === 'known' ? new Map() : null);
    const r = lintBook('demo', files('  - id: known\n    reason: 接着读\n  - id: missing\n  - id: demo'), { resolveBook: shelf });
    expect(r.errors).toEqual(['next 推荐的书不存在：missing', 'next 不能推荐本书自己']);
    expect(lintBook('demo', files('  - id: missing'), { resolveBook: () => undefined }).errors).toEqual([]);
  });

  it('applies the library rules only inside a library', () => {
    const uuid = '3f2a9c1e-7b4d-4c2a-9f1e-0a1b2c3d4e5f';
    const files = (id: string, title: string, extra = '') => [
      { path: 'book.yaml', size: 1, text: `id: ${id}\ntitle: ${title}\ncategory: 技术/Go\nchapters: [01-并发.md]${extra}` },
      { path: '01-并发.md', size: 1, text: '# 并发' },
      { path: 'notes.md', size: 1, text: '# 笔记' },
      { path: 'audio/manifest.json', size: 1 },
    ];
    const known = (path: string) => (path === '技术/Rust 入门' ? new Map() : null);
    const library = (relPath: string) => ({ library: { relPath, resolvePath: known } });
    expect(lintBook('Go 实战', files(uuid, 'Go 实战'), library('技术/Go 实战'))).toMatchObject({ errors: [], warnings: [] });
    expect(lintBook('demo', files('demo', 'Go 实战')).errors).toEqual([]);
    expect(lintBook('x', files('demo', 'Go 实战'), library('技术/Go/Go 实战')).errors).toEqual([
      '书库里的书 id 用小写 UUID（shelf-pack new 会生成）：demo',
      '目录应为 books/技术/Go 实战（分组/书名），实际是 books/技术/Go/Go 实战',
    ]);
    expect(lintBook('x', files(uuid, '部署与 CI/CD'), library('技术/部署与 CI／CD')).errors).toEqual([]);
    const next = (lines: string) => files(uuid, 'Go 实战', `\nnext:\n${lines}`);
    expect(lintBook('x', next('  - book: 技术/Rust 入门\n  - book: 技术/没有'), library('技术/Go 实战')).errors).toEqual([
      'next 推荐的书不存在：技术/没有',
    ]);
    expect(lintBook('x', next('  - id: other'), library('技术/Go 实战')).errors).toEqual(['书库里的 next 按路径写（book: 分组/书名）：other']);
    expect(lintBook('x', next('  - book: 技术/Rust 入门')).errors).toEqual(['book: 技术/Rust 入门 只能在书库里用，单独的书写 id']);
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBook } from './books';
import { lintConventions, readConventions, type Conventions } from './conventions';

const conv: Conventions = { banned: ['SecretCo', '内部项目'], chapterEndings: { 技术: ['本章要点', '动手练习'] } };

/** 在临时目录里建一本书：files 是相对书目录的路径和内容 */
function makeBook(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'conventions-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return readBook(dir);
}

const chapter = (body: string) => `# 标题\n\n${body}\n\n## 本章要点\n\n- 一点\n\n## 动手练习\n\n1. 一题\n`;

describe('lintConventions', () => {
  it('passes a chapter that follows the conventions', () => {
    const book = makeBook({ '01-a.md': chapter('正文') });
    expect(lintConventions(book, ['01-a.md'], '技术', conv)).toEqual([]);
  });

  it('finds banned words in markdown, book.yaml and svg, ignoring case', () => {
    const book = makeBook({
      '01-a.md': chapter('参考了 secretco 的做法'),
      'book.yaml': 'title: 内部项目实战\n',
      'assets/x.svg': '<svg><text>SECRETCO</text></svg>',
    });
    const errors = lintConventions(book, ['01-a.md'], '技术', conv);
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.startsWith('01-a.md:3 ') && e.includes('SecretCo'))).toBe(true);
    expect(errors.some((e) => e.startsWith('book.yaml:1 ') && e.includes('内部项目'))).toBe(true);
    expect(errors.some((e) => e.startsWith('assets/x.svg:1 '))).toBe(true);
  });

  it('requires the chapter endings of the book group only', () => {
    const book = makeBook({ '01-a.md': '# 标题\n\n## 本章要点\n' });
    expect(lintConventions(book, ['01-a.md'], '技术', conv)).toEqual(['01-a.md 缺少「动手练习」一节']);
    expect(lintConventions(book, ['01-a.md'], '使用指南', conv)).toEqual([]);
  });

  it('does not count headings inside code blocks', () => {
    const book = makeBook({ '01-a.md': '# 标题\n\n```markdown\n## 本章要点\n## 动手练习\n```\n' });
    expect(lintConventions(book, ['01-a.md'], '技术', conv)).toHaveLength(2);
  });

  it('flags box drawing but allows directory trees and command output trees', () => {
    const tree = ['```text', 'skills/', '├── SKILL.md', '│   └── a.md', '│', '             └─5678 sleep 15', '```'].join('\n');
    const art = ['```text', '┌──────┐', '│ 方框 │', '└──────┘', '████ 60%', '```'].join('\n');
    const book = makeBook({ '01-a.md': chapter(tree), '02-b.md': chapter(art) });
    expect(lintConventions(book, ['01-a.md'], '技术', conv)).toEqual([]);
    const errors = lintConventions(book, ['02-b.md'], '技术', conv);
    expect(errors.map((e) => e.split(' ')[0])).toEqual(['02-b.md:4', '02-b.md:5', '02-b.md:6', '02-b.md:7']);
  });
});

describe('readConventions', () => {
  it('returns null without lint.yaml', () => {
    expect(readConventions(mkdtempSync(path.join(tmpdir(), 'conventions-')))).toBeNull();
  });

  it('reads banned words and chapter endings by group', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conventions-'));
    writeFileSync(path.join(dir, 'lint.yaml'), 'banned: [甲, b]\nchapterEndings:\n  技术: [本章要点]\n');
    expect(readConventions(dir)).toEqual({ banned: ['甲', 'b'], chapterEndings: { 技术: ['本章要点'] } });
  });

  it('rejects a malformed file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conventions-'));
    writeFileSync(path.join(dir, 'lint.yaml'), 'chapterEndings: [本章要点]\n');
    expect(() => readConventions(dir)).toThrow(/chapterEndings/);
  });
});

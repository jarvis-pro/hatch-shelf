import { describe, expect, it } from 'vitest';
import { buildNotesMarkdown } from './export';

describe('buildNotesMarkdown', () => {
  it('groups by chapter order and keeps locations', () => {
    const md = buildNotesMarkdown(
      { id: 'demo', title: '示例' },
      [
        { file: '01-a.md', title: '甲' },
        { file: '02-b.md', title: '乙' },
      ],
      [
        { chapterFile: '02-b.md', text: '第二章的一句', anchor: '小节', note: '想法', createdAt: Date.UTC(2026, 10, 2) },
        { chapterFile: '01-a.md', text: '两行\n原文', note: null, createdAt: Date.UTC(2026, 10, 1) },
      ],
      Date.UTC(2026, 10, 3),
    );
    expect(md).toBe(
      [
        '---',
        'book: demo',
        'exported: 2026-11-03',
        'count: 2',
        '---',
        '',
        '# 《示例》阅读笔记',
        '',
        '## 1. 甲',
        '',
        '<!-- 01-a.md -->',
        '',
        '> 两行',
        '> 原文',
        '',
        '<sub>2026-11-01</sub>',
        '',
        '## 2. 乙',
        '',
        '<!-- 02-b.md -->',
        '',
        '> 第二章的一句',
        '',
        '想法',
        '',
        '<sub>2026-11-02 · #小节</sub>',
        '',
      ].join('\n'),
    );
  });
});

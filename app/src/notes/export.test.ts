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
        'doubts: 0',
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

  it('puts doubts first with their chapter and anchor', () => {
    const md = buildNotesMarkdown(
      { id: 'demo', title: '示例' },
      [
        { file: '01-a.md', title: '甲' },
        { file: '02-b.md', title: '乙' },
      ],
      [
        { chapterFile: '02-b.md', kind: 'doubt', text: '可疑的说法', anchor: '小节', note: '条款号对吗', createdAt: Date.UTC(2026, 10, 2) },
        { chapterFile: '01-a.md', kind: 'doubt', text: '没写说明', note: null, createdAt: Date.UTC(2026, 10, 3) },
        { chapterFile: '01-a.md', text: '普通高亮', note: null, createdAt: Date.UTC(2026, 10, 1) },
      ],
      Date.UTC(2026, 10, 3),
    );
    expect(md).toBe(
      [
        '---',
        'book: demo',
        'exported: 2026-11-03',
        'count: 3',
        'doubts: 2',
        '---',
        '',
        '# 《示例》阅读笔记',
        '',
        '## 存疑',
        '',
        '<!-- 读者认为可能有错、需要核实的地方 -->',
        '',
        '> 没写说明',
        '',
        '<sub>2026-11-03 · 第 1 章 01-a.md</sub>',
        '',
        '> 可疑的说法',
        '',
        '条款号对吗',
        '',
        '<sub>2026-11-02 · 第 2 章 02-b.md#小节</sub>',
        '',
        '## 1. 甲',
        '',
        '<!-- 01-a.md -->',
        '',
        '> 普通高亮',
        '',
        '<sub>2026-11-01</sub>',
        '',
      ].join('\n'),
    );
  });
});

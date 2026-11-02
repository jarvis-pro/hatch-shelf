import { describe, expect, it } from 'vitest';
import { createSlugger, headingText, splitSections } from './markdown';

describe('headingText', () => {
  it('strips inline markup the way the rendered heading reads', () => {
    expect(headingText('**Go** 的 `chan` 与 [调度器](x.md) $O(n)$')).toBe('Go 的 chan 与 调度器');
  });
});

describe('createSlugger', () => {
  it('dedupes repeated headings', () => {
    const s = createSlugger();
    expect([s('示例 A'), s('示例 A'), s('示例 A')]).toEqual(['示例-a', '示例-a-1', '示例-a-2']);
  });
});

describe('splitSections', () => {
  it('splits by H1–H3, keeps code text, folds H4 into its section', () => {
    const md = '# 标题\n引言\n## 第一节\n内容\n```go\nfmt.Println()\n```\n#### 小标题\n更多\n## 第一节\n重复';
    expect(splitSections(md)).toEqual([
      { anchor: '标题', heading: '标题', level: 1, body: '标题\n引言\n' },
      { anchor: '第一节', heading: '第一节', level: 2, body: '第一节\n内容\nfmt.Println()\n小标题\n更多\n' },
      { anchor: '第一节-1', heading: '第一节', level: 2, body: '第一节\n重复\n' },
    ]);
  });
});

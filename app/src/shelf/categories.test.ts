import { describe, expect, it } from 'vitest';
import { categoryLabel, compareSeries, seriesOf, UNCATEGORIZED } from './categories';

describe('categories', () => {
  it('按第一段归入系列并显示系列名', () => {
    expect(seriesOf('ai/agent')).toBe('ai');
    expect(categoryLabel('opc/growth')).toBe('一人公司');
    expect(categoryLabel('go/web')).toBe('go');
    expect(seriesOf(null)).toBe(UNCATEGORIZED);
    expect(categoryLabel(null)).toBeNull();
  });

  it('已知系列在前，其余按字母序，未分类最后', () => {
    expect(['zzz', UNCATEGORIZED, 'opc', 'abc', 'ai'].sort(compareSeries)).toEqual(['ai', 'opc', 'abc', 'zzz', UNCATEGORIZED]);
  });
});

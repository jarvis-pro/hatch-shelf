import { describe, expect, it } from 'vitest';
import { categoryLabel, seriesOf, sortSeries, UNCATEGORIZED } from './categories';

describe('categories', () => {
  it('按第一段归入系列，原样显示', () => {
    expect(seriesOf('人工智能/Agent')).toBe('人工智能');
    expect(categoryLabel('自媒体/平台')).toBe('自媒体');
    expect(categoryLabel('go/web')).toBe('go');
    expect(seriesOf(null)).toBe(UNCATEGORIZED);
    expect(categoryLabel(null)).toBeNull();
  });

  it('按系列中最早导入的书排序，同时导入按名称，未分类最后', () => {
    const at = (...ts: number[]) => ts.map((importedAt) => ({ importedAt }));
    const groups: [string, { importedAt: number }[]][] = [
      [UNCATEGORIZED, at(1)],
      ['短剧', at(300, 50)],
      ['自媒体', at(200)],
      ['人工智能', at(100)],
      ['运维', at(100)],
    ];
    expect(sortSeries(groups).map(([k]) => k)).toEqual(['短剧', '人工智能', '运维', '自媒体', UNCATEGORIZED]);
  });
});

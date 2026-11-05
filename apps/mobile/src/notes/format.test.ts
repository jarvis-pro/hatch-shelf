import { describe, expect, it } from 'vitest';
import { countLabel, formatDay } from './format';

describe('formatDay', () => {
  const now = new Date(2026, 10, 2, 15, 0).getTime();
  it('今天和昨天按自然日算', () => {
    expect(formatDay(new Date(2026, 10, 2, 0, 1).getTime(), now)).toBe('今天');
    expect(formatDay(new Date(2026, 10, 1, 23, 59).getTime(), now)).toBe('昨天');
  });
  it('更早的显示日期，跨年带年份', () => {
    expect(formatDay(new Date(2026, 9, 28).getTime(), now)).toBe('10 月 28 日');
    expect(formatDay(new Date(2025, 11, 31).getTime(), now)).toBe('2025 年 12 月 31 日');
  });
});

describe('countLabel', () => {
  it('没有笔记时只显示高亮数', () => {
    expect(countLabel(7, 0)).toBe('7 条高亮');
    expect(countLabel(12, 5)).toBe('12 条高亮 · 5 条笔记');
    expect(countLabel(12, 0, 2)).toBe('12 条高亮 · 2 处存疑');
  });
});

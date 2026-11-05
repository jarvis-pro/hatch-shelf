/**
 * 没有 cover.png 的书用文字封面（App 的 BookCover 与 Dock 的封面墙画法相同）。
 * 色带配色取自设计稿书封的丝网印刷配色，放在这里保证两边同一本书颜色一致
 */
export const COVER_COLORS = ['#2B3A67', '#C4562E', '#1F4E7A', '#8E2F45', '#3F6150', '#7A5A2E', '#4B3F72', '#2F5D62'];

/** 同一顶层分类用同一个颜色；没有分类时按 id 取色 */
export function coverColor(category: string | null | undefined, id: string) {
  const key = category?.split('/')[0] ?? id;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

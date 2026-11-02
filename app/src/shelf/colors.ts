/** 文字封面的色带，取自设计稿书封的丝网印刷配色 */
const COVER_COLORS = ['#2B3A67', '#C4562E', '#1F4E7A', '#8E2F45', '#3F6150', '#7A5A2E', '#4B3F72', '#2F5D62'];

/** 同一顶层分类用同一个颜色；没有分类时按 id 取色 */
export function coverColor(category: string | null, id: string) {
  const key = category?.split('/')[0] ?? id;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

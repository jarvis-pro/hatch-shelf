import { useColorScheme } from 'react-native';

export function useShelfColors() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#000000', card: '#1c1c1e', fg: '#f2f2f7', muted: '#8e8e93', border: '#38383a', accent: '#0a84ff', danger: '#ff453a' }
    : { bg: '#f2f2f7', card: '#ffffff', fg: '#1c1c1e', muted: '#6e6e73', border: '#d1d1d6', accent: '#007aff', danger: '#ff3b30' };
}

export type ShelfColors = ReturnType<typeof useShelfColors>;

const COVER_COLORS = ['#3d5a80', '#7a4f9a', '#2a7f62', '#b5552b', '#8c3b4a', '#4a6fa5', '#6b705c', '#9c6644'];

/** 同一顶层分类用同一个颜色；没有分类时按 id 取色 */
export function coverColor(category: string | null, id: string) {
  const key = category?.split('/')[0] ?? id;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

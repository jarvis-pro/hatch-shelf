import { getSetting, setSetting } from '@/db/queries';
import type { ReaderTheme, ThemeMode } from './bridge';

/** 字号滑杆的刻度（px） */
export const FONT_SIZES = [14, 16, 18, 20, 22, 24] as const;

export const LINE_HEIGHTS = [
  { value: 1.6, label: '紧凑' },
  { value: 1.85, label: '适中' },
  { value: 2.1, label: '宽松' },
] as const;

export const lineHeightLabel = (v: number) =>
  LINE_HEIGHTS.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a)).label;

/** 阅读设置（不含明暗：阅读页跟随 App 外观） */
export type ReaderPrefs = Omit<ReaderTheme, 'mode'>;

const KEY = 'readerTheme';
const DEFAULTS: ReaderPrefs = { fontSize: 16, lineHeight: 1.85, wrapCode: false };

const listeners = new Set<(p: ReaderPrefs) => void>();

export async function loadReaderPrefs(): Promise<ReaderPrefs> {
  // 旧版本存过 mode（含已移除的护眼主题），这里只取需要的字段
  const { fontSize, lineHeight, wrapCode } = { ...DEFAULTS, ...(await getSetting<Partial<ReaderTheme>>(KEY, {})) };
  return { fontSize, lineHeight, wrapCode };
}

export async function saveReaderPrefs(prefs: ReaderPrefs) {
  listeners.forEach((l) => l(prefs));
  await setSetting(KEY, prefs);
}

/** 设置页与阅读页之间同步 */
export function onReaderPrefsChange(listener: (p: ReaderPrefs) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const toReaderTheme = (prefs: ReaderPrefs, mode: ThemeMode): ReaderTheme => ({ ...prefs, mode });

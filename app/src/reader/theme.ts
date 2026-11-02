import { Appearance } from 'react-native';
import { getSetting, setSetting } from '@/db/queries';
import type { ReaderTheme, ThemeMode } from './bridge';

export const FONT_SIZE_RANGE = [14, 24] as const;
export const LINE_HEIGHT_RANGE = [1.4, 2.2] as const;

/** 与 reader-web/src/style.css 中的变量保持一致，用于原生部分（标题栏、面板、WebView 底色） */
export const PALETTE: Record<ThemeMode, { bg: string; fg: string; muted: string; border: string; accent: string; card: string }> = {
  light: { bg: '#ffffff', fg: '#1f2328', muted: '#656d76', border: '#d8dee4', accent: '#0969da', card: '#f6f8fa' },
  dark: { bg: '#16181d', fg: '#d6d9de', muted: '#8b949e', border: '#30363d', accent: '#58a6ff', card: '#1f232a' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', muted: '#7a6a53', border: '#ddceab', accent: '#8a5a17', card: '#ebe1c8' },
};

export const THEME_LABELS: Record<ThemeMode, string> = { light: '亮色', dark: '暗色', sepia: '护眼' };

const KEY = 'readerTheme';

export async function loadReaderTheme(): Promise<ReaderTheme> {
  const fallback: ReaderTheme = {
    mode: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
    fontSize: 17,
    lineHeight: 1.75,
    wrapCode: false,
  };
  return { ...fallback, ...(await getSetting<Partial<ReaderTheme>>(KEY, {})) };
}

export function saveReaderTheme(theme: ReaderTheme) {
  return setSetting(KEY, theme);
}

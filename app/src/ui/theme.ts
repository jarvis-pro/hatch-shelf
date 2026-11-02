import { useEffect, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { getSetting, setSetting } from '@/db/queries';

/**
 * 「晨雾玻璃」设计 token（design/设计稿.pen 的 v11）。亮色取自设计稿；暗色沿用同一套结构，
 * 底色压暗、玻璃改为低透明度白。界面本身近乎无色，色彩只来自封面和配图。
 */
const light = {
  dark: false,
  bg: '#EEF0F5',
  /** 阅读页底色，比书架更亮一点 */
  paper: '#F6F7FA',
  fg: '#111318',
  fg2: '#4B5060',
  fg3: '#8C92A0',
  fg4: '#B4B9C4',
  /** 正文 */
  body: '#2A2E38',
  /** 卡片里的说明文字 */
  ink: '#2D3550',
  accent: '#2F6BFF',
  accent2: '#6A5CFF',
  accentText: '#1F4FD1',
  accentSoft: '#2F6BFF14',
  onAccent: '#FFFFFF',
  danger: '#E5484D',
  dangerText: '#B42318',
  warn: '#C2410C',
  success: '#22C55E',
  successText: '#14532D',
  teal: '#0E9384',
  highlight: '#8B6BFF',
  highlightSoft: '#8B6BFF24',
  glassTop: '#FFFFFFB8',
  glassBottom: '#FFFFFF70',
  glassStroke: '#FFFFFFD9',
  glassStrong: '#FFFFFFE6',
  /** 卡片内分隔线、轨道底色 */
  hairline: '#1E2A5A10',
  track: '#1E2A5A14',
  fill: '#1E2A5A0A',
  shadow: '#1E2A5A',
  coverShadow: '#2B3A8A',
  dim: '#1E2A5A2E',
  glowA: '#6E9BFF40',
  glowB: '#B28CFF2E',
  glowC: '#FFB8D426',
  blurTint: 'light' as const,
};

export type Theme = Omit<typeof light, 'blurTint'> & { blurTint: 'light' | 'dark' };

const dark: Theme = {
  dark: true,
  bg: '#0A0C11',
  paper: '#0E1015',
  fg: '#F1F3F8',
  fg2: '#A5ABB8',
  fg3: '#6B7180',
  fg4: '#4A505E',
  body: '#D5D9E2',
  ink: '#C3C9D6',
  accent: '#6E9BFF',
  accent2: '#8B7BFF',
  accentText: '#9DBBFF',
  accentSoft: '#6E9BFF1F',
  onAccent: '#FFFFFF',
  danger: '#FF6B6F',
  dangerText: '#FF8A8D',
  warn: '#FB923C',
  success: '#4ADE80',
  successText: '#86EFAC',
  teal: '#2DD4BF',
  highlight: '#A58BFF',
  highlightSoft: '#A58BFF33',
  glassTop: '#FFFFFF1C',
  glassBottom: '#FFFFFF0A',
  glassStroke: '#FFFFFF1F',
  glassStrong: '#1C1F27F2',
  hairline: '#FFFFFF12',
  track: '#FFFFFF1A',
  fill: '#FFFFFF0D',
  shadow: '#000000',
  coverShadow: '#000000',
  dim: '#00000073',
  glowA: '#3E63C440',
  glowB: '#6B4FC433',
  glowC: '#9A4F7A2E',
  blurTint: 'dark',
};

/** 不随外观变化的场景（启动图）用亮色 */
export const LIGHT: Theme = light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/**
 * 铺满父容器的图片。RN 的 Image 在只给 top/left/right/bottom 时会按图片原始尺寸绘制，
 * 必须显式给宽高；父容器不要有 padding，否则百分比按内容区计算。
 */
export const FILL_IMAGE = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' } as const;

/** 数字、英文用的字体；中文走系统的苹方 */
export const MONO = 'Menlo';

// ---------- 外观：亮色 / 暗色 / 跟随系统 ----------

export type AppearanceMode = 'light' | 'dark' | 'system';
export const APPEARANCE_LABELS: Record<AppearanceMode, string> = { light: '亮色', dark: '暗色', system: '跟随系统' };

const KEY = 'appearance';
const listeners = new Set<(m: AppearanceMode) => void>();
let current: AppearanceMode = 'system';

function apply(mode: AppearanceMode) {
  current = mode;
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  listeners.forEach((l) => l(mode));
}

/** 启动时读取设置并应用到整个 App（含阅读器） */
export async function loadAppearance() {
  apply(await getSetting<AppearanceMode>(KEY, 'system'));
}

export async function setAppearance(mode: AppearanceMode) {
  apply(mode);
  await setSetting(KEY, mode);
}

export function useAppearanceMode(): AppearanceMode {
  const [mode, setMode] = useState(current);
  useEffect(() => {
    listeners.add(setMode);
    return () => {
      listeners.delete(setMode);
    };
  }, []);
  return mode;
}

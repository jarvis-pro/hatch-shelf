import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { BookProgress, BookRow } from '@/db/queries';
import { EASE_OUT_CUBIC } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

export const percent = (p: BookProgress) => `${Math.round(p.ratio * 100)}%`;

/** 「12 章 · 已读完」「10 章 · 读到 40%」「16 章 · 未开始」 */
export function bookMeta(book: Pick<BookRow, 'chapterCount'>, p: BookProgress | undefined) {
  const state = !p ? '未开始' : p.finished ? '已读完' : p.ratio < 0.01 ? '刚开始' : `读到 ${percent(p)}`;
  return `${book.chapterCount} 章 · ${state}`;
}

interface BadgeProps {
  progress?: BookProgress;
  /** 04 进度显现：首次进入书架时淡入，百分比从 0 数到当前值 */
  animate?: boolean;
  /** 错开 40ms 的序号 */
  index?: number;
}

/** 封面左下角的进度徽标：读完显示 ✓，读过显示百分比，没读过（或刚打开）不显示 */
export function ProgressBadge({ progress, animate = false, index = 0 }: BadgeProps) {
  const t = useTheme();
  const show = !!progress && (progress.finished || progress.ratio >= 0.01);
  const target = progress ? Math.round(progress.ratio * 100) : 0;
  const [v] = useState(() => new Animated.Value(animate ? 0 : 1));
  const [shown, setShown] = useState(animate ? 0 : target);

  useEffect(() => {
    if (!animate || !show) return;
    const id = v.addListener(({ value }) => setShown(Math.round(value * target)));
    Animated.timing(v, { toValue: 1, duration: 600, delay: Math.min(index, 12) * 40, easing: EASE_OUT_CUBIC, useNativeDriver: false }).start();
    return () => v.removeListener(id);
  }, [animate, show, index, target, v]);

  if (!show) return null;
  return (
    <Animated.View
      style={[styles.badge, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}
    >
      <BlurView intensity={30} tint={t.blurTint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? '#00000059' : '#FFFFFF9E' }]} />
      <Text style={[styles.text, { color: t.fg }]}>{progress.finished ? '✓' : `${animate ? shown : target}%`}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFFFFFCC',
  },
  text: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

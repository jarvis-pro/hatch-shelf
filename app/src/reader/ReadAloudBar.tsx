import { Pause, Play, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '@/ui/glass';
import { EASE_OUT_QUINT, useReduceMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import type { SpeechState } from './speech';

interface Props {
  state: SpeechState;
  rate: number;
  onPause(): void;
  onResume(): void;
  onRate(): void;
  onStop(): void;
}

/** 听书时浮在底部的播放条：暂停 / 继续、语速、停止。只在朗读时出现，平时底部不放任何东西 */
export function ReadAloudBar({ state, rate, onPause, onResume, onRate, onStop }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const visible = state !== 'idle';
  const anim = useState(() => new Animated.Value(visible ? 1 : 0))[0];

  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 220, easing: EASE_OUT_QUINT, useNativeDriver: true }).start();
  }, [anim, visible]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 12, 0] });
  const playing = state === 'playing';
  const PlayIcon = playing ? Pause : Play;

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: insets.bottom + 12, opacity: anim, transform: [{ translateY }] }]}
    >
      <Glass radius={26} strong style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? '暂停' : '继续'}
          hitSlop={6}
          style={[styles.play, { backgroundColor: t.accent }]}
          onPress={playing ? onPause : onResume}
        >
          <PlayIcon size={18} color="#fff" fill="#fff" strokeWidth={2} />
        </Pressable>
        <Text style={[styles.label, { color: t.fg }]}>{playing ? '正在朗读' : '已暂停'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`语速 ${rate} 倍，点按切换`}
          hitSlop={6}
          style={[styles.rate, { backgroundColor: t.fill }]}
          onPress={onRate}
        >
          <Text style={[styles.rateText, { color: t.fg }]}>{rate}×</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="停止听书" hitSlop={8} style={styles.close} onPress={onStop}>
          <X size={18} color={t.fg2} strokeWidth={2} />
        </Pressable>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 6, paddingRight: 10, height: 52 },
  play: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', minWidth: 56 },
  rate: { height: 28, minWidth: 58, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rateText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});

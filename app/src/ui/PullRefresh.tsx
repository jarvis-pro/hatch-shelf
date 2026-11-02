import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, RefreshControl, StyleSheet, Text } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Glass } from './glass';
import { EASE_OUT_CUBIC } from './motion';
import { useTheme } from './theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const HEIGHT = 34;
const R = 7;
const C = 2 * Math.PI * R;
/** 松手即刷新的下拉距离。UIRefreshControl 自带的阈值太深，这里自己判断 */
const TRIGGER = 56;
/** 刷新中旋转短弧的长度（占整圈比例） */
const SPIN_ARC = 0.28;
/** 刷新太快时指示器一闪而过，至少停留这么久 */
const MIN_SPIN_MS = 700;

export type PullPhase = 'idle' | 'armed' | 'refreshing' | 'done';

const LABELS: Record<PullPhase, string> = {
  idle: '下拉刷新',
  armed: '松手刷新',
  refreshing: '正在刷新书架',
  done: '书架已更新',
};

/**
 * 下拉刷新：拉过 TRIGGER 松手即触发；原生 RefreshControl 只负责刷新时把内容停住（隐藏系统菊花），
 * 画面由 PullIndicator 在安全区下方绘制。scrollProps 直接展开到 Animated.ScrollView 上。
 */
export function usePullRefresh(onRefresh: () => Promise<void>) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const [phase, setPhaseState] = useState<PullPhase>('idle');
  const phaseRef = useRef<PullPhase>('idle');
  const dragging = useRef(false);

  const setPhase = useCallback((p: PullPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const refresh = useCallback(async () => {
    if (phaseRef.current === 'refreshing') return;
    setPhase('refreshing');
    const start = Date.now();
    try {
      await onRefresh();
    } finally {
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - start))));
      setPhase('done');
      // 内容回弹到顶部时会切回 idle；用户此时已滚走则靠这里兜底
      setTimeout(() => phaseRef.current === 'done' && setPhase('idle'), 1200);
    }
  }, [onRefresh, setPhase]);

  // SVG 的描边属性不支持原生驱动，滚动值走 JS
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false }),
    [scrollY],
  );

  useEffect(() => {
    const id = scrollY.addListener(({ value: y }) => {
      const p = phaseRef.current;
      if (p === 'done' && y >= -1) setPhase('idle');
      if (!dragging.current || (p !== 'idle' && p !== 'armed')) return;
      const next = y <= -TRIGGER ? 'armed' : 'idle';
      if (next === p) return;
      if (next === 'armed') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhase(next);
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, setPhase]);

  const scrollProps = {
    onScroll,
    scrollEventThrottle: 16,
    onScrollBeginDrag: () => {
      dragging.current = true;
    },
    onScrollEndDrag: () => {
      dragging.current = false;
      if (phaseRef.current === 'armed') void refresh();
    },
    refreshControl: (
      <RefreshControl
        refreshing={phase === 'refreshing'}
        onRefresh={() => void refresh()}
        tintColor="transparent"
        colors={['transparent']}
        progressBackgroundColor="transparent"
      />
    ),
  };

  return { scrollY, phase, scrollProps };
}

/** 玻璃胶囊 + 渐变圆环 + 状态文案：下拉时圆环随距离画满，刷新中收成短弧旋转，完成后合拢。top 传安全区上边距 */
export function PullIndicator({ scrollY, phase, top }: { scrollY: Animated.Value; phase: PullPhase; top: number }) {
  const t = useTheme();
  // hold = 1 时圆环不再跟手，改用 fixed 的长度
  const [hold] = useState(() => new Animated.Value(0));
  const [fixed] = useState(() => new Animated.Value(1));
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (phase === 'idle' || phase === 'armed') {
      hold.setValue(0);
      spin.setValue(0);
      return;
    }
    hold.setValue(1);
    const arc = Animated.timing(fixed, {
      toValue: phase === 'refreshing' ? SPIN_ARC : 1,
      duration: 280,
      easing: EASE_OUT_CUBIC,
      useNativeDriver: false,
    });
    arc.start();
    if (phase !== 'refreshing') return () => arc.stop();
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => {
      arc.stop();
      loop.stop();
    };
  }, [phase, hold, fixed, spin]);

  const pull = scrollY.interpolate({ inputRange: [-1, 0], outputRange: [1, 0], extrapolateLeft: 'extend', extrapolateRight: 'clamp' });
  const progress = pull.interpolate({ inputRange: [8, TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });
  const arc = Animated.add(Animated.multiply(progress, Animated.subtract(1, hold)), Animated.multiply(fixed, hold));
  const active = phase !== 'idle';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          top: top - HEIGHT / 2,
          opacity: pull.interpolate({ inputRange: [10, 40], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [
            // 停在露出的空隙正中间
            { translateY: Animated.multiply(pull, 0.5) },
            { scale: pull.interpolate({ inputRange: [10, 48], outputRange: [0.8, 1], extrapolate: 'clamp' }) },
          ],
        },
      ]}
    >
      <Glass radius={HEIGHT / 2} style={styles.pill}>
        <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
          <Svg width={18} height={18} viewBox="0 0 18 18" style={styles.ring}>
            <Defs>
              <LinearGradient id="pull-ring" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={t.accent} />
                <Stop offset="1" stopColor={t.accent2} />
              </LinearGradient>
            </Defs>
            <Circle cx={9} cy={9} r={R} stroke={t.track} strokeWidth={2} fill="none" />
            <AnimatedCircle
              cx={9}
              cy={9}
              r={R}
              stroke="url(#pull-ring)"
              strokeWidth={2}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${C} ${C}`}
              strokeDashoffset={arc.interpolate({ inputRange: [0, 1], outputRange: [C, 0] })}
            />
          </Svg>
        </Animated.View>
        <Text style={[styles.label, { color: active ? t.fg : t.fg2 }]}>{LABELS[phase]}</Text>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  pill: { height: HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 9, paddingRight: 14 },
  // 弧线从 12 点钟方向起笔
  ring: { transform: [{ rotate: '-90deg' }] },
  label: { fontSize: 13, fontWeight: '500' },
});

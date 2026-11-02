import * as Haptics from 'expo-haptics';
import { createContext, useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * 轻动效（设计稿「轻动效」）：慢、小、可打断。位移 ≤ 12pt，缩放 ≥ 0.96；
 * 系统开启「减弱动态效果」时统一降级为短淡入淡出、无回弹。
 */
export const EASE_OUT_QUINT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_OUT_CUBIC = Easing.bezier(0.33, 1, 0.68, 1);
export const EASE_IN_OUT_CUBIC = Easing.bezier(0.65, 0, 0.35, 1);

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion = v));
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => (reduceMotion = v));

export function useReduceMotion() {
  const [v, setV] = useState(reduceMotion);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setV);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setV);
    return () => sub.remove();
  }, []);
  return v;
}

export const isReduceMotion = () => reduceMotion;

const played = new Set<string>();

/**
 * 只在本次启动第一次进入某个页面时为 true（04 进度显现只播一次）。
 * 首次渲染时取值，之后同一个 key 都返回 false。
 */
export function useFirstEntry(key: string) {
  const [first] = useState(() => !played.has(key) && !reduceMotion);
  useEffect(() => {
    played.add(key);
  }, [key]);
  return first;
}

type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** 按下时的缩放，默认 0.97 */
  scale?: number;
  children: ReactNode;
};

/**
 * 按下程度（0 = 松开，1 = 按下），由 PressScale 提供给里面的封面收紧阴影。
 * 阴影属性不能走原生驱动，所以和缩放分成两个值。
 */
export const PressContext = createContext<Animated.Value | null>(null);

/** 按下缩小、松手回弹（02 封面按压）；长按时给一次轻触感反馈 */
export function PressScale({ style, scale = 0.97, children, onPressIn, onPressOut, onLongPress, ...rest }: PressScaleProps) {
  const v = useState(() => new Animated.Value(1))[0];
  const pressed = useState(() => new Animated.Value(0))[0];
  const to = (down: boolean) => {
    if (reduceMotion) {
      v.setValue(down ? scale : 1);
      pressed.setValue(down ? 1 : 0);
      return;
    }
    const spring = { damping: 18, stiffness: 260, mass: 1 };
    Animated.parallel([
      Animated.spring(v, { ...spring, toValue: down ? scale : 1, useNativeDriver: true }),
      Animated.spring(pressed, { ...spring, toValue: down ? 1 : 0, useNativeDriver: false }),
    ]).start();
  };
  return (
    <Pressable
      {...rest}
      delayLongPress={300}
      onPressIn={(e) => {
        to(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(false);
        onPressOut?.(e);
      }}
      onLongPress={
        onLongPress &&
        ((e) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onLongPress(e);
        })
      }
    >
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>
        <PressContext value={pressed}>{children}</PressContext>
      </Animated.View>
    </Pressable>
  );
}

/** 06 卡片入场：opacity 0→1、y +12→0，按 index 错开 50ms；只在首次挂载时播放 */
export function FadeInUp({ index = 0, style, children }: { index?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const v = useState(() => new Animated.Value(reduceMotion ? 1 : 0))[0];
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(v, {
      toValue: 1,
      duration: 420,
      delay: Math.min(index, 8) * 50,
      easing: EASE_OUT_QUINT,
      useNativeDriver: true,
    }).start();
  }, [v, index]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** 04 进度显现：进度条从 0 生长到当前值，按 index 错开 40ms */
export function ProgressBar({
  value,
  index = 0,
  animate = true,
  height = 4,
  track,
  fill,
  style,
}: {
  value: number;
  index?: number;
  /** false 时直接显示当前值 */
  animate?: boolean;
  height?: number;
  track: string;
  fill: ReactNode | string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useState(() => new Animated.Value(reduceMotion || !animate ? value : 0))[0];
  useEffect(() => {
    if (reduceMotion || !animate) return v.setValue(value);
    Animated.timing(v, {
      toValue: value,
      duration: 600,
      delay: Math.min(index, 8) * 40,
      easing: EASE_OUT_CUBIC,
      useNativeDriver: false,
    }).start();
  }, [v, value, index, animate]);
  const width = v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{ width, height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: typeof fill === 'string' ? fill : undefined }}
      >
        {typeof fill === 'string' ? null : fill}
      </Animated.View>
    </View>
  );
}

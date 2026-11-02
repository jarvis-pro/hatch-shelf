import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
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

type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** 按下时的缩放，默认 0.97 */
  scale?: number;
  children: ReactNode;
};

/** 按下缩小、松手回弹（02 封面按压）；长按时给一次轻触感反馈 */
export function PressScale({ style, scale = 0.97, children, onPressIn, onPressOut, onLongPress, ...rest }: PressScaleProps) {
  const v = useState(() => new Animated.Value(1))[0];
  const to = (toValue: number) =>
    reduceMotion
      ? v.setValue(toValue)
      : Animated.spring(v, { toValue, damping: 18, stiffness: 260, mass: 1, useNativeDriver: true }).start();
  return (
    <Pressable
      {...rest}
      delayLongPress={300}
      onPressIn={(e) => {
        to(scale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
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
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
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
  height = 4,
  track,
  fill,
  style,
}: {
  value: number;
  index?: number;
  height?: number;
  track: string;
  fill: ReactNode | string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useState(() => new Animated.Value(reduceMotion ? value : 0))[0];
  useEffect(() => {
    if (reduceMotion) return v.setValue(value);
    Animated.timing(v, {
      toValue: value,
      duration: 600,
      delay: Math.min(index, 8) * 40,
      easing: EASE_OUT_CUBIC,
      useNativeDriver: false,
    }).start();
  }, [v, value, index]);
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

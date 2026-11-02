import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { EASE_OUT_CUBIC, isReduceMotion } from './motion';
import { useTheme } from './theme';

interface Props {
  visible: boolean;
  /** bottom：底部面板（阅读设置）；left：左侧抽屉（目录） */
  side: 'bottom' | 'left';
  onClose(): void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * 08 面板与抽屉：从底部 / 左侧滑入，背景同步压暗；跟手拖拽，松手按距离和速度决定开合。
 */
export function Panel({ visible, side, onClose, style, children }: Props) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const size = side === 'left' ? Math.min(318, width * 0.82) : height;
  const [mounted, setMounted] = useState(visible);
  /** 0 = 收起，1 = 展开 */
  const open = useState(() => new Animated.Value(0))[0];
  const drag = useState(() => new Animated.Value(0))[0];
  // 手势回调在创建时就固定了；拖拽关闭时先记一次，再由 effect 调用最新的 onClose
  const [dragClosed, setDragClosed] = useState(0);
  const closeFromDrag = useEffectEvent(onClose);
  useEffect(() => {
    if (dragClosed) closeFromDrag();
  }, [dragClosed]);

  // 打开时立即挂载；关闭时等收起动画结束再卸载
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted) return;
    drag.setValue(0);
    // 收起用短的 timing：弹簧要很久才完全静止，期间 Modal 会挡住下面的点击
    const anim =
      isReduceMotion() || !visible
        ? Animated.timing(open, { toValue: visible ? 1 : 0, duration: visible ? 200 : 240, easing: EASE_OUT_CUBIC, useNativeDriver: true })
        : Animated.spring(open, { toValue: 1, damping: 26, stiffness: 280, useNativeDriver: true });
    anim.start(({ finished }) => finished && !visible && setMounted(false));
  }, [visible, mounted, open, drag]);

  const axis = side === 'left' ? 'dx' : 'dy';
  const vAxis = side === 'left' ? 'vx' : 'vy';
  /** 往关闭方向拖为正 */
  const sign = side === 'left' ? -1 : 1;
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g[axis]) > 8 && Math.abs(g[axis]) > Math.abs(g[axis === 'dx' ? 'dy' : 'dx']),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g[axis] * sign)),
      onPanResponderRelease: (_, g) => {
        const d = g[axis] * sign;
        if (d > 120 || g[vAxis] * sign > 0.5) setDragClosed((n) => n + 1);
        else Animated.spring(drag, { toValue: 0, damping: 26, stiffness: 280, useNativeDriver: true }).start();
      },
    }),
  );

  if (!mounted) return null;

  const offscreen = side === 'left' ? -size : 400;
  const slide = Animated.add(open.interpolate({ inputRange: [0, 1], outputRange: [offscreen, 0] }), Animated.multiply(drag, sign));
  const transform = side === 'left' ? [{ translateX: slide }] : [{ translateY: slide }];

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: t.dim, opacity: open }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        pointerEvents={visible ? 'auto' : 'none'}
        style={[side === 'left' ? [styles.left, { width: size }] : styles.bottom, { transform }, style]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  left: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

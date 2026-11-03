import { BlurView } from 'expo-blur';
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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

/** 面板里的列表滚动位置；不在顶部时下滑是在滚列表，不拖面板 */
const ScrollTop = createContext<((y: number) => void) | null>(null);

/**
 * 底部面板里的列表：滚动位置报给 Panel，滚到顶之后再往下拉才拖动面板。
 * 顶部不回弹，免得下拉时列表回弹和面板下移叠在一起
 */
export function PanelScrollView(props: ScrollViewProps) {
  const reportScroll = useContext(ScrollTop);
  // 新打开的列表从顶部开始；列表卸载后面板照常可拖
  useEffect(() => {
    reportScroll?.(0);
    return () => reportScroll?.(0);
  }, [reportScroll]);
  return (
    <ScrollView
      bounces={false}
      scrollEventThrottle={16}
      {...props}
      onScroll={(e) => {
        reportScroll?.(e.nativeEvent.contentOffset.y);
        props.onScroll?.(e);
      }}
    />
  );
}

/**
 * 08 面板与抽屉：从底部 / 左侧滑入，背景同步压暗与轻微模糊；跟手拖拽，松手按距离和速度决定开合。
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
  const [gesture] = useState(() => {
    let scrollY = 0;
    const pan = PanResponder.create({
      // 只接往关闭方向的拖动；面板里的列表没滚到顶时交给列表
      onMoveShouldSetPanResponder: (_, g) =>
        g[axis] * sign > 8 && Math.abs(g[axis]) > Math.abs(g[axis === 'dx' ? 'dy' : 'dx']) && scrollY <= 0,
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g[axis] * sign)),
      onPanResponderRelease: (_, g) => {
        const d = g[axis] * sign;
        if (d > 120 || g[vAxis] * sign > 0.5) setDragClosed((n) => n + 1);
        else Animated.spring(drag, { toValue: 0, damping: 26, stiffness: 280, useNativeDriver: true }).start();
      },
    });
    return { pan, setScrollY: (y: number) => void (scrollY = y) };
  });

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
        {/* 背景压暗的同时轻微模糊 */}
        <BlurView intensity={8} tint={t.blurTint} style={StyleSheet.absoluteFill} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
      </Animated.View>
      <Animated.View
        {...gesture.pan.panHandlers}
        pointerEvents={visible ? 'auto' : 'none'}
        style={[side === 'left' ? [styles.left, { width: size }] : styles.bottom, { transform }, style]}
      >
        <ScrollTop.Provider value={gesture.setScrollY}>{children}</ScrollTop.Provider>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  left: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

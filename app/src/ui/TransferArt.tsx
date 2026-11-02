import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReduceMotion } from '@/ui/motion';
import { FILL_IMAGE } from '@/ui/theme';

const ART = require('../../assets/images/transfer-hero.jpg');
const ART_W = 1584;
const ART_H = 672;

/** 图中光带的中线（原图像素坐标），从笔记本屏幕流向手机 */
const STREAM: [number, number][] = [
  [345, 305], [420, 342], [500, 375], [600, 390], [700, 378], [800, 335], [880, 300],
  [960, 284], [1040, 296], [1120, 335], [1200, 375], [1260, 395], [1305, 392],
];
const STOPS = STREAM.map((_, i) => i / (STREAM.length - 1));

/** 所有动画共用一个时钟；各元素的速度是它的整数倍，保证循环首尾无缝 */
const PERIOD = 16000;

// 固定种子，每次渲染的粒子分布一致
let seed = 7;
const rand = (min: number, max: number) => {
  seed = (seed * 16807) % 2147483647;
  return min + ((seed - 1) / 2147483646) * (max - min);
};

const PARTICLES = Array.from({ length: 22 }, () => ({
  speed: Math.round(rand(3, 6.49)),
  phase: rand(0, 1),
  dy: rand(-7, 7),
  size: rand(1.5, 3),
  alpha: rand(0.55, 1),
}));
const PAGES = [0, 0.34, 0.67].map((phase, i) => ({
  phase,
  dy: -14 - i * 5,
  spin: [-18, 22, -10][i],
}));
const SPARKLES = Array.from({ length: 9 }, () => ({
  at: rand(0.08, 0.92),
  dx: rand(-10, 10),
  dy: rand(-18, 18),
  speed: Math.round(rand(2, 4.49)),
  phase: rand(0, 1),
  size: rand(2, 3.5),
}));

/**
 * 传书页头图：静态底图上叠一层沿光带流动的光点和纸页，整体缓慢推近拉远。
 * 只在页面可见时运行；系统开启「减弱动态效果」时只显示底图。
 */
export function TransferArt() {
  const reduce = useReduceMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const clock = useState(() => new Animated.Value(0))[0];
  const breathe = useState(() => new Animated.Value(0))[0];

  useFocusEffect(
    useCallback(() => {
      if (reduce) return;
      const flow = Animated.loop(Animated.timing(clock, { toValue: 1, duration: PERIOD, easing: Easing.linear, useNativeDriver: true }));
      const zoom = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 1, duration: PERIOD / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 0, duration: PERIOD / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      flow.start();
      zoom.start();
      return () => {
        flow.stop();
        zoom.stop();
      };
    }, [reduce, clock, breathe]),
  );

  const layers = useMemo(() => (box && !reduce ? buildLayers(box.w, box.h, clock) : null), [box, reduce, clock]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setBox((b) => (b?.w === w && b.h === h ? b : { w, h }));
  };

  return (
    <Animated.View
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }]}
    >
      <Image source={ART} style={FILL_IMAGE} resizeMode="cover" />
      {layers}
    </Animated.View>
  );
}

function buildLayers(w: number, h: number, clock: Animated.Value) {
  // 与 resizeMode="cover" 相同的映射：等比放大到铺满，居中裁切
  const s = Math.max(w / ART_W, h / ART_H);
  const ox = (w - ART_W * s) / 2;
  const oy = (h - ART_H * s) / 2;
  const xs = STREAM.map(([x]) => x * s + ox);
  const ys = STREAM.map(([, y]) => y * s + oy);
  const pointAt = (t: number) => {
    const i = Math.min(Math.floor(t * (STREAM.length - 1)), STREAM.length - 2);
    const f = t * (STREAM.length - 1) - i;
    return [xs[i] + (xs[i + 1] - xs[i]) * f, ys[i] + (ys[i + 1] - ys[i]) * f];
  };
  const progress = (speed: number, phase: number) => Animated.modulo(Animated.add(Animated.multiply(clock, speed), phase), 1);
  const along = (p: ReturnType<typeof progress>, size: number, dy: number) => [
    { translateX: p.interpolate({ inputRange: STOPS, outputRange: xs.map((x) => x - size / 2) }) },
    { translateY: p.interpolate({ inputRange: STOPS, outputRange: ys.map((y) => y + dy - size / 2) }) },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {SPARKLES.map((k, i) => {
        const [x, y] = pointAt(k.at);
        const p = progress(k.speed, k.phase);
        return (
          <Animated.View
            key={`s${i}`}
            style={[
              styles.glow,
              {
                left: x + k.dx - k.size,
                top: y + k.dy - k.size,
                width: k.size * 2,
                height: k.size * 2,
                borderRadius: k.size,
                opacity: p.interpolate({ inputRange: [0, 0.15, 0.3, 1], outputRange: [0, 1, 0, 0] }),
                transform: [{ scale: p.interpolate({ inputRange: [0, 0.15, 0.3, 1], outputRange: [0.4, 1, 0.4, 0.4] }) }],
              },
            ]}
          >
            <View style={[styles.core, { width: k.size * 0.8, height: k.size * 0.8, borderRadius: k.size }]} />
          </Animated.View>
        );
      })}
      {PARTICLES.map((k, i) => {
        const p = progress(k.speed, k.phase);
        const d = k.size * 2.4;
        return (
          <Animated.View
            key={`p${i}`}
            style={[
              styles.glow,
              {
                width: d,
                height: d,
                borderRadius: d / 2,
                opacity: p.interpolate({ inputRange: [0, 0.08, 0.88, 1], outputRange: [0, k.alpha, k.alpha, 0] }),
                transform: along(p, d, k.dy),
              },
            ]}
          >
            <View style={[styles.core, { width: k.size, height: k.size, borderRadius: k.size / 2 }]} />
          </Animated.View>
        );
      })}
      {PAGES.map((k, i) => {
        const p = progress(2, k.phase);
        return (
          <Animated.View
            key={`g${i}`}
            style={[
              styles.page,
              {
                opacity: p.interpolate({ inputRange: [0, 0.12, 0.82, 1], outputRange: [0, 0.75, 0.75, 0] }),
                transform: [
                  ...along(p, PAGE_W, k.dy),
                  { perspective: 240 },
                  { rotate: p.interpolate({ inputRange: [0, 1], outputRange: [`${k.spin}deg`, `${-k.spin}deg`] }) },
                  // 纸页翻飞：斜躺着绕竖轴翻转
                  { rotateX: '50deg' },
                  { rotateY: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${k.spin > 0 ? 540 : -540}deg`] }) },
                  { scale: p.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0.6] }) },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const PAGE_W = 15;

const styles = StyleSheet.create({
  glow: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF38' },
  core: { backgroundColor: '#FFF7FC' },
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PAGE_W,
    height: 11,
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF66',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFFFFFCC',
  },
});

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { EASE_IN_CUBIC, EASE_IN_OUT_CUBIC, useReduceMotion } from '@/ui/motion';
import { FILL_IMAGE } from '@/ui/theme';

const ART = require('../../assets/images/transfer-hero.jpg');
const ART_W = 1584;
const ART_H = 672;

/** 光带中线（底图像素坐标），从笔记本屏幕上的光点流向手机屏幕上的光点 */
const STREAM: [number, number][] = [
  [350, 318], [430, 360], [510, 396], [600, 400], [700, 378], [800, 335], [880, 300],
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
/** 光带：[中段散开距离 pt, 线宽, 不透明度]，前两条是柔光，其余是丝线 */
const STRANDS: [number, number, number][] = [
  [0, 18, 0.07], [0, 8, 0.14], [0, 3, 0.3],
  [-6, 0.5, 0.35], [-2.5, 0.9, 0.6], [0, 0.7, 0.85], [3, 0.8, 0.5], [7, 0.5, 0.3],
];
/** 光带整体明暗呼吸 */
const shimmer = (clock: Animated.Value) =>
  Animated.modulo(Animated.multiply(clock, 2), 1).interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1, 0.8] });
const SPARKLES = Array.from({ length: 9 }, () => ({
  at: rand(0.08, 0.92),
  dx: rand(-10, 10),
  dy: rand(-18, 18),
  speed: Math.round(rand(2, 4.49)),
  phase: rand(0, 1),
  size: rand(2, 3.5),
}));

/**
 * 传书页头图。未开启时画面静止，两台设备之间只有一条淡淡的虚线（还没连上）；
 * 开启后光带从电脑画向手机，光点和纸页随后沿光带流动，整体缓慢推近拉远；关闭时光带收回电脑。
 * 动画只在开启且页面可见时运行；系统开启「减弱动态效果」时光带直接出现，没有流动。
 */
export function TransferArt({ live }: { live: boolean }) {
  const reduce = useReduceMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const clock = useState(() => new Animated.Value(0))[0];
  const breathe = useState(() => new Animated.Value(0))[0];
  const link = useState(() => new Animated.Value(live ? 1 : 0))[0];
  // 关闭时等光带收回后再停掉循环
  const [active, setActive] = useState(live);
  if (live && !active) setActive(true);

  useEffect(() => {
    if (reduce) return link.setValue(live ? 1 : 0);
    const anim = Animated.timing(link, {
      toValue: live ? 1 : 0,
      duration: live ? 600 : 360,
      easing: live ? EASE_IN_OUT_CUBIC : EASE_IN_CUBIC,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => finished && !live && setActive(false));
    return () => anim.stop();
  }, [live, reduce, link]);

  useFocusEffect(
    useCallback(() => {
      if (reduce || !active) return;
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
        breathe.setValue(0);
      };
    }, [reduce, active, clock, breathe]),
  );

  const layers = useMemo(() => box && buildLayers(box.w, box.h, clock, link, !reduce), [box, reduce, clock, link]);

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

/** link：0 = 未连接（虚线），1 = 光带完整；flow 为 false 时不画流动的光点和纸页 */
function buildLayers(w: number, h: number, clock: Animated.Value, link: Animated.Value, flow: boolean) {
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

  // 光带丝线：两端收拢在设备上，中段按 spread 散开
  const strand = (spread: number) => {
    const pts = xs.map((x, i) => [x, ys[i] + spread * Math.sin(Math.PI * STOPS[i])] as const);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    return d;
  };

  // 光带从左往右揭开：外层裁切窗口向右推进，内层反向位移让光带本身不动
  const reveal = link.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] });
  const counter = link.interpolate({ inputRange: [0, 1], outputRange: [w, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: link.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
        <Svg width={w} height={h}>
          <Path d={strand(0)} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="0.5 6" strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.clip, { transform: [{ translateX: reveal }] }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: flow ? shimmer(clock) : 1, transform: [{ translateX: counter }] }]}>
          <Svg width={w} height={h}>
            <Defs>
              <LinearGradient id="band" x1={xs[0]} y1={0} x2={xs[xs.length - 1]} y2={0} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                <Stop offset="0.15" stopColor="#FFF4FA" stopOpacity={1} />
                <Stop offset="0.85" stopColor="#FFF4FA" stopOpacity={1} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {STRANDS.map(([spread, width, opacity], i) => (
              <Path key={i} d={strand(spread)} stroke="url(#band)" strokeWidth={width} strokeOpacity={opacity} strokeLinecap="round" fill="none" />
            ))}
          </Svg>
        </Animated.View>
      </Animated.View>
      {flow && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: link.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }) }]}>
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
        </Animated.View>
      )}
    </View>
  );
}

const PAGE_W = 15;

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
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

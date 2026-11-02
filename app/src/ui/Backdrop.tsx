import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { EASE_OUT_QUINT, isReduceMotion, useReduceMotion } from './motion';
import { FILL_IMAGE, useTheme } from './theme';

interface Props {
  /** 页面顶部的晨雾氛围图（书架） */
  art?: ImageSourcePropType;
  /** 模糊后铺在顶部的封面（详情、单本书笔记） */
  cover?: string | null;
  /** 背景光斑；阅读页不放环境动效 */
  glows?: boolean;
}

/** 页面背景：底色 + 顶部配图（淡出到底色）+ 三个缓慢漂移的光斑 */
export function Backdrop({ art, cover, glows = true }: Props) {
  const t = useTheme();
  const clear = `${t.bg}00`;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} pointerEvents="none">
      {art && (
        <View style={styles.art}>
          <Image source={art} style={[FILL_IMAGE, { opacity: t.dark ? 0.32 : 1 }]} resizeMode="cover" />
          <LinearGradient colors={[clear, `${t.bg}33`, t.bg]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        </View>
      )}
      {cover && <CoverArt uri={cover} />}
      {glows && (
        <>
          <Glow color={t.glowA} size={320} x={-80} y={-60} phase={0} />
          <Glow color={t.glowB} size={300} x={200} y={460} phase={0.5} />
          <Glow color={t.glowC} size={260} x={-60} y={620} phase={0.25} />
        </>
      )}
    </View>
  );
}

/** 模糊的封面铺在顶部，从封面取色；进入页面时随封面转场淡入（03） */
function CoverArt({ uri }: { uri: string }) {
  const t = useTheme();
  const [v] = useState(() => new Animated.Value(isReduceMotion() ? 1 : 0));
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 360, easing: EASE_OUT_QUINT, useNativeDriver: true }).start();
  }, [v]);
  return (
    <Animated.View style={[styles.coverArt, { opacity: v }]}>
      <View style={styles.coverImage}>
        <Image source={{ uri }} blurRadius={50} style={[FILL_IMAGE, { opacity: t.dark ? 0.4 : 0.85 }]} resizeMode="cover" />
      </View>
      <LinearGradient colors={[`${t.bg}33`, `${t.bg}99`, t.bg]} locations={[0, 0.4, 0.75]} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** 01 光斑漂移：沿椭圆轨道缓慢移动，周期 24s，振幅 ≤ 40pt */
function Glow({ color, size, x, y, phase }: { color: string; size: number; x: number; y: number; phase: number }) {
  const reduce = useReduceMotion();
  const v = useState(() => new Animated.Value(phase))[0];
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(v, { toValue: phase + 1, duration: 24000, easing: Easing.linear, useNativeDriver: true }),
    );
    v.setValue(phase);
    loop.start();
    return () => loop.stop();
  }, [reduce, v, phase]);
  // 用分段线性近似正弦，取 0/0.25/0.5/0.75/1 五个点画出椭圆
  const range = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const tx = v.interpolate({ inputRange: range, outputRange: [0, 40, 0, -40, 0, 40, 0, -40, 0] });
  const ty = v.interpolate({ inputRange: range, outputRange: [-24, 0, 24, 0, -24, 0, 24, 0, -24] });
  const id = `g${color.slice(1)}`;
  return (
    <Animated.View style={{ position: 'absolute', left: x, top: y, width: size, height: size, transform: [{ translateX: tx }, { translateY: ty }] }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color.slice(0, 7)} stopOpacity={parseInt(color.slice(7, 9) || 'ff', 16) / 255} />
            <Stop offset="1" stopColor={color.slice(0, 7)} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  art: { position: 'absolute', left: 0, right: 0, top: 0, height: 470, overflow: 'hidden' },
  coverArt: { position: 'absolute', left: 0, right: 0, top: 0, height: 620, overflow: 'hidden' },
  coverImage: { position: 'absolute', left: -60, right: -60, top: -80, bottom: 0 },
});

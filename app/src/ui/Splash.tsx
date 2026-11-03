import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Glass } from './glass';
import { EASE_IN_OUT_CUBIC, EASE_OUT_CUBIC, isReduceMotion } from './motion';
import { FILL_IMAGE } from './theme';

const ART = require('../../assets/images/splash-art.jpg');

/** 封面完整展示的最短时间；数据加载更久就继续停留 */
const HOLD_MS = 1200;

/**
 * 07 开场过渡（设计稿「启动 · 淡入淡出」），只在安装后第一次启动时播放：
 * 原生纯色启动图 → 封面淡入（400ms）→ 停留并加载数据 → 与书架交叉淡化（500ms）。轻点可跳过。
 * 封面固定用亮色；原生启动图与书架同底色（之后的冷启动直接从它淡入书架），封面从它上面淡入。
 */
export function Splash({ ready, progress, onDone }: { ready: boolean; progress: Animated.Value; onDone(): void }) {
  const { height } = useWindowDimensions();
  const fadeIn = useState(() => new Animated.Value(0))[0];
  const shownAt = useRef(0);
  const skipped = useRef(false);
  const finishing = useRef(false);

  useEffect(() => {
    void SplashScreen.hideAsync();
    shownAt.current = Date.now();
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: isReduceMotion() ? 0 : 400,
      easing: EASE_OUT_CUBIC,
      useNativeDriver: true,
    }).start();
  }, [fadeIn]);

  const finish = () => {
    if (finishing.current) return;
    finishing.current = true;
    Animated.timing(progress, {
      toValue: 1,
      duration: isReduceMotion() ? 200 : 500,
      easing: EASE_IN_OUT_CUBIC,
      useNativeDriver: true,
    }).start(onDone);
  };

  useEffect(() => {
    if (!ready) return;
    const wait = skipped.current || isReduceMotion() ? 0 : Math.max(0, HOLD_MS + 400 - (Date.now() - shownAt.current));
    const timer = setTimeout(finish, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const opacity = Animated.multiply(fadeIn, progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));
  const scale = fadeIn.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => {
          skipped.current = true;
          if (ready) finish();
        }}
        accessibilityLabel="跳过开场"
      >
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}>
          <Image source={ART} style={FILL_IMAGE} resizeMode="cover" />
        </Animated.View>
        <View style={[styles.cardWrap, { top: (height * 560) / 844 }]}>
          <Glass radius={30} style={styles.card} forceLight>
            <Text style={styles.title}>书巢</Text>
            <View style={styles.rule} />
            <Text style={styles.tagline}>让每本书慢慢发芽</Text>
          </Glass>
        </View>
        <Text style={[styles.imprint, { top: (height * 772) / 844 }]}>Jarvis</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#E9ECF3', zIndex: 10 },
  cardWrap: { position: 'absolute', left: 40, right: 40 },
  card: { height: 155, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#111318', fontSize: 40, fontWeight: '700', letterSpacing: 10, marginRight: -10 },
  rule: { width: 28, height: 2, borderRadius: 1, backgroundColor: '#2F6BFF', marginTop: 10, marginBottom: 10 },
  tagline: { color: '#4B5060', fontSize: 13, letterSpacing: 4, marginRight: -4 },
  imprint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#4B5060',
    fontSize: 24,
    fontFamily: 'Snell Roundhand',
    fontWeight: '600',
  },
});

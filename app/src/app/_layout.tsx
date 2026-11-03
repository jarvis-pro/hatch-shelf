import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { getSetting, setSetting } from '@/db/queries';
import { useIncomingFiles } from '@/import/incoming';
import { bootstrap } from '@/library/bootstrap';
import { notifyLibraryChanged } from '@/library/events';
import { syncIndex } from '@/library/index-books';
import { NoteComposerHost } from '@/notes/NoteComposer';
import { CoverFlightHost, FLIGHT_MS } from '@/ui/CoverFlight';
import { EASE_OUT_CUBIC, isReduceMotion } from '@/ui/motion';
import { Splash } from '@/ui/Splash';
import { loadAppearance, useTheme } from '@/ui/theme';

// 原生启动图（与书架同底色）一直显示到数据就绪，或首次启动时由开场封面接管
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const t = useTheme();
  const [state, setState] = useState<'loading' | 'ready' | Error>('loading');
  /** 开场封面只在安装后第一次启动时播放；之后冷启动由原生启动图直接淡入书架 */
  const [splash, setSplash] = useState(false);
  /** 0 = 封面 / 原生启动图，1 = 书架；淡入时书架同时 scale 0.98→1 */
  const progress = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    getSetting('introPlayed', false)
      .then((played) => {
        if (!played) setSplash(true);
        return bootstrap();
      })
      .then(loadAppearance)
      .then(
        () => {
          setState('ready');
          // 书架先用已有索引显示，再在后台对账外部增删的书
          syncIndex().then(
            (changed) => changed && notifyLibraryChanged(),
            (e: Error) => console.warn('[index] 对账失败', e),
          );
        },
        (e: Error) => setState(e),
      );
  }, []);

  useEffect(() => {
    if (state === 'loading' || splash) return;
    void SplashScreen.hideAsync();
    Animated.timing(progress, { toValue: 1, duration: 200, easing: EASE_OUT_CUBIC, useNativeDriver: true }).start();
  }, [state, splash, progress]);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      {state === 'ready' && (
        <Animated.View
          style={[
            styles.flex,
            { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] },
          ]}
        >
          <AppStack />
        </Animated.View>
      )}
      {state instanceof Error && (
        <View style={[styles.flex, styles.center]}>
          <Text style={{ color: t.danger, padding: 24 }}>启动失败：{state.message}</Text>
        </View>
      )}
      {splash && (
        <Splash
          ready={state !== 'loading'}
          progress={progress}
          onDone={() => {
            setSplash(false);
            void setSetting('introPlayed', true);
          }}
        />
      )}
      <StatusBar style={splash ? 'dark' : 'auto'} />
    </View>
  );
}

function AppStack() {
  const t = useTheme();
  useIncomingFiles();
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" />
        {/* iOS 的 fade 默认 500ms，进搜索页会显得拖沓；200ms 与键盘弹起同步 */}
        <Stack.Screen name="search" options={{ animation: 'fade', animationDuration: 200 }} />
        <Stack.Screen
          name="peek/[id]"
          options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
        <Stack.Screen name="read/[id]" options={{ contentStyle: { backgroundColor: t.paper } }} />
        {/* 封面飞行时页面本身只做淡入淡出 */}
        <Stack.Screen name="book/[id]" options={{ animation: 'fade', animationDuration: isReduceMotion() ? 200 : FLIGHT_MS }} />
      </Stack>
      <NoteComposerHost />
      <CoverFlightHost />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});

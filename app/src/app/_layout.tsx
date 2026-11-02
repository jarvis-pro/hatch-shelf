import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useIncomingFiles } from '@/import/incoming';
import { bootstrap } from '@/library/bootstrap';
import { NoteComposerHost } from '@/notes/NoteComposer';
import { Splash } from '@/ui/Splash';
import { loadAppearance, useTheme } from '@/ui/theme';

// 原生启动图（纯色）一直显示到 JS 的封面接管
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const t = useTheme();
  const [state, setState] = useState<'loading' | 'ready' | Error>('loading');
  const [splash, setSplash] = useState(true);
  /** 0 = 封面，1 = 书架；交叉淡化时书架同时 scale 0.98→1 */
  const progress = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    bootstrap()
      .then(loadAppearance)
      .then(
        () => setState('ready'),
        (e: Error) => setState(e),
      );
  }, []);

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
        <Splash ready={state !== 'loading'} progress={progress} onDone={() => setSplash(false)} />
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
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen
          name="peek/[id]"
          options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
        <Stack.Screen name="read/[id]" options={{ contentStyle: { backgroundColor: t.paper } }} />
      </Stack>
      <NoteComposerHost />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});

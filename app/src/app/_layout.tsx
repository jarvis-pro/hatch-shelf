import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useIncomingFiles } from '@/import/incoming';
import { bootstrap } from '@/library/bootstrap';
import { useShelfColors } from '@/shelf/colors';

export default function RootLayout() {
  const c = useShelfColors();
  const [state, setState] = useState<'loading' | 'ready' | Error>('loading');

  useEffect(() => {
    bootstrap().then(
      () => setState('ready'),
      (e: Error) => setState(e),
    );
  }, []);

  if (state !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {state === 'loading' ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ color: c.danger, padding: 24 }}>启动失败：{state.message}</Text>
        )}
      </View>
    );
  }

  return <AppStack />;
}

function AppStack() {
  const c = useShelfColors();
  useIncomingFiles();
  return (
    <>
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '书架', headerLargeTitle: true, headerTransparent: false }} />
        <Stack.Screen name="read/[id]" options={{ title: '' }} />
        <Stack.Screen name="book/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="transfer" options={{ title: '局域网传书' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

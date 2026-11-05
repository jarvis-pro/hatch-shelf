import { parsePairing } from '@shelf/spec';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { pairAndReceive } from '@/receive/store';
import { Backdrop } from '@/ui/Backdrop';
import { PrimaryButton } from '@/ui/glass';
import { useTheme } from '@/ui/theme';

/**
 * 用 iPhone 相机扫 Dock 的二维码（`shelf://pair?k=…&name=…`）打开 App 时到这里：
 * 记下这台电脑，直接进入接收页，不另弹配对提示。
 */
export default function PairScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ k?: string; name?: string }>();
  const pairing = parsePairing(params);
  const handled = useRef(false);

  useEffect(() => {
    if (!pairing || handled.current) return;
    handled.current = true;
    void pairAndReceive(pairing).then(() => router.replace('/receive'));
  }, [pairing]);

  if (pairing) return <View style={[styles.flex, { backgroundColor: t.bg }]} />;
  return (
    <View style={[styles.flex, styles.center]}>
      <Backdrop />
      <Text style={{ color: t.fg, fontSize: 17, fontWeight: '700' }}>二维码无法识别</Text>
      <Text style={{ color: t.fg3, fontSize: 13 }}>请在 Dock 里重新点「连接手机」生成二维码</Text>
      <PrimaryButton label="回到书架" onPress={() => router.replace('/')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
});

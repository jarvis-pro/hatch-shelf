import { parsePairing } from '@shelf/spec';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { CameraOff, Settings2, Smartphone, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pairAndReceive } from '@/receive/store';
import { Backdrop } from '@/ui/Backdrop';
import { GlassButton, PrimaryButton } from '@/ui/glass';
import { useTheme } from '@/ui/theme';

const FRAME = 264;

/** 二维码内容是 `shelf://pair?…`（开发版 shelf-dev://），只认 pair 链接 */
function pairingFrom(data: string) {
  const m = data.match(/^[a-z-]+:\/\/pair\?(.*)$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  return parsePairing({ k: q.get('k') ?? undefined, name: q.get('name') ?? undefined });
}

/**
 * App 内扫码配对（设计稿 A1 / A2）：还没配对时点「从电脑接收」，或在设置里点「配对新电脑」进入。
 * 扫到后轻震一下，直接进接收页。
 */
export default function ScanScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [found, setFound] = useState(false);
  const handled = useRef(false);

  // 同一时间只能有一个相机预览：离开这一页就卸载
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const denied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <View style={[styles.flex, { backgroundColor: denied ? t.bg : '#000' }]}>
      {denied && <Backdrop />}
      {permission?.granted && focused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current) return;
            const pairing = pairingFrom(data);
            if (!pairing) return;
            handled.current = true;
            setFound(true);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            void pairAndReceive(pairing).then(() => router.replace('/receive'));
          }}
        />
      )}
      <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
        <GlassButton icon={X} label="关闭" onPress={() => router.back()} />
        <Text style={{ color: denied ? t.fg : '#fff', fontSize: 17, fontWeight: '700' }}>连接电脑</Text>
        <View style={{ width: 40 }} />
      </View>

      {denied ? (
        <View style={styles.denied}>
          <View style={[styles.deniedIcon, { backgroundColor: t.accentSoft }]}>
            <CameraOff size={26} color={t.accent} />
          </View>
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '700' }}>需要相机权限才能扫码</Text>
          <Text style={{ color: t.fg3, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>书巢只用相机识别这一张二维码，不拍照，也不保存画面</Text>
          <PrimaryButton icon={Settings2} label="去设置开启相机" onPress={() => void Linking.openSettings()} style={{ alignSelf: 'stretch', marginTop: 12 }} />
          <Text style={{ color: t.fg3, fontSize: 12, marginTop: 4 }}>也可以用 iPhone 相机扫 Dock 上的二维码</Text>
        </View>
      ) : (
        <View style={styles.middle}>
          <Text style={styles.title}>扫描 Dock 上的二维码</Text>
          <Text style={styles.sub}>在电脑上打开 Dock，点右上角「连接手机」</Text>
          <View style={[styles.frame, { borderColor: found ? t.success : '#FFFFFFD9' }]} />
          <View style={styles.hint}>
            <Smartphone size={13} color="#FFFFFFB3" />
            <Text style={{ color: '#FFFFFFB3', fontSize: 12 }}>也可以用 iPhone 相机扫码，会自动打开书巢</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 80 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { color: '#FFFFFFB3', fontSize: 13, marginBottom: 28 },
  frame: { width: FRAME, height: FRAME, borderRadius: 28, borderWidth: 3 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 36 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingBottom: 80 },
  deniedIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
});

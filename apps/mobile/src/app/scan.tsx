import { parsePairing } from '@shelf/spec';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Camera, CameraOff, Flashlight, Settings2, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pairAndReceive } from '@/receive/store';
import { Backdrop } from '@/ui/Backdrop';
import { GlassButton, PrimaryButton } from '@/ui/glass';
import { isReduceMotion, PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

const FRAME = 250;
const CORNER = 34;
const LINE = 202;

/** 二维码内容是 `shelf://pair?…`（开发版 shelf-dev://），只认 pair 链接 */
function pairingFrom(data: string) {
  const m = data.match(/^[a-z-]+:\/\/pair\?(.*)$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  return parsePairing({ k: q.get('k') ?? undefined, name: q.get('name') ?? undefined });
}

/**
 * App 内扫码配对（设计稿 A1 / A2）：还没配对时点「从电脑接收」，或在设置里点「配对新电脑」进入。
 * 扫到后取景框变绿、轻震一下，直接进接收页。
 */
export default function ScanScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [found, setFound] = useState(false);
  const [torch, setTorch] = useState(false);
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

  if (denied) {
    return (
      <View style={[styles.flex, { backgroundColor: t.bg }]}>
        <Backdrop />
        <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
          <GlassButton icon={X} label="关闭" onPress={() => router.back()} />
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '700' }}>连接电脑</Text>
          <View style={styles.spacer} />
        </View>
        <View style={styles.denied}>
          <View style={[styles.deniedIcon, { backgroundColor: t.accentSoft }]}>
            <CameraOff size={28} color={t.accent} />
          </View>
          <Text style={{ color: t.fg, fontSize: 16, fontWeight: '600' }}>需要相机权限才能扫码</Text>
          <Text style={{ color: t.fg3, fontSize: 12, textAlign: 'center' }}>书巢只用相机识别二维码，不拍照，也不保存画面</Text>
          <PrimaryButton icon={Settings2} label="去设置开启相机" onPress={() => void Linking.openSettings()} style={styles.settingsBtn} />
          <Text style={{ color: t.fg3, fontSize: 12 }}>或用 iPhone 相机扫 Dock 上的二维码</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: '#0B0D12' }]}>
      {permission?.granted && focused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
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
        <DarkButton icon={X} label="关闭" size={40} onPress={() => router.back()} />
        <Text style={styles.headTitle}>连接电脑</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.hint}>
        <Text style={styles.title}>扫描 Dock 上的二维码</Text>
        <Text style={styles.sub}>在电脑上打开 Dock，点右上角「连接手机」</Text>
      </View>

      <View style={styles.viewfinderWrap} pointerEvents="none">
        <Viewfinder color={found ? t.success : '#FFFFFF'} scanning={!found} />
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.torch}>
          <DarkButton icon={Flashlight} label={torch ? '关闭照明' : '轻点照亮'} size={56} active={torch} onPress={() => setTorch((v) => !v)} />
          <Text style={styles.torchText}>{torch ? '轻点关闭' : '轻点照亮'}</Text>
        </View>
        <View style={styles.tip}>
          <Camera size={14} color="#FFFFFFB3" />
          <Text style={{ color: '#FFFFFFCC', fontSize: 12 }}>也可以用 iPhone 相机扫，会自动打开书巢</Text>
        </View>
      </View>
    </View>
  );
}

/** 相机画面上的深色玻璃圆按钮（关闭、手电筒） */
function DarkButton({ icon: Icon, label, size, active, onPress }: { icon: LucideIcon; label: string; size: number; active?: boolean; onPress(): void }) {
  return (
    <PressScale onPress={onPress} scale={0.92} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <View style={[styles.darkBtn, { width: size, height: size, borderRadius: size / 2 }, active && { backgroundColor: '#FFFFFFE6' }]}>
        {!active && <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />}
        <Icon size={Math.round(size * 0.39)} color={active ? '#111318' : '#fff'} />
      </View>
    </PressScale>
  );
}

/** 取景框：四个圆角折角，中间一条上下扫动的光线 */
function Viewfinder({ color, scanning }: { color: string; scanning: boolean }) {
  const y = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (!scanning || isReduceMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, y]);
  const corners = [
    { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 22 },
    { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 22 },
    { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 22 },
    { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 22 },
  ];
  return (
    <View style={styles.frame}>
      {corners.map((c, i) => (
        <View key={i} style={[styles.corner, { borderColor: color }, c]} />
      ))}
      {scanning && (
        <Animated.View style={[styles.scan, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME - 88] }) }] }]}>
          <LinearGradient colors={['#6E9BFF00', '#6E9BFF40']} style={styles.scanGlow} />
          <LinearGradient colors={['#6E9BFF00', '#B7CCFF', '#6E9BFF00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.scanLine} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  spacer: { width: 40 },
  headTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  hint: { alignItems: 'center', gap: 8, marginTop: 88 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { color: '#FFFFFFB3', fontSize: 13 },
  viewfinderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  scan: { position: 'absolute', top: 24, left: (FRAME - LINE) / 2, width: LINE, height: 42 },
  scanGlow: { height: 40 },
  scanLine: { height: 2, borderRadius: 1, shadowColor: '#6E9BFF', shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  bottom: { alignItems: 'center', gap: 22, paddingHorizontal: 20 },
  torch: { alignItems: 'center', gap: 8 },
  torchText: { color: '#FFFFFFB3', fontSize: 12 },
  darkBtn: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#FFFFFF1F', borderWidth: 1, borderColor: '#FFFFFF33' },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#FFFFFF14' },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingBottom: 60 },
  deniedIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  settingsBtn: { width: 220, marginTop: 18, marginBottom: 4 },
});

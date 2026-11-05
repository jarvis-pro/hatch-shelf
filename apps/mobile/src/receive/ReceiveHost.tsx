import { useKeepAwake } from 'expo-keep-awake';
import { router, usePathname } from 'expo-router';
import { Laptop, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { EASE_OUT_CUBIC, isReduceMotion } from '@/ui/motion';
import { progressOf, stopReceiving, useReceive, type ReceiveState } from './store';

const RING = 26;
const STROKE = 2.5;

/**
 * 挂在 App 根部、所有导航之上（设计稿「E · 离开接收页」）：接收模式开着时保持屏幕常亮；
 * 离开接收页后在顶部挂一个胶囊显示进度，点它回到接收页，点 × 结束接收。胶囊和接收页互斥。
 * Dock 请求推送时如果不在接收页，直接打开接收页让人确认。
 */
export function ReceiveHost() {
  const s = useReceive();
  const path = usePathname();
  const onPage = path === '/receive';
  const on = s.phase !== 'off';

  useEffect(() => {
    if (s.phase === 'confirm' && !onPage) router.push('/receive');
  }, [s.phase, onPage]);

  return (
    <>
      {on && <KeepAwake />}
      <Pill s={s} visible={on && !onPage && path !== '/scan' && path !== '/pair'} />
    </>
  );
}

function KeepAwake() {
  useKeepAwake('receive');
  return null;
}

function Pill({ s, visible }: { s: ReceiveState; visible: boolean }) {
  const insets = useSafeAreaInsets();
  const v = useState(() => new Animated.Value(0))[0];
  const [shown, setShown] = useState(visible);
  if (visible && !shown) setShown(true);
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: visible ? 1 : 0, duration: isReduceMotion() ? 0 : 220, easing: EASE_OUT_CUBIC, useNativeDriver: true });
    anim.start(({ finished }) => finished && !visible && setShown(false));
    return () => anim.stop();
  }, [visible, v]);
  if (!shown) return null;

  const { index, total } = progressOf(s);
  const [title, sub] =
    s.phase === 'receiving'
      ? [`接收中 · 第 ${index} / ${total} 本`, s.current?.item ? `${s.current.item.title}${/\.audio\./.test(s.current.name ?? '') ? ' · 原声' : ''}` : '等下一本']
      : s.phase === 'done'
        ? ['接收完成', `${s.countdown} 秒后结束`]
        : s.phase === 'confirm'
          ? ['电脑请求推送', '点开确认']
          : ['接收中 · 等待推送', s.peer?.name ?? '在 Dock 里勾选书后推送'];
  // 进度环：已收完的本数加上当前这本的上传进度
  const ratio = s.phase === 'done' ? 1 : total ? Math.min(1, (index - 1 + (s.current?.ratio ?? 0)) / total) : 0;
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top: insets.top + 4, left: insets.left + 20, right: insets.right + 20, opacity: v },
        { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
      ]}
    >
      <Pressable onPress={() => router.push('/receive')} style={styles.pill} accessibilityRole="button" accessibilityLabel="回到接收页">
        <View style={styles.ring}>
          <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke="#FFFFFF26" strokeWidth={STROKE} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={r}
              stroke="#4ADE80"
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${c * ratio} ${c}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
          <Laptop size={12} color="#fff" />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Pressable onPress={stopReceiving} hitSlop={8} style={styles.close} accessibilityRole="button" accessibilityLabel="结束接收">
          <X size={13} color="#fff" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    minWidth: 200,
    maxWidth: 300,
    paddingLeft: 8,
    paddingRight: 6,
    borderRadius: 20,
    backgroundColor: '#111318EB',
    shadowColor: '#1E2A5A',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  text: { flexShrink: 1, flexGrow: 1 },
  title: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sub: { color: '#FFFFFF99', fontSize: 10 },
  close: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF1F', alignItems: 'center', justifyContent: 'center' },
});

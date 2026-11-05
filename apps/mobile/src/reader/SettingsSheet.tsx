import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Segmented, Toggle } from '@/ui/glass';
import { Panel } from '@/ui/Panel';
import { useTheme } from '@/ui/theme';
import { FONT_SIZES, LINE_HEIGHTS, lineHeightLabel, type ReaderPrefs } from './theme';

interface Props {
  visible: boolean;
  prefs: ReaderPrefs;
  onChange(prefs: ReaderPrefs): void;
  onClose(): void;
}

/** 阅读设置：字号、行距、代码换行。明暗跟随 App 外观，在设置页调整 */
export function SettingsSheet({ visible, prefs, onChange, onClose }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const set = (patch: Partial<ReaderPrefs>) => onChange({ ...prefs, ...patch });
  const lh = LINE_HEIGHTS.find((o) => o.label === lineHeightLabel(prefs.lineHeight))!;

  return (
    <Panel visible={visible} side="bottom" onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, shadowColor: t.shadow }]}>
        <View style={[StyleSheet.absoluteFill, styles.clip]}>
          <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={t.dark ? ['#1C1F27F2', '#16181FE6'] : ['#FFFFFFE6', '#FFFFFFCC']} style={StyleSheet.absoluteFill} />
        </View>
        <View style={[styles.grabber, { backgroundColor: t.dark ? '#FFFFFF33' : '#1E2A5A26' }]} />

        <View style={styles.group}>
          <Text style={[styles.label, { color: t.fg3 }]}>字号</Text>
          <View style={[styles.fontRow, { backgroundColor: t.fill }]}>
            <Text style={{ color: t.fg2, fontSize: 13 }}>A</Text>
            <FontSlider value={prefs.fontSize} onChange={(fontSize) => set({ fontSize })} />
            <Text style={{ color: t.fg2, fontSize: 20 }}>A</Text>
          </View>
        </View>

        <View style={styles.group}>
          <Text style={[styles.label, { color: t.fg3 }]}>行距</Text>
          <Segmented
            options={LINE_HEIGHTS.map((o) => ({ value: o.label, label: o.label }))}
            value={lh.label}
            onChange={(label) => set({ lineHeight: LINE_HEIGHTS.find((o) => o.label === label)!.value })}
          />
        </View>

        <View style={styles.toggle}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: t.fg, fontSize: 14, fontWeight: '500' }}>代码块自动换行</Text>
            <Text style={{ color: t.fg3, fontSize: 12 }}>关闭时代码块横向滚动</Text>
          </View>
          <Toggle value={prefs.wrapCode} onChange={(wrapCode) => set({ wrapCode })} />
        </View>
      </View>
    </Panel>
  );
}

/** 六档刻度的字号滑杆，点按或拖动都会吸附到最近的刻度 */
function FontSlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const steps = FONT_SIZES.length - 1;
  const nearest = FONT_SIZES.reduce((best, s, i) => (Math.abs(s - value) < Math.abs(FONT_SIZES[best] - value) ? i : best), 0);
  const pick = (x: number) => {
    if (!width) return;
    const i = Math.round(Math.min(1, Math.max(0, x / width)) * steps);
    if (FONT_SIZES[i] !== value) onChange(FONT_SIZES[i]);
  };
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // 抢在面板的下拉关闭手势之前
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
    onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
  });
  const x = width * (nearest / steps);
  return (
    <View style={styles.slider} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: t.dark ? '#FFFFFF1F' : '#1E2A5A1A' }]} />
      <View pointerEvents="none" style={[styles.fill, { width: x, backgroundColor: t.accent }]} />
      {FONT_SIZES.map((s, i) => (
        <View key={s} pointerEvents="none" style={[styles.tick, { left: (width - 4) * (i / steps) }]} />
      ))}
      <View pointerEvents="none" style={[styles.knob, { left: Math.max(0, x - 10), shadowColor: t.shadow }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 10,
    paddingHorizontal: 20,
    gap: 22,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -8 },
  },
  clip: { borderTopLeftRadius: 34, borderTopRightRadius: 34, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3 },
  group: { gap: 10 },
  label: { fontSize: 12, fontWeight: '500' },
  fontRow: { height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  slider: { flex: 1, height: 28, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  tick: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  knob: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
});

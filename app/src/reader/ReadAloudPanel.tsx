import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { AudioLines, ChevronRight, Gauge, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_OUT_QUINT, useReduceMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { VOICE_TIER_LABELS, type SpeechState, type VoiceOption } from './speech';

interface Props {
  state: SpeechState;
  chapterNo: number;
  chapterTitle: string;
  /** 正在读的段落下标，从 0 开始 */
  index: number;
  total: number;
  /** 正在读的段落被手动滚出屏幕，顶部显示「从这里读」 */
  away: boolean;
  rate: number;
  voice: VoiceOption | undefined;
  onPause(): void;
  onResume(): void;
  onSeek(index: number): void;
  onReadHere(): void;
  onRate(): void;
  onVoice(): void;
  onStop(): void;
}

/**
 * 听书时从屏幕底部升起的播放面板（README 第 8 节）：章节名、段落进度（可拖动跳段）、
 * 语速 / 上一段 / 播放 / 下一段 / 语音。听书不要求沉浸，正文让出底部；不朗读时不占位置
 */
export function ReadAloudPanel(props: Props) {
  const { state, chapterNo, chapterTitle, index, total, away, rate, voice } = props;
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const visible = state !== 'idle';
  const anim = useState(() => new Animated.Value(visible ? 1 : 0))[0];
  const [height, setHeight] = useState(240);

  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 280, easing: EASE_OUT_QUINT, useNativeDriver: true }).start();
  }, [anim, visible]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : height, 0] });
  const playing = state === 'playing';
  const PlayIcon = playing ? Pause : Play;
  const tier = voice && VOICE_TIER_LABELS[voice.tier];

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        { paddingBottom: insets.bottom + 12, shadowColor: t.shadow, opacity: reduceMotion ? anim : 1, transform: [{ translateY }] },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={t.dark ? ['#1C1F27F2', '#16181FE6'] : ['#FFFFFFF2', '#FFFFFFE0']} style={StyleSheet.absoluteFill} />
      </View>

      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.kicker, { color: t.fg3 }]}>
            {playing ? '正在朗读' : '已暂停'} · 第 {chapterNo} 章
          </Text>
          <Text style={[styles.title, { color: t.fg }]} numberOfLines={1}>
            {chapterTitle}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="停止听书"
          hitSlop={8}
          style={[styles.close, { backgroundColor: t.fill }]}
          onPress={props.onStop}
        >
          <X size={16} color={t.fg2} strokeWidth={2} />
        </Pressable>
      </View>

      {away && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="从屏幕上第一段接着读"
          style={[styles.here, { backgroundColor: t.accentSoft }]}
          onPress={props.onReadHere}
        >
          <AudioLines size={16} color={t.accent} strokeWidth={2} />
          <Text style={[styles.hereText, { color: t.accent }]}>从这里读</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.hereHint, { color: t.accent }]}>从屏幕上第一段接着读</Text>
          <ChevronRight size={14} color={t.accent} strokeWidth={2} />
        </Pressable>
      )}

      <Progress index={index} total={total} onSeek={props.onSeek} />

      <View style={styles.controls}>
        <View style={styles.side}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`语速 ${rate} 倍，点按切换`}
            hitSlop={6}
            style={[styles.chip, { backgroundColor: t.fill }]}
            onPress={props.onRate}
          >
            <Gauge size={14} color={t.fg2} strokeWidth={2} />
            <Text style={[styles.rateText, { color: t.fg }]}>{rate}×</Text>
          </Pressable>
        </View>
        <View style={styles.center}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="上一段"
            disabled={index <= 0}
            hitSlop={6}
            style={[styles.skip, index <= 0 && styles.disabled]}
            onPress={() => props.onSeek(index - 1)}
          >
            <SkipBack size={22} color={t.fg} strokeWidth={1.8} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? '暂停' : '继续'}
            style={[styles.play, { backgroundColor: t.accent, shadowColor: t.accent }]}
            onPress={playing ? props.onPause : props.onResume}
          >
            <PlayIcon size={22} color="#fff" fill="#fff" strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="下一段"
            disabled={index >= total - 1}
            hitSlop={6}
            style={[styles.skip, index >= total - 1 && styles.disabled]}
            onPress={() => props.onSeek(index + 1)}
          >
            <SkipForward size={22} color={t.fg} strokeWidth={1.8} />
          </Pressable>
        </View>
        <View style={[styles.side, styles.end]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`语音 ${voice ? `${voice.name}${tier ? `，${tier}` : ''}` : '系统语音'}，点按选择`}
            hitSlop={6}
            style={[styles.chip, styles.voice, { backgroundColor: t.fill }]}
            onPress={props.onVoice}
          >
            <Text style={[styles.voiceText, { color: t.fg }]} numberOfLines={1}>
              {voice?.name ?? '系统语音'}
            </Text>
            <ChevronRight size={14} color={t.fg3} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

/** 段落进度：拖动时只预览段号，松手才跳过去，免得一路拖过的段落都被读一遍 */
function Progress({ index, total, onSeek }: { index: number; total: number; onSeek(index: number): void }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const last = Math.max(0, total - 1);
  const at = (x: number) => (width && last ? Math.round(Math.min(1, Math.max(0, x / width)) * last) : 0);
  const shown = preview ?? index;
  const ratio = last ? shown / last : 0;
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => total > 1,
    onMoveShouldSetPanResponder: () => total > 1,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => setPreview(at(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => setPreview(at(e.nativeEvent.locationX)),
    onPanResponderRelease: (e) => {
      const to = at(e.nativeEvent.locationX);
      setPreview(null);
      if (to !== index) onSeek(to);
    },
    onPanResponderTerminate: () => setPreview(null),
  });
  const x = width * ratio;

  return (
    <View style={{ gap: 8 }}>
      <View
        style={styles.slider}
        accessibilityRole="adjustable"
        accessibilityLabel="朗读进度"
        accessibilityValue={{ text: `第 ${index + 1} 段，共 ${total} 段` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onSeek(index + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        <View pointerEvents="none" style={[styles.track, { backgroundColor: t.dark ? '#FFFFFF1F' : '#1E2A5A1A' }]} />
        <View pointerEvents="none" style={[styles.fill, { width: x, backgroundColor: t.accent }]} />
        <View
          pointerEvents="none"
          style={[styles.knob, preview !== null && styles.knobActive, { left: Math.max(0, x - 8), shadowColor: t.shadow }]}
        />
      </View>
      <View style={styles.labels}>
        <Text style={[styles.label, { color: preview !== null ? t.accent : t.fg3 }]}>第 {total ? shown + 1 : 0} 段</Text>
        <Text style={[styles.label, { color: t.fg3 }]}>共 {total} 段</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 18,
    paddingHorizontal: 20,
    gap: 18,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -8 },
  },
  clip: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kicker: { fontSize: 11, fontWeight: '500' },
  title: { fontSize: 16, fontWeight: '600' },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  here: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 14, paddingHorizontal: 14 },
  hereText: { fontSize: 14, fontWeight: '600' },
  hereHint: { fontSize: 12 },
  slider: { height: 24, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  knob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  knobActive: { transform: [{ scale: 1.25 }] },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 11, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, flexDirection: 'row' },
  end: { justifyContent: 'flex-end' },
  center: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  rateText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  voice: { paddingLeft: 12, paddingRight: 8, gap: 2, maxWidth: 96 },
  voiceText: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  skip: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
  },
});

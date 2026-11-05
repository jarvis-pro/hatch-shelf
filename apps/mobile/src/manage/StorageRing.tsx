import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { splitBytes } from '@/library/size-format';
import { EASE_IN_OUT_CUBIC, EASE_OUT_CUBIC, isReduceMotion, useReduceMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

/**
 * 书籍管理页的占用圆环（设计稿「统计占用动画（选定）」）：
 * 统计中一段彗星弧绕灰色轨道旋转；每统计完一个分类，对应色段从 12 点方向顺时针扫入；
 * 全部扫入后整环轻弹一次，中心落定为总数。
 */

const SIZE = 108;
const STROKE = SIZE * 0.1;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const GAP_DEG = 3;
const SWEEP_MS = 360;
const SPIN_MS = 1400;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface RingSegment {
  key: string;
  color: string;
  bytes: number;
}

/**
 * 色段的扫入队列：ready 是已经统计完的分类数，按顺序一段接一段扫入（每段 360ms），
 * 统计得再快也不会一闪而过。instant 时（读缓存）直接全部显示。revealed 为已开始扫入的段数，
 * 页面据此同步显示图例和分组里的数字。
 */
export function useRingSweep(ready: number, instant: boolean) {
  const [startFull] = useState(instant);
  const [values] = useState<Animated.Value[]>(() => []);
  const value = useCallback((i: number) => (values[i] ??= new Animated.Value(startFull ? 1 : 0)), [values, startFull]);
  /** 已经扫完的段数；读缓存时一开始就全部完成 */
  const [done, setDone] = useState(instant ? Number.POSITIVE_INFINITY : 0);
  const started = useRef(-1);

  useEffect(() => {
    if (done >= ready || started.current >= done) return;
    const i = done;
    started.current = i;
    Animated.timing(value(i), {
      toValue: 1,
      duration: isReduceMotion() ? 0 : SWEEP_MS,
      easing: EASE_OUT_CUBIC,
      useNativeDriver: false,
    }).start(() => setDone(i + 1));
  }, [done, ready, value]);

  const sweeping = done < ready;
  return { revealed: sweeping ? done + 1 : done, value, sweeping };
}

interface Props {
  segments: RingSegment[];
  sweep: ReturnType<typeof useRingSweep>;
  /** 统计和扫入都结束 */
  settled: boolean;
  measured: number;
  total: number;
}

export function StorageRing({ segments, sweep, settled, measured, total }: Props) {
  const t = useTheme();
  const reduce = useReduceMotion();
  const spin = useState(() => new Animated.Value(0))[0];
  const bump = useState(() => new Animated.Value(1))[0];
  const wasSettled = useRef(settled);

  useEffect(() => {
    if (settled || reduce) return;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: SPIN_MS, easing: EASE_IN_OUT_CUBIC, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [settled, reduce, spin]);

  // 最后一段扫入后整环 1 → 1.03 → 1 轻弹一次；读缓存直接显示时不弹
  useEffect(() => {
    if (settled && !wasSettled.current && !reduce) {
      Animated.sequence([
        Animated.timing(bump, { toValue: 1.03, duration: 120, easing: EASE_OUT_CUBIC, useNativeDriver: true }),
        Animated.spring(bump, { toValue: 1, damping: 12, stiffness: 220, useNativeDriver: true }),
      ]).start();
    }
    wasSettled.current = settled;
  }, [settled, reduce, bump]);

  const totalBytes = segments.reduce((s, x) => s + x.bytes, 0);
  const shownBytes = segments.slice(0, sweep.revealed).reduce((s, x) => s + x.bytes, 0);
  const gap = segments.length > 1 ? GAP_DEG : 0;

  const degs = segments.map((seg) => (totalBytes > 0 ? (seg.bytes / totalBytes) * 360 : 0));
  const arcs = segments.map((seg, i) => ({
    seg,
    i,
    start: degs.slice(0, i).reduce((s, d) => s + d, 0),
    len: (Math.max(degs[i] - gap, 0.5) / 360) * CIRC,
  }));

  const counting = sweep.revealed === 0 && !settled;
  const { value, unit } = splitBytes(shownBytes);

  return (
    <Animated.View style={[styles.ring, { transform: [{ scale: bump }] }]} accessibilityLabel={settled ? `书籍共占用 ${value} ${unit}` : '正在统计书籍占用'}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={t.track} strokeWidth={STROKE} fill="none" />
      </Svg>
      {!settled && !reduce && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}
        >
          <Comet color={t.accent} />
        </Animated.View>
      )}
      {/* 色段画在彗星上面：彗星只在还空着的轨道上露出来 */}
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {arcs.map(({ seg, i, start: s, len }) => (
          <AnimatedCircle
            key={seg.key}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={seg.color}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={[len, CIRC]}
            strokeDashoffset={sweep.value(i).interpolate({ inputRange: [0, 1], outputRange: [len, 0] })}
            transform={`rotate(${-90 + s} ${SIZE / 2} ${SIZE / 2})`}
          />
        ))}
      </Svg>
      <View style={styles.center}>
        {counting ? (
          <>
            <Text style={[styles.counting, { color: t.accent }]}>统计中</Text>
            <Text style={[styles.sub, { color: t.fg3 }]}>
              {measured} / {total}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.value, { color: t.fg, opacity: settled ? 1 : 0.7 }]}>{value}</Text>
            <Text style={[styles.sub, { color: t.fg3 }]}>{settled ? `${unit} · ${total} 本` : unit}</Text>
          </>
        )}
      </View>
    </Animated.View>
  );
}

/** 彗星：12 点方向的一小段实色弧，后面拖一段淡色尾巴 */
function Comet({ color }: { color: string }) {
  const head = (14 / 360) * CIRC;
  const tail = (50 / 360) * CIRC;
  const c = SIZE / 2;
  return (
    <Svg width={SIZE} height={SIZE}>
      <Circle cx={c} cy={c} r={R} stroke={`${color}33`} strokeWidth={STROKE} fill="none" strokeDasharray={[tail, CIRC]} transform={`rotate(${-90 - 50} ${c} ${c})`} />
      <Circle cx={c} cy={c} r={R} stroke={color} strokeWidth={STROKE} fill="none" strokeDasharray={[head, CIRC]} transform={`rotate(${-90 - 14} ${c} ${c})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  ring: { width: SIZE, height: SIZE },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 1 },
  counting: { fontSize: 15, fontWeight: '600' },
  value: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  sub: { fontSize: 11 },
});


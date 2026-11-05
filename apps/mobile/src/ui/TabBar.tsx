import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname, type Href } from 'expo-router';
import { LibraryBig, NotebookPen, Settings2, type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './glass';
import { isReduceMotion } from './motion';
import { useTheme } from './theme';

const TABS: { href: Href & string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: '书架', icon: LibraryBig },
  { href: '/notes', label: '笔记', icon: NotebookPen },
  { href: '/settings', label: '设置', icon: Settings2 },
];

/** Tab 栏占的高度，页面内容底部要留出这么多 */
export const TAB_BAR_SPACE = 110;

const BAR_H = 62;
const PAD = 5;
const SLIDER_H = BAR_H - PAD * 2; // 52
const CAP = SLIDER_H / 2; // 两头半圆的半径 26

/**
 * 弹簧参数，照 hatch-counter 移动端的页签胶囊（`design/移动端/动效/页签胶囊.html`）：
 * 朝目标那一侧的边先拉过去（刚度 2400、阻尼比 0.95），离目标剩四分之一格就放后沿去追（阻尼比 0.78，追上时略冲过一点）；
 * 拉长一格上下扁 10%，高另走一根形状弹簧（阻尼 30），收回原长时弹一下
 */
const K = 2400;
const Z_LEAD = 0.95;
const Z_TRAIL = 0.78;
const SQUASH = 0.1;
const WOBBLE = 30;
const SUBSTEPS = 4;
/** 减弱动态效果时不拉伸，滑块在新位置淡入 */
const REDUCED_FADE_MS = 150;

function spring(x: number, v: number, target: number, k: number, zeta: number, dt: number): [number, number] {
  const nv = v + (k * (target - x) - 2 * Math.sqrt(k) * zeta * v) * dt;
  return [x + nv * dt, nv];
}

/** 模拟每帧把数 setValue 进来，界面只认这些 Animated.Value */
interface SliderValues {
  leftX: Animated.Value;
  rightX: Animated.Value;
  midX: Animated.Value;
  midScale: Animated.Value;
  hScale: Animated.Value;
  fade: Animated.Value;
  /** 每格被滑块盖住多少（0–1），字色和图标颜色跟着渐变 */
  cover: Animated.Value[];
}

function makeValues(): SliderValues {
  return {
    leftX: new Animated.Value(0),
    rightX: new Animated.Value(0),
    midX: new Animated.Value(0),
    midScale: new Animated.Value(1),
    hScale: new Animated.Value(1),
    fade: new Animated.Value(1),
    cover: TABS.map(() => new Animated.Value(0)),
  };
}

/**
 * 滑块的弹簧：左右两条边各走各的，后沿什么时候放、高往哪儿弹都要看两条边眼下在哪儿，
 * Animated.spring 接不上这种互相看的弹簧，所以自己积分（每帧四小步）。
 * 每帧要改状态又不能让 React 重画，放在组件外的对象里；只有「过半换粗」变了才回调。
 */
class SliderSim {
  L = 0;
  R = 0;
  vL = 0;
  vR = 0;
  tL = 0;
  tR = 0;
  h = 1;
  vh = 0;
  dir: 1 | -1 = 1;
  active: number;
  phase: 'rest' | 'lead' | 'follow' = 'rest';
  private W = 0;
  private raf: number | null = null;
  private last = 0;

  constructor(
    private readonly v: SliderValues,
    active: number,
    private readonly onBold: (idx: number[]) => void,
  ) {
    this.active = active;
  }

  setWidth(W: number) {
    this.W = W;
  }

  private x(i: number) {
    return i * this.W;
  }

  /**
   * 滑块是左半圆 + 中间一段 + 右半圆三块，中间那段横着拉、两个半圆跟着平移，扁的时候三块一起缩高，
   * 两头始终是正半圆；全走 transform，不用每帧重新排版
   */
  private paint() {
    const { v, W } = this;
    const s = this.h;
    const len = Math.max(this.R - this.L, CAP * 2 * s);
    // 半圆绕自己的中点缩放，左沿会往里收 CAP/2·(1−s)，平移时补回来
    v.leftX.setValue(this.L - (CAP / 2) * (1 - s));
    v.rightX.setValue(this.L + len - CAP + (CAP / 2) * (1 - s));
    // 缩到 0 时变换矩阵不可逆，可能不画；留一丝
    v.midScale.setValue(Math.max(0.0001, len - CAP * 2 * s) / 100);
    v.midX.setValue(this.L + len / 2 - 50);
    v.hScale.setValue(s);
    const bold: number[] = [];
    TABS.forEach((_, i) => {
      const k = W > 0 ? Math.max(0, Math.min(this.R, this.x(i) + W) - Math.max(this.L, this.x(i))) / W : 0;
      v.cover[i].setValue(k);
      if (k > 0.5) bold.push(i);
    });
    this.onBold(bold);
  }

  private step(dt: number) {
    const w = this.W;
    const a = this.x(this.active);
    if (this.phase === 'lead') {
      const lead = this.dir > 0 ? this.R : this.L;
      const target = this.dir > 0 ? a + w : a;
      if (Math.abs(target - lead) < w / 4) {
        this.phase = 'follow';
        if (this.dir > 0) this.tL = a;
        else this.tR = a + w;
      }
    }
    const leadIsR = this.dir > 0;
    [this.L, this.vL] = spring(this.L, this.vL, this.tL, K, leadIsR ? Z_TRAIL : Z_LEAD, dt);
    [this.R, this.vR] = spring(this.R, this.vR, this.tR, K, leadIsR ? Z_LEAD : Z_TRAIL, dt);
    // 扁多少只看拉长了多少：多出一格就扁到头，跨三格也不会压成一条线
    const stretch = Math.min(1, Math.max(0, (this.R - this.L - w) / w));
    [this.h, this.vh] = spring(this.h, this.vh, 1 - SQUASH * stretch, K, WOBBLE / (2 * Math.sqrt(K)), dt);
    if (
      this.phase === 'follow' &&
      Math.abs(this.tL - this.L) < 0.3 &&
      Math.abs(this.tR - this.R) < 0.3 &&
      Math.abs(this.vL) + Math.abs(this.vR) < 2 &&
      Math.abs(this.h - 1) < 0.002 &&
      Math.abs(this.vh) < 0.02
    ) {
      this.phase = 'rest';
      this.L = this.tL;
      this.R = this.tR;
      this.vL = this.vR = this.vh = 0;
      this.h = 1;
    }
  }

  private frame = (now: number) => {
    // 一帧最多算 50ms：从后台回来那一帧的 dt 有好几秒，弹簧会直接炸开
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (let i = 0; i < SUBSTEPS; i++) this.step(dt / SUBSTEPS);
    this.paint();
    this.raf = this.phase === 'rest' ? null : requestAnimationFrame(this.frame);
  };

  /** 停在第 i 格，不动画 */
  snap(i: number) {
    this.stop();
    this.active = i;
    this.L = this.tL = this.x(i);
    this.R = this.tR = this.x(i) + this.W;
    this.vL = this.vR = this.vh = 0;
    this.h = 1;
    this.phase = 'rest';
    this.paint();
  }

  go(i: number) {
    const w = this.W;
    if (i === this.active || w <= 0) return;
    if (isReduceMotion()) {
      this.snap(i);
      this.v.fade.setValue(0);
      Animated.timing(this.v.fade, { toValue: 1, duration: REDUCED_FADE_MS, useNativeDriver: true }).start();
      return;
    }
    this.active = i;
    const a = this.x(i);
    const b = a + w;
    // 方向按滑块眼下的中点算，连点时从半路转向也对
    this.dir = a + w / 2 > (this.L + this.R) / 2 ? 1 : -1;
    this.phase = 'lead';
    // 后沿先原地站住：正往同一边走就走完那段但不越过新目标，往反方向走的就地刹住
    if (this.dir > 0) {
      this.tR = b;
      this.tL = Math.min(a, Math.max(this.L, this.tL));
    } else {
      this.tL = a;
      this.tR = Math.max(b, Math.min(this.R, this.tR));
    }
    if (this.raf == null) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  stop() {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}

/** 悬浮的玻璃 Tab 栏；选中态是一块白色胶囊，切换时两条边分别弹过去、拉长时略扁（动效同 hatch-counter 移动端页签胶囊） */
export function TabBar() {
  const t = useTheme();
  const pathname = usePathname();
  const index = Math.max(0, TABS.findIndex((tab) => tab.href === pathname));
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const tabWidth = width / TABS.length;

  const [bold, setBold] = useState<number[]>([index]);
  const [v] = useState(makeValues);
  const [sim] = useState(() => new SliderSim(v, index, (next) => setBold((prev) => (prev.join() === next.join() ? prev : next))));

  // 量到宽度时直接停到当前那格；切 Tab 走下面那条
  useEffect(() => {
    sim.setWidth(tabWidth);
    if (tabWidth > 0) sim.snap(sim.active);
  }, [sim, tabWidth]);

  // 点 Tab 或代码里跳转，滑块都跟过去
  useEffect(() => {
    sim.go(index);
  }, [sim, index]);

  useEffect(() => () => sim.stop(), [sim]);

  const { leftX, rightX, midX, midScale, hScale, fade, cover } = v;
  const colors = useMemo(
    () => cover.map((c) => c.interpolate({ inputRange: [0, 1], outputRange: [t.fg3, t.accent], extrapolate: 'clamp' })),
    [cover, t.fg3, t.accent],
  );
  const piece = { position: 'absolute' as const, top: 0, left: 0, height: SLIDER_H, backgroundColor: t.dark ? '#FFFFFF1F' : '#FFFFFFE6' };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom - 8, 12) }]} pointerEvents="box-none">
      <LinearGradient colors={[`${t.bg}00`, `${t.bg}CC`]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Glass radius={31} style={styles.bar}>
        <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {tabWidth > 0 && (
            // 不加投影：三块拼成的形状每帧都在变，iOS 没法缓存阴影路径，动画时会掉帧
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
              <Animated.View style={[piece, styles.capL, { width: CAP, transform: [{ translateX: leftX }, { scale: hScale }] }]} />
              <Animated.View style={[piece, { width: 100, transform: [{ translateX: midX }, { scaleX: midScale }, { scaleY: hScale }] }]} />
              <Animated.View style={[piece, styles.capR, { width: CAP, transform: [{ translateX: rightX }, { scale: hScale }] }]} />
            </Animated.View>
          )}
          {TABS.map((tab, i) => (
              <Pressable
                key={tab.href}
                style={styles.tab}
                onPress={() => {
                  if (i === index) return;
                  sim.go(i);
                  router.navigate(tab.href);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: i === index }}
                accessibilityLabel={tab.label}
              >
                <View style={styles.icon}>
                  <tab.icon size={20} color={t.fg3} strokeWidth={1.8} />
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: cover[i] }]}>
                    <tab.icon size={20} color={t.accent} strokeWidth={2.2} />
                  </Animated.View>
                </View>
                <Animated.Text style={{ color: colors[i], fontSize: 12, fontWeight: bold.includes(i) ? '600' : '400' }}>{tab.label}</Animated.Text>
              </Pressable>
          ))}
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 8 },
  bar: { height: BAR_H, padding: PAD },
  row: { flex: 1, flexDirection: 'row' },
  capL: { borderTopLeftRadius: CAP, borderBottomLeftRadius: CAP },
  capR: { borderTopRightRadius: CAP, borderBottomRightRadius: CAP },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  icon: { width: 20, height: 20 },
});

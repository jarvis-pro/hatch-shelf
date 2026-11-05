import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { PressScale } from './motion';
import { LIGHT, useTheme } from './theme';

interface GlassProps {
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** 外阴影；默认用于浮在背景上的卡片 */
  shadow?: boolean;
  /** 更不透明的玻璃，用于面板、菜单 */
  strong?: boolean;
  /** 固定用亮色玻璃 */
  forceLight?: boolean;
  children?: ReactNode;
}

/** 磨砂玻璃：背景模糊 + 自上而下的白色渐变 + 高光描边 */
export function Glass({ radius = 22, style, shadow = true, strong, forceLight, children }: GlassProps) {
  const theme = useTheme();
  const t = forceLight ? LIGHT : theme;
  return (
    <View
      style={[
        { borderRadius: radius },
        shadow && {
          shadowColor: t.shadow,
          shadowOpacity: t.dark ? 0.35 : 0.07,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 12 },
        },
        style,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
        <BlurView intensity={strong ? 60 : 40} tint={t.blurTint} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={strong ? [t.glassStrong, t.glassStrong] : [t.glassTop, t.glassBottom]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.glassStroke },
          ]}
        />
      </View>
      {children}
    </View>
  );
}

/** 40×40 的圆形玻璃按钮 */
export function GlassButton({ icon: Icon, onPress, label }: { icon: LucideIcon; onPress(): void; label: string }) {
  const t = useTheme();
  return (
    <PressScale onPress={onPress} scale={0.92} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Glass radius={20} style={styles.btn}>
        <Icon size={18} color={t.fg} strokeWidth={2} />
      </Glass>
    </PressScale>
  );
}

/** 带文字的玻璃胶囊按钮（导出、停止） */
export function GlassPill({ icon: Icon, label, color, onPress }: { icon: LucideIcon; label: string; color?: string; onPress(): void }) {
  const t = useTheme();
  const c = color ?? t.fg;
  return (
    <PressScale onPress={onPress} scale={0.95} accessibilityRole="button">
      <Glass radius={20} style={styles.pill}>
        <Icon size={16} color={c} strokeWidth={2} />
        <Text style={{ color: c, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      </Glass>
    </PressScale>
  );
}

/** 主操作按钮：蓝紫渐变胶囊 */
export function PrimaryButton({ icon: Icon, label, onPress, style }: { icon?: LucideIcon; label: string; onPress(): void; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <PressScale onPress={onPress} style={[styles.primaryShadow, { shadowColor: t.accent }, style]} accessibilityRole="button">
      <LinearGradient colors={[t.accent, t.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primary}>
        {Icon && <Icon size={18} color="#fff" strokeWidth={2} />}
        <Text style={styles.primaryText}>{label}</Text>
      </LinearGradient>
    </PressScale>
  );
}

/** 分段选择器：选中项是一块白色胶囊 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  height = 40,
  fontSize = 13,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(v: T): void;
  height?: number;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const pad = height > 34 ? 4 : 3;
  return (
    <View style={[styles.segment, { height, borderRadius: height / 2, padding: pad, backgroundColor: t.fill }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[
              styles.segmentItem,
              { borderRadius: (height - pad * 2) / 2 },
              on && {
                backgroundColor: t.dark ? '#FFFFFF24' : '#FFFFFF',
                shadowColor: t.shadow,
                shadowOpacity: 0.08,
                shadowRadius: 3,
                shadowOffset: { width: 0, height: 2 },
              },
            ]}
          >
            <Text style={{ color: on ? t.fg : t.fg3, fontSize, fontWeight: on ? '600' : '400' }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  const t = useTheme();
  // RN 的 iOS Switch 默认 alignSelf: 'flex-start'，会盖掉父级的 alignItems: 'center'
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: t.accent, false: t.track }}
      style={styles.toggle}
    />
  );
}

const styles = StyleSheet.create({
  toggle: { alignSelf: 'center' },
  btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pill: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  primaryShadow: { shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 12 }, borderRadius: 27 },
  primary: {
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: '#FFFFFF40',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  segment: { flexDirection: 'row' },
  segmentItem: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});

import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { ReaderTheme, ThemeMode } from './bridge';
import { FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, PALETTE, THEME_LABELS } from './theme';

interface Props {
  visible: boolean;
  palette: (typeof PALETTE)[ThemeMode];
  theme: ReaderTheme;
  onChange(theme: ReaderTheme): void;
  onClose(): void;
}

const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, v));

export function SettingsSheet({ visible, palette, theme, onChange, onClose }: Props) {
  const set = (patch: Partial<ReaderTheme>) => onChange({ ...theme, ...patch });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panel, { backgroundColor: palette.bg, borderColor: palette.border }]}>
        <Row label="主题" palette={palette}>
          <View style={styles.segment}>
            {(Object.keys(THEME_LABELS) as ThemeMode[]).map((mode) => (
              <Pressable
                key={mode}
                onPress={() => set({ mode })}
                style={[
                  styles.swatch,
                  { backgroundColor: PALETTE[mode].bg, borderColor: theme.mode === mode ? palette.accent : palette.border },
                ]}
              >
                <Text style={{ color: PALETTE[mode].fg, fontSize: 13 }}>{THEME_LABELS[mode]}</Text>
              </Pressable>
            ))}
          </View>
        </Row>
        <Row label="字号" palette={palette}>
          <Stepper
            palette={palette}
            value={String(theme.fontSize)}
            onMinus={() => set({ fontSize: clamp(theme.fontSize - 1, FONT_SIZE_RANGE) })}
            onPlus={() => set({ fontSize: clamp(theme.fontSize + 1, FONT_SIZE_RANGE) })}
          />
        </Row>
        <Row label="行距" palette={palette}>
          <Stepper
            palette={palette}
            value={theme.lineHeight.toFixed(2)}
            onMinus={() => set({ lineHeight: clamp(+(theme.lineHeight - 0.1).toFixed(2), LINE_HEIGHT_RANGE) })}
            onPlus={() => set({ lineHeight: clamp(+(theme.lineHeight + 0.1).toFixed(2), LINE_HEIGHT_RANGE) })}
          />
        </Row>
        <Row label="代码自动换行" palette={palette}>
          <Switch value={theme.wrapCode} onValueChange={(wrapCode) => set({ wrapCode })} />
        </Row>
      </View>
    </Modal>
  );
}

function Row({ label, palette, children }: { label: string; palette: Props['palette']; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={{ color: palette.fg, fontSize: 15 }}>{label}</Text>
      {children}
    </View>
  );
}

function Stepper({ palette, value, onMinus, onPlus }: { palette: Props['palette']; value: string; onMinus(): void; onPlus(): void }) {
  const btn = [styles.stepBtn, { borderColor: palette.border }];
  return (
    <View style={styles.stepper}>
      <Pressable style={btn} onPress={onMinus}>
        <Text style={{ color: palette.fg, fontSize: 18 }}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: palette.fg }]}>{value}</Text>
      <Pressable style={btn} onPress={onPlus}>
        <Text style={{ color: palette.fg, fontSize: 18 }}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  segment: { flexDirection: 'row', gap: 8 },
  swatch: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 36, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 40, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

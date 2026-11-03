import Constants from 'expo-constants';
import {
  ChevronRight,
  FolderInput,
  Info,
  RefreshCcw,
  ShieldCheck,
  SunMoon,
  TextWrap,
  Type,
  type LucideIcon,
} from 'lucide-react-native';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickAndImport } from '@/import/incoming';
import { rebuildIndex } from '@/library/index-books';
import { SettingsSheet } from '@/reader/SettingsSheet';
import { lineHeightLabel, loadReaderPrefs, onReaderPrefsChange, saveReaderPrefs, type ReaderPrefs } from '@/reader/theme';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, Segmented, Toggle } from '@/ui/glass';
import { PageHeader } from '@/ui/PageHeader';
import { TAB_BAR_SPACE } from '@/ui/TabBar';
import { APPEARANCE_LABELS, setAppearance, useAppearanceMode, useTheme, type AppearanceMode } from '@/ui/theme';

export default function SettingsTab() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const appearance = useAppearanceMode();
  const [prefs, setPrefs] = useState<ReaderPrefs | null>(null);
  const [sheet, setSheet] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    void loadReaderPrefs().then(setPrefs);
    return onReaderPrefsChange(setPrefs);
  }, []);

  const changePrefs = (next: ReaderPrefs) => {
    setPrefs(next);
    void saveReaderPrefs(next);
  };

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await rebuildIndex();
      Alert.alert('索引已重建', '已重新扫描全部书籍，阅读进度和笔记不受影响。');
    } catch (e) {
      Alert.alert('重建失败', (e as Error).message);
    } finally {
      setRebuilding(false);
    }
  };

  const version = Constants.expoConfig?.version ?? '';
  const build = Constants.expoConfig?.ios?.buildNumber;

  return (
    <View style={styles.flex}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: TAB_BAR_SPACE + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="设置" />

        <Group title="外观与阅读">
          <Row icon={SunMoon} label="外观">
            <Segmented<AppearanceMode>
              options={(['light', 'dark', 'system'] as const).map((m) => ({ value: m, label: APPEARANCE_LABELS[m] }))}
              value={appearance}
              onChange={(m) => void setAppearance(m)}
              height={32}
              fontSize={12}
              style={{ flexShrink: 0 }}
            />
          </Row>
          <Row
            icon={Type}
            label="字号与行距"
            value={prefs ? `${prefs.fontSize} · ${lineHeightLabel(prefs.lineHeight)}` : undefined}
            onPress={() => setSheet(true)}
          />
          <Row icon={TextWrap} label="代码块自动换行">
            {prefs && <Toggle value={prefs.wrapCode} onChange={(wrapCode) => changePrefs({ ...prefs, wrapCode })} />}
          </Row>
        </Group>

        <Group title="书库">
          <Row icon={FolderInput} label="从「文件」导入" onPress={() => void pickAndImport()} />
          <Row icon={RefreshCcw} label="重建索引" onPress={rebuilding ? undefined : () => void rebuild()}>
            {rebuilding && <ActivityIndicator size="small" color={t.fg3} />}
          </Row>
        </Group>

        <Group title="关于">
          <Row icon={ShieldCheck} label="离线运行" value="不发起任何网络请求" />
          <Row icon={Info} label="版本" value={build ? `${version} (${build})` : version} />
        </Group>
      </ScrollView>
      {prefs && <SettingsSheet visible={sheet} prefs={prefs} onChange={changePrefs} onClose={() => setSheet(false)} />}
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color: t.fg3 }]}>{title}</Text>
      <Glass radius={22} style={styles.card}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={[styles.sep, { backgroundColor: t.hairline }]} />}
            {row}
          </Fragment>
        ))}
      </Glass>
    </View>
  );
}

function Row({ icon: Icon, label, value, onPress, children }: { icon: LucideIcon; label: string; value?: string; onPress?(): void; children?: ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.fill }]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={[styles.icon, { backgroundColor: t.accentSoft }]}>
        <Icon size={15} color={t.accent} />
      </View>
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
      {value && (
        <Text style={{ color: t.fg3, fontSize: 14 }} numberOfLines={1}>
          {value}
        </Text>
      )}
      {children}
      {onPress && !children && <ChevronRight size={15} color={t.fg4} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 22 },
  group: { gap: 8 },
  groupTitle: { fontSize: 12, fontWeight: '500', paddingLeft: 4 },
  card: { paddingVertical: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 58 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 54 },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 15 },
});

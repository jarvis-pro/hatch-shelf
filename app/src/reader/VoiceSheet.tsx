import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Download } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Panel, PanelScrollView } from '@/ui/Panel';
import { useTheme } from '@/ui/theme';
import { VOICE_LANGUAGES, VOICE_TIER_LABELS, type VoiceOption, type VoiceTier } from './speech';

interface Props {
  visible: boolean;
  voices: VoiceOption[];
  /** null 为自动 */
  voiceId: string | null;
  onChoose(id: string | null): void;
  onClose(): void;
}

/** 朗读语音：自动，或按普通话 / 台湾国语 / 粤语挑设备上的系统语音。选完不关面板，方便挨个试听 */
export function VoiceSheet({ visible, voices, voiceId, onChoose, onClose }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const groups = VOICE_LANGUAGES.map((l) => ({ ...l, voices: voices.filter((v) => v.language === l.language) })).filter(
    (g) => g.voices.length > 0,
  );
  // 选中的语音被删掉后按自动处理
  const selected = voices.some((v) => v.id === voiceId) ? voiceId : null;

  return (
    <Panel visible={visible} side="bottom" onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, shadowColor: t.shadow }]}>
        <View style={[StyleSheet.absoluteFill, styles.clip]}>
          <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={t.dark ? ['#1C1F27F2', '#16181FE6'] : ['#FFFFFFE6', '#FFFFFFCC']} style={StyleSheet.absoluteFill} />
        </View>
        <View style={[styles.grabber, { backgroundColor: t.dark ? '#FFFFFF33' : '#1E2A5A26' }]} />

        <View style={{ gap: 4 }}>
          <Text style={[styles.title, { color: t.fg }]}>朗读语音</Text>
          <Text style={[styles.hint, { color: t.fg3 }]}>选中后从当前段落用新语音接着读</Text>
        </View>

        <PanelScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={styles.groups} showsVerticalScrollIndicator={false}>
          <View style={[styles.list, { backgroundColor: t.fill }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selected === null }}
              style={styles.autoRow}
              onPress={() => onChoose(null)}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.name, { color: selected === null ? t.accent : t.fg }, selected === null && styles.bold]}>
                  自动
                </Text>
                <Text style={[styles.hint, { color: t.fg3 }]}>用设备上音质最好的普通话语音</Text>
              </View>
              {selected === null && <Check size={18} color={t.accent} strokeWidth={2.2} />}
            </Pressable>
          </View>

          {groups.map((g) => (
            <View key={g.language} style={{ gap: 8 }}>
              <Text style={[styles.label, { color: t.fg3 }]}>{g.label}</Text>
              <View style={[styles.list, { backgroundColor: t.fill }]}>
                {g.voices.map((v, i) => (
                  <VoiceRow
                    key={v.id}
                    voice={v}
                    selected={v.id === selected}
                    divider={i < g.voices.length - 1}
                    onPress={() => onChoose(v.id)}
                  />
                ))}
              </View>
            </View>
          ))}
        </PanelScrollView>

        <View style={styles.footer}>
          <Download size={14} color={t.fg3} strokeWidth={2} style={{ marginTop: 2 }} />
          <Text style={[styles.hint, styles.footerText, { color: t.fg3 }]}>
            更多语音可在 设置 → 辅助功能 → 朗读内容 → 声音 里下载，增强版和高音质更自然；下载完回到这里就能选
          </Text>
        </View>
      </View>
    </Panel>
  );
}

function VoiceRow({ voice, selected, divider, onPress }: { voice: VoiceOption; selected: boolean; divider: boolean; onPress(): void }) {
  const t = useTheme();
  const tag = VOICE_TIER_LABELS[voice.tier];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tag ? `${voice.name}，${tag}` : voice.name}
      accessibilityState={{ selected }}
      style={[styles.row, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.dark ? '#FFFFFF1A' : '#1E2A5A1A' }]}
      onPress={onPress}
    >
      <Text style={[styles.name, { color: selected ? t.accent : t.fg }, selected && styles.bold]}>{voice.name}</Text>
      {tag && <TierTag tier={voice.tier} label={tag} />}
      <View style={{ flex: 1 }} />
      {selected && <Check size={18} color={t.accent} strokeWidth={2.2} />}
    </Pressable>
  );
}

function TierTag({ tier, label }: { tier: VoiceTier; label: string }) {
  const t = useTheme();
  const premium = tier === 'premium';
  return (
    <View style={[styles.tag, { backgroundColor: premium ? `${t.accent}1F` : t.fill }]}>
      <Text style={[styles.tagText, { color: premium ? t.accent : t.fg2 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 10,
    paddingHorizontal: 20,
    gap: 18,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -8 },
  },
  clip: { borderTopLeftRadius: 34, borderTopRightRadius: 34, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3 },
  title: { fontSize: 17, fontWeight: '600' },
  hint: { fontSize: 12 },
  groups: { gap: 18 },
  label: { fontSize: 12, fontWeight: '500' },
  list: { borderRadius: 16, overflow: 'hidden' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 16 },
  name: { fontSize: 15 },
  bold: { fontWeight: '600' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: '500' },
  footer: { flexDirection: 'row', gap: 6 },
  footerText: { flex: 1, lineHeight: 18 },
});

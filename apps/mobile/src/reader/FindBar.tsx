import { ChevronDown, ChevronUp, CircleX, Search, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Glass } from '@/ui/glass';
import { useTheme } from '@/ui/theme';

export interface FindState {
  query: string;
  /** 从 1 开始；没有匹配时为 0 */
  index: number;
  total: number;
}

interface Props {
  /** 阅读器回报的最新结果；查找词与输入框不一致时视为还没算完 */
  result: FindState | null;
  onQuery(query: string): void;
  onStep(delta: 1 | -1): void;
  onClose(): void;
}

/** 输入停顿多久后再让阅读器重新标亮，避免每敲一个字整章重排一次 */
const DEBOUNCE_MS = 200;

/** 章内查找栏：查找时替换阅读页顶部的返回和「···」，样式同全文搜索页的搜索框 */
export function FindBar({ result, onQuery, onStep, onClose }: Props) {
  const t = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => onQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, onQuery]);

  const current = result?.query === query ? result : null;
  const total = current?.total ?? 0;
  const count = !query.trim() || !current ? '' : total === 0 ? '无结果' : `第 ${current.index} / ${total} 处`;

  return (
    <View style={styles.row}>
      <Glass radius={22} strong style={styles.field}>
        <Search size={17} color={t.fg2} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="在本章查找"
          placeholderTextColor={t.fg3}
          selectionColor={t.accent}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => total > 0 && onStep(1)}
          clearButtonMode="never"
          style={[styles.input, { color: t.fg }]}
        />
        {count !== '' && <Text style={{ color: t.fg3, fontSize: 13, fontVariant: ['tabular-nums'] }}>{count}</Text>}
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="清除">
            <CircleX size={17} color={t.fg3} />
          </Pressable>
        )}
      </Glass>
      <Glass radius={22} strong style={styles.steps}>
        <StepButton icon={ChevronUp} label="上一处" disabled={total === 0} onPress={() => onStep(-1)} />
        <View style={[styles.divider, { backgroundColor: t.hairline }]} />
        <StepButton icon={ChevronDown} label="下一处" disabled={total === 0} onPress={() => onStep(1)} />
      </Glass>
      <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
        <Text style={{ color: t.accent, fontSize: 15, fontWeight: '500' }}>完成</Text>
      </Pressable>
    </View>
  );
}

function StepButton({ icon: Icon, label, disabled, onPress }: { icon: LucideIcon; label: string; disabled: boolean; onPress(): void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.step, pressed && { backgroundColor: t.fill }]}
    >
      <Icon size={19} color={disabled ? t.fg3 : t.fg} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 15, height: 44 },
  steps: { height: 44, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  step: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 20 },
});

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Glass } from '@/ui/glass';
import { PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

interface Request {
  quote: string;
  initial: string;
  doubt: boolean;
  resolve(value: string | null): void;
}

let show: ((r: Request) => void) | null = null;

/**
 * 输入或修改笔记；取消时 resolve(null)，清空内容时 resolve('')。
 * doubt：给存疑写说明（哪里可能不对），可以留空直接保存
 */
export function composeNote(quote: string, initial = '', doubt = false): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    show({ quote, initial, doubt, resolve });
  });
}

/** 写笔记的面板：引用原文 + 输入框，浮在键盘上方。在根布局挂载一次 */
export function NoteComposerHost() {
  const t = useTheme();
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    show = (r) => {
      setText(r.initial);
      setReq(r);
    };
    return () => {
      show = null;
    };
  }, []);

  const mark = req?.doubt ? t.warn : t.highlight;

  const close = (value: string | null) => {
    req?.resolve(value);
    setReq(null);
  };

  return (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={() => close(null)}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.dim }]} onPress={() => close(null)} />
      <KeyboardAvoidingView behavior="padding" style={styles.wrap} pointerEvents="box-none">
        <Glass radius={28} strong style={styles.card}>
          <View style={styles.head}>
            <Pressable onPress={() => close(null)} hitSlop={10}>
              <Text style={{ color: t.fg2, fontSize: 15 }}>取消</Text>
            </Pressable>
            <Text style={{ color: t.fg, fontSize: 16, fontWeight: '700' }}>
              {req?.doubt ? (req.initial ? '编辑存疑' : '存疑') : req?.initial ? '编辑笔记' : '笔记'}
            </Text>
            <PressScale onPress={() => close(text.trim())} style={[styles.save, { backgroundColor: t.accent }]}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>保存</Text>
            </PressScale>
          </View>
          <View style={[styles.quote, { backgroundColor: `${mark}14` }]}>
            <View style={[styles.bar, { backgroundColor: mark }]} />
            <Text style={{ flex: 1, color: t.fg2, fontSize: 13, lineHeight: 21 }} numberOfLines={3}>
              {req?.quote.trim()}
            </Text>
          </View>
          <TextInput
            autoFocus
            multiline
            value={text}
            onChangeText={setText}
            placeholder={req?.doubt ? '哪里可能不对、需要核实什么（可不填）' : '写下你的想法…'}
            placeholderTextColor={t.fg3}
            selectionColor={t.accent}
            style={[styles.input, { color: t.fg }]}
          />
        </Glass>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', padding: 8, paddingBottom: 10 },
  card: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  save: { height: 32, borderRadius: 16, paddingHorizontal: 14, justifyContent: 'center' },
  quote: { flexDirection: 'row', gap: 10, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  bar: { width: 3, borderRadius: 2 },
  input: { fontSize: 16, lineHeight: 27, minHeight: 74, maxHeight: 200, textAlignVertical: 'top', padding: 0 },
});

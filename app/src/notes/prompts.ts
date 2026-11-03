import { ActionSheetIOS, Alert, Platform } from 'react-native';
import type { HighlightKind } from '@/reader/bridge';
import { composeNote } from './NoteComposer';
import { deleteHighlight, setKind, setNote, type Highlight } from './store';

const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

/** 输入或修改笔记；取消时 resolve(null)，清空内容时 resolve('') */
export const promptNote = composeNote;

export type HighlightAction = 'note' | 'toggleDoubt' | 'delete';

/** 点击已有高亮时的操作菜单 */
export function chooseHighlightAction(h: { text: string; note: string | null; kind: HighlightKind }): Promise<HighlightAction | null> {
  const doubt = h.kind === 'doubt';
  const noteLabel = doubt ? (h.note ? '编辑说明' : '添加说明') : h.note ? '编辑笔记' : '添加笔记';
  const actions: [string, HighlightAction][] = [
    [noteLabel, 'note'],
    [doubt ? '取消存疑' : '标为存疑', 'toggleDoubt'],
    [doubt ? '删除存疑' : '删除高亮', 'delete'],
  ];
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: excerpt(h.text), options: [...actions.map(([l]) => l), '取消'], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
        (i) => resolve(actions[i]?.[1] ?? null),
      );
    } else {
      Alert.alert(excerpt(h.text), undefined, [
        ...actions.map(([text, a]) => ({ text, style: a === 'delete' ? ('destructive' as const) : undefined, onPress: () => resolve(a) })),
        { text: '取消', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

/** 执行点击已有高亮后选的操作（阅读页和笔记页共用）；返回是否删除了这条 */
export async function applyHighlightAction(h: Highlight, action: HighlightAction | null): Promise<boolean> {
  if (action === 'delete') {
    await deleteHighlight(h.id);
    return true;
  }
  if (action === 'toggleDoubt') await setKind(h.id, h.kind === 'doubt' ? 'highlight' : 'doubt');
  if (action === 'note') {
    const note = await promptNote(h.text, h.note ?? '', h.kind === 'doubt');
    if (note !== null) await setNote(h.id, note || null);
  }
  return false;
}

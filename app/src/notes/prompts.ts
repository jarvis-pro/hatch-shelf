import { ActionSheetIOS, Alert, Platform } from 'react-native';

const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

/** 输入或修改笔记；取消时 resolve(null)，清空内容时 resolve('') */
export function promptNote(quoteText: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt(
      initial ? '编辑笔记' : '添加笔记',
      `「${excerpt(quoteText)}」`,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(null) },
        { text: '保存', onPress: (value?: string) => resolve((value ?? '').trim()) },
      ],
      'plain-text',
      initial,
    );
  });
}

export type HighlightAction = 'note' | 'delete';

/** 点击已有高亮时的操作菜单 */
export function chooseHighlightAction(quoteText: string, hasNote: boolean): Promise<HighlightAction | null> {
  const noteLabel = hasNote ? '编辑笔记' : '添加笔记';
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: excerpt(quoteText), options: [noteLabel, '删除高亮', '取消'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? 'note' : i === 1 ? 'delete' : null),
      );
    } else {
      Alert.alert(excerpt(quoteText), undefined, [
        { text: noteLabel, onPress: () => resolve('note') },
        { text: '删除高亮', style: 'destructive', onPress: () => resolve('delete') },
        { text: '取消', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

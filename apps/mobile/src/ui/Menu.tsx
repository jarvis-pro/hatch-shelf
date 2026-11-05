import type { LucideIcon } from 'lucide-react-native';
import { Fragment, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Glass } from './glass';
import { useTheme } from './theme';

export interface MenuItem {
  label: string;
  /** 标签下方的一行小字，如「65 MB · 书和笔记都保留」 */
  detail?: string;
  /** 不给时只显示文字（如定时菜单里没选中的项） */
  icon?: LucideIcon;
  destructive?: boolean;
  /** 图标在左的大菜单里，用主色底突出这一项（书架「+」里的「从电脑接收」） */
  primary?: boolean;
  onPress(): void;
}

/**
 * 右上角「更多」按钮弹出的玻璃菜单；给 bottom 时从屏幕底部往上弹（听书面板上的定时）。
 * leading 时图标放在左边的方块里、每项都带说明（书架「+」的加书菜单）
 */
export function Menu({
  visible,
  top,
  bottom,
  items,
  leading,
  onClose,
}: {
  visible: boolean;
  top?: number;
  bottom?: number;
  items: MenuItem[];
  leading?: boolean;
  onClose(): void;
}) {
  const t = useTheme();
  // 菜单项要等菜单完全收起再执行：菜单还在淡出时弹出另一个模态页（如接收页），iOS 会忽略那次弹出
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={runPending}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? '#00000040' : '#1E2A5A14' }]} onPress={onClose} />
      <Glass radius={leading ? 20 : 18} strong style={[styles.menu, leading && styles.leadingMenu, { top, bottom }]}>
        {items.map((item, i) => {
          const choose = () => {
            pending.current = item.onPress;
            onClose();
            // onDismiss 只在 iOS 上有
            if (Platform.OS !== 'ios') runPending();
          };
          if (leading) {
            return (
              <Pressable
                key={item.label}
                style={({ pressed }) => [styles.leadingItem, item.primary && { backgroundColor: t.dark ? '#6E9BFF14' : '#2F6BFF0D' }, pressed && { backgroundColor: t.fill }]}
                onPress={choose}
              >
                <View style={[styles.tile, { backgroundColor: item.primary ? t.accentSoft : t.fill }]}>
                  {item.icon && <item.icon size={17} color={item.primary ? t.accent : t.fg} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }}>{item.label}</Text>
                  {item.detail !== undefined && (
                    <Text style={{ color: t.fg3, fontSize: 12 }} numberOfLines={1}>
                      {item.detail}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }
          const color = item.destructive ? t.danger : t.fg;
          return (
            <Fragment key={item.label}>
              {/* 危险操作和普通操作之间隔开一段，同类之间用细线 */}
              {i > 0 && item.destructive && !items[i - 1].destructive && <View style={[styles.gap, { backgroundColor: t.hairline }]} />}
              {i > 0 && (!item.destructive || items[i - 1].destructive) && <View style={[styles.sep, { backgroundColor: t.hairline }]} />}
              <Pressable
                style={({ pressed }) => [styles.item, item.detail !== undefined && styles.tall, pressed && { backgroundColor: t.fill }]}
                onPress={choose}
              >
                <View style={{ gap: 2 }}>
                  <Text style={{ color, fontSize: 15 }}>{item.label}</Text>
                  {item.detail !== undefined && <Text style={{ color: t.fg3, fontSize: 12 }}>{item.detail}</Text>}
                </View>
                {item.icon && <item.icon size={17} color={color} />}
              </Pressable>
            </Fragment>
          );
        })}
      </Glass>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menu: { position: 'absolute', right: 20, width: 232, overflow: 'hidden' },
  leadingMenu: { width: 244, padding: 6 },
  leadingItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  item: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  tall: { height: 62 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 18 },
  gap: { height: 6 },
});

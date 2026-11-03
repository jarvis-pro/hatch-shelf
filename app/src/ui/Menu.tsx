import type { LucideIcon } from 'lucide-react-native';
import { Fragment } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Glass } from './glass';
import { useTheme } from './theme';

export interface MenuItem {
  label: string;
  /** 不给时只显示文字（如定时菜单里没选中的项） */
  icon?: LucideIcon;
  destructive?: boolean;
  onPress(): void;
}

/** 右上角「更多」按钮弹出的玻璃菜单；给 bottom 时从屏幕底部往上弹（听书面板上的定时） */
export function Menu({
  visible,
  top,
  bottom,
  items,
  onClose,
}: {
  visible: boolean;
  top?: number;
  bottom?: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? '#00000040' : '#1E2A5A14' }]} onPress={onClose} />
      <Glass radius={18} strong style={[styles.menu, { top, bottom }]}>
        {items.map((item, i) => {
          const color = item.destructive ? t.danger : t.fg;
          return (
            <Fragment key={item.label}>
              {item.destructive && i > 0 && <View style={[styles.gap, { backgroundColor: t.hairline }]} />}
              {!item.destructive && i > 0 && <View style={[styles.sep, { backgroundColor: t.hairline }]} />}
              <Pressable
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.fill }]}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              >
                <Text style={{ color, fontSize: 15 }}>{item.label}</Text>
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
  item: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 18 },
  gap: { height: 6 },
});

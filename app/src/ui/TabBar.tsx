import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname, type Href } from 'expo-router';
import { ArrowDownToLine, LibraryBig, NotebookPen, Settings2, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './glass';
import { isReduceMotion } from './motion';
import { useTheme } from './theme';

const TABS: { href: Href & string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: '书架', icon: LibraryBig },
  { href: '/notes', label: '笔记', icon: NotebookPen },
  { href: '/transfer', label: '传书', icon: ArrowDownToLine },
  { href: '/settings', label: '设置', icon: Settings2 },
];

/** Tab 栏占的高度，页面内容底部要留出这么多 */
export const TAB_BAR_SPACE = 110;

/** 悬浮的玻璃 Tab 栏；选中态是一块在 Tab 间弹性滑动的白色胶囊（05 Tab 玻璃胶囊） */
export function TabBar() {
  const t = useTheme();
  const pathname = usePathname();
  const index = Math.max(0, TABS.findIndex((tab) => tab.href === pathname));
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const tabWidth = width / TABS.length;
  const x = useState(() => new Animated.Value(0))[0];
  const first = useRef(true);

  useEffect(() => {
    if (!tabWidth) return;
    const to = index * tabWidth;
    if (first.current || isReduceMotion()) {
      first.current = false;
      x.setValue(to);
    } else {
      Animated.spring(x, { toValue: to, damping: 22, stiffness: 300, useNativeDriver: true }).start();
    }
  }, [index, tabWidth, x]);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom - 8, 12) }]} pointerEvents="box-none">
      <LinearGradient colors={[`${t.bg}00`, `${t.bg}CC`]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Glass radius={31} style={styles.bar}>
        <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {tabWidth > 0 && (
            <Animated.View
              style={[
                styles.capsule,
                {
                  width: tabWidth,
                  backgroundColor: t.dark ? '#FFFFFF1F' : '#FFFFFFE6',
                  shadowColor: t.shadow,
                  transform: [{ translateX: x }],
                },
              ]}
            />
          )}
          {TABS.map((tab, i) => (
            <TabItem
              key={tab.href}
              label={tab.label}
              icon={tab.icon}
              focused={i === index}
              onPress={() => i !== index && router.navigate(tab.href)}
            />
          ))}
        </View>
      </Glass>
    </View>
  );
}

function TabItem({ label, icon: Icon, focused, onPress }: { label: string; icon: LucideIcon; focused: boolean; onPress(): void }) {
  const t = useTheme();
  const pop = useState(() => new Animated.Value(1))[0];
  useEffect(() => {
    if (!focused || isReduceMotion()) return;
    Animated.sequence([
      Animated.timing(pop, { toValue: 1.12, duration: 120, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, damping: 22, stiffness: 300, useNativeDriver: true }),
    ]).start();
  }, [focused, pop]);
  const color = focused ? t.accent : t.fg3;
  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Icon size={20} color={color} strokeWidth={focused ? 2.2 : 1.8} />
      </Animated.View>
      <Text style={{ color, fontSize: 10, fontWeight: focused ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 8 },
  bar: { height: 62, padding: 5 },
  row: { flex: 1, flexDirection: 'row' },
  capsule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 26,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
});

import { Tabs } from 'expo-router/tabs';
import { StyleSheet, View } from 'react-native';
import { TabBar } from '@/ui/TabBar';
import { useTheme } from '@/ui/theme';

export default function TabsLayout() {
  const t = useTheme();
  // 玻璃 Tab 栏浮在页面上方：放在导航器外面绘制，导航器自己的 Tab 栏容器高度为 0，绝对定位的子元素收不到点击
  return (
    <View style={styles.flex}>
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg } }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="notes" />
        <Tabs.Screen name="transfer" />
        <Tabs.Screen name="settings" />
      </Tabs>
      <TabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

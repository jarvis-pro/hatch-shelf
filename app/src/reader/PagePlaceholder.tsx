import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_OUT_CUBIC, isReduceMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

/**
 * 进书过场（设计稿「进书 · 版式占位与显影」）：阅读器渲染完成前，按正文版式画出章号、章标题和淡墨行，
 * 尺寸与位置照抄 reader-web/src/style.css；渲染完成后原地淡出，章标题不动，淡墨行化成文字。
 * WebView 不跟随系统「文字大小」，所以占位文字也关掉 allowFontScaling，否则显影时字号会跳。
 * 阅读页不放环境动效，等待期间占位保持静止。
 */

/** 切章时先盖住旧正文，再把新章节交给阅读器 */
export const COVER_MS = 120;
const REVEAL_MS = 240;

/** 每段的行数和最后一行的宽度比例；循环使用直到铺满屏幕 */
const PARAGRAPHS: [number, number][] = [
  [3, 0.63],
  [1, 0.73],
  [2, 0.4],
  [3, 0.86],
  [2, 0.28],
  [4, 0.53],
  [3, 0.68],
  [2, 0.44],
];

export interface PlaceholderChapter {
  /** 第几章（从 1 开始） */
  no: number;
  /** null：从章节中间继续，顶部没有标题，只画淡墨行 */
  title: string | null;
}

export function PagePlaceholder({
  visible,
  chapter,
  fontSize,
  lineHeight,
}: {
  visible: boolean;
  /** 还不知道打开哪一章时只铺底色 */
  chapter: PlaceholderChapter | null;
  fontSize: number;
  lineHeight: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const v = useState(() => new Animated.Value(1))[0];

  useEffect(() => {
    const duration = visible ? COVER_MS : isReduceMotion() ? 150 : REVEAL_MS;
    const anim = Animated.timing(v, { toValue: visible ? 1 : 0, duration, easing: EASE_OUT_CUBIC, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, visible]);

  // 与 style.css 对应：正文 font-size / line-height，h1 为 1.7em、行高 1.4、下边距 0.9em，段落下边距 1.1em
  const line = fontSize * lineHeight;
  const bar = Math.round(fontSize * 0.75);
  const h1 = fontSize * 1.7;
  const lines = Math.ceil(screenHeight / line);
  const paragraphs: [number, number][] = [];
  for (let n = 0, i = 0; n < lines; i++) {
    const p = PARAGRAPHS[i % PARAGRAPHS.length];
    paragraphs.push(p);
    n += p[0];
  }

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: t.paper, opacity: v }]} pointerEvents="none">
      {chapter && (
        // 正文 body 的上内边距是 104；从中间继续时正文顶到顶栏下方
        <View style={{ paddingTop: chapter.title === null ? insets.top + 48 : 104 }}>
          {chapter.title !== null && (
            <>
              <Text allowFontScaling={false} style={[styles.kicker, { color: t.accent }]}>CHAPTER {String(chapter.no).padStart(2, '0')}</Text>
              <Text
                allowFontScaling={false}
                style={[styles.h1, { color: t.fg, fontSize: h1, lineHeight: h1 * 1.4, marginBottom: h1 * 0.9 }]}
              >
                {chapter.title}
              </Text>
            </>
          )}
          {paragraphs.map(([count, last], i) => (
            <View key={i} style={{ paddingVertical: (line - bar) / 2, gap: line - bar, marginBottom: fontSize * 1.1 }}>
              {Array.from({ length: count }, (_, j) => (
                <View
                  key={j}
                  style={{
                    height: bar,
                    borderRadius: bar / 2,
                    backgroundColor: t.track,
                    width: j === count - 1 ? `${last * 100}%` : '100%',
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 26, overflow: 'hidden' },
  kicker: { fontSize: 11, lineHeight: 13.2, fontWeight: '600', letterSpacing: 2, marginBottom: 8 },
  // 与 style.css 的 h1 一样显式用苹方：系统字体的中文字距在 RN 里比 WebView 紧，标题会显得小一圈
  h1: { fontFamily: 'PingFang SC', fontWeight: '700', letterSpacing: -0.3 },
});

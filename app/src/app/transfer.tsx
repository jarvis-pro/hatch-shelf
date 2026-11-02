import * as Network from 'expo-network';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ImportResult } from '@/import/pipeline';
import { LAN_PORT, MAX_PIN_FAILURES, startLanServer, type LanServer } from '@/server/lan-server';
import { useShelfColors } from '@/shelf/colors';

type Status = { kind: 'starting' } | { kind: 'running' } | { kind: 'locked' } | { kind: 'error'; message: string };

const randomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');

/**
 * 传书页面（README 第 5.2 节）：页面可见时启动 HTTP 服务，离开页面或 App 进入后台时立即关闭。
 */
export default function TransferScreen() {
  useKeepAwake();
  const c = useShelfColors();
  const [ip, setIp] = useState<string | null>(null);
  const [onWifi, setOnWifi] = useState(true);
  const [pin, setPin] = useState(randomPin);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const [received, setReceived] = useState<(ImportResult & { at: number })[]>([]);
  const server = useRef<LanServer | null>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // 刷新 IP：切换 Wi-Fi 或回到前台时可能变化
  useEffect(() => {
    if (!active) return;
    void Network.getNetworkStateAsync().then((s) => setOnWifi(s.type === Network.NetworkStateType.WIFI));
    void Network.getIpAddressAsync().then((addr) => setIp(addr && addr !== '0.0.0.0' ? addr : null));
  }, [active]);

  const running = focused && active && status.kind !== 'locked';
  useEffect(() => {
    if (!running) return;
    setStatus({ kind: 'starting' });
    const s = startLanServer(pin, {
      onListening: () => setStatus({ kind: 'running' }),
      onUpload: (r) => setReceived((list) => [{ ...r, at: Date.now() }, ...list]),
      onLocked: () => setStatus({ kind: 'locked' }),
      onError: (message) => setStatus({ kind: 'error', message }),
    });
    server.current = s;
    return () => {
      s.stop();
      server.current = null;
    };
  }, [running, pin]);

  const restart = () => {
    setPin(randomPin());
    setStatus({ kind: 'starting' });
  };

  const url = ip ? `http://${ip}:${LAN_PORT}` : null;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.label, { color: c.muted }]}>在电脑浏览器中打开</Text>
        <Text style={[styles.url, { color: c.fg }]} selectable>
          {url ?? '未获取到 IP 地址'}
        </Text>
        <Text style={[styles.label, { color: c.muted, marginTop: 16 }]}>PIN</Text>
        <Text style={[styles.pin, { color: c.fg }]}>{pin}</Text>
        <StatusLine status={status} colors={c} />
        {status.kind === 'locked' && (
          <Pressable style={[styles.button, { backgroundColor: c.accent }]} onPress={restart}>
            <Text style={styles.buttonText}>换一个 PIN 重新开始</Text>
          </Pressable>
        )}
      </View>

      {!onWifi && (
        <Text style={{ color: c.danger }}>当前没有连接 Wi-Fi，电脑和手机需要在同一个局域网内。</Text>
      )}

      <Text style={{ color: c.muted, lineHeight: 20 }}>
        电脑和手机连接同一个 Wi-Fi，打开上面的地址，输入 PIN 后拖入 .zip 或 .md 文件。也可以用命令行：
      </Text>
      <Text style={[styles.code, { color: c.fg, backgroundColor: c.card }]} selectable>
        {`curl -H "X-Pin: ${pin}" -F file=@book.zip ${url ?? 'http://<IP>:8080'}/upload`}
      </Text>
      <Text style={{ color: c.muted, fontSize: 13 }}>
        离开本页面后服务立即关闭；PIN 连续输错 {MAX_PIN_FAILURES} 次，本次服务失效。
      </Text>

      {received.length > 0 && (
        <View style={[styles.card, { backgroundColor: c.card, gap: 12 }]}>
          {received.map((r) => (
            <Pressable
              key={r.at}
              disabled={!r.ok}
              onPress={() => r.ok && router.push({ pathname: '/read/[id]', params: { id: r.bookId } })}
            >
              <Text style={{ color: r.ok ? c.fg : c.danger, fontSize: 15 }} numberOfLines={2}>
                {r.ok ? `${r.status === 'updated' ? '已更新' : '已导入'}《${r.title}》` : `失败：${r.fileName}（${r.error}）`}
              </Text>
              {r.ok && r.warnings.map((w) => (
                <Text key={w} style={{ color: c.muted, fontSize: 13 }}>
                  ⚠︎ {w}
                </Text>
              ))}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function StatusLine({ status, colors: c }: { status: Status; colors: ReturnType<typeof useShelfColors> }) {
  const [text, color] =
    status.kind === 'running'
      ? ['● 正在等待传书', '#34c759']
      : status.kind === 'starting'
        ? ['正在启动…', c.muted]
        : status.kind === 'locked'
          ? ['PIN 错误次数过多，服务已关闭', c.danger]
          : [`服务启动失败：${status.message}`, c.danger];
  return <Text style={{ color, marginTop: 16, fontSize: 14 }}>{text}</Text>;
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, paddingBottom: 48 },
  card: { borderRadius: 14, padding: 18 },
  label: { fontSize: 13 },
  url: { fontSize: 22, fontWeight: '600', marginTop: 4, fontVariant: ['tabular-nums'] },
  pin: { fontSize: 44, fontWeight: '700', letterSpacing: 10, fontVariant: ['tabular-nums'] },
  button: { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  buttonText: { color: '#fff', fontWeight: '600' },
  code: { fontFamily: 'Menlo', fontSize: 12, padding: 12, borderRadius: 10 },
});

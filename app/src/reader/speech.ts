import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/db/queries';
import type { ToReader } from './bridge';

/**
 * 听书（README 第 8 节）：用系统语音逐段朗读本章，完全在本机运行。
 * 段落由阅读器切好（ttsCollect → ttsBlocks），整章一次排进系统的朗读队列，段与段之间没有停顿；
 * 每段开始时让阅读器标出这一段。音频会话设为 playback，静音键打开、锁屏或切到后台时都能读完本章。
 */

export type SpeechState = 'idle' | 'playing' | 'paused';

/** 语速档位：1 为系统默认语速 */
export const SPEECH_RATES = [0.8, 1, 1.25, 1.5] as const;

const RATE_KEY = 'speechRate';

/** 优先用设备上质量最高的普通话语音（增强版需在系统设置里下载） */
let voicePromise: Promise<string | undefined> | null = null;
function pickVoice() {
  voicePromise ??= Speech.getAvailableVoicesAsync()
    .then((voices) => {
      const zh = voices.filter((v) => v.language === 'zh-CN');
      return (zh.find((v) => v.quality === Speech.VoiceQuality.Enhanced) ?? zh[0])?.identifier;
    })
    .catch(() => undefined);
  return voicePromise;
}

async function activateAudio() {
  await setIsAudioActiveAsync(true);
  // playback 类别：不受静音键影响，配合 UIBackgroundModes audio 在后台继续
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
}

/** 结束后交还音频会话，被打断的音乐可以继续播放 */
function releaseAudio() {
  setIsAudioActiveAsync(false).catch(() => {});
}

export function useReadAloud(send: (msg: ToReader) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [rate, setRate] = useState<number>(1);
  const texts = useRef<string[]>([]);
  /** 正在读的段落下标，改语速时从这一段重新开始 */
  const current = useRef(0);
  /** 每次重新排队都加一；旧队列被 stop 之后迟到的回调据此忽略 */
  const session = useRef(0);
  const rateChanged = useRef(false);

  useEffect(() => {
    void getSetting<number>(RATE_KEY, 1).then(setRate);
    return () => {
      session.current += 1;
      void Speech.stop();
      releaseAudio();
    };
  }, []);

  const finish = useCallback(() => {
    session.current += 1;
    setState('idle');
    send({ type: 'ttsMark', index: null });
    void Speech.stop();
    releaseAudio();
  }, [send]);

  const speakFrom = useCallback(
    async (from: number, speed: number) => {
      const s = ++session.current;
      rateChanged.current = false;
      await Speech.stop();
      const [voice] = await Promise.all([pickVoice(), activateAudio()]);
      if (s !== session.current) return;
      const last = texts.current.length - 1;
      const alive = () => s === session.current;
      for (let i = from; i <= last; i++) {
        Speech.speak(texts.current[i], {
          language: 'zh-CN',
          voice,
          rate: speed,
          onStart: () => {
            if (!alive()) return;
            current.current = i;
            send({ type: 'ttsMark', index: i });
          },
          onDone: i === last ? () => void (alive() && finish()) : undefined,
          onError: () => void (alive() && finish()),
        });
      }
      setState('playing');
    },
    [finish, send],
  );

  /** 从视口里第一段开始读：先请阅读器切段落，回报后由 onBlocks 开始 */
  const start = useCallback(() => send({ type: 'ttsCollect' }), [send]);

  const onBlocks = useCallback(
    (list: string[], from: number) => {
      texts.current = list;
      if (list.length === 0) return;
      speakFrom(from, rate).catch(finish);
    },
    [finish, rate, speakFrom],
  );

  const pause = useCallback(() => {
    void Speech.pause();
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    // 暂停期间改过语速：已排队的段落还是旧语速，从当前段落重新排
    if (rateChanged.current) {
      rateChanged.current = false;
      speakFrom(current.current, rate).catch(finish);
      return;
    }
    void Speech.resume();
    setState('playing');
  }, [finish, rate, speakFrom]);

  /** 换到下一档语速；朗读中从当前段落按新语速重读，暂停中等继续时再生效 */
  const cycleRate = useCallback(() => {
    const next = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as (typeof SPEECH_RATES)[number]) + 1) % SPEECH_RATES.length];
    setRate(next);
    void setSetting(RATE_KEY, next);
    if (state === 'playing') speakFrom(current.current, next).catch(finish);
    else if (state === 'paused') rateChanged.current = true;
  }, [finish, rate, speakFrom, state]);

  return { state, rate, start, onBlocks, pause, resume, stop: finish, cycleRate };
}

import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
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
/** 选中的语音 identifier；没有记录或为 null 时自动挑选 */
const VOICE_KEY = 'speechVoice';

/** 可选的中文语音，按这个顺序分组 */
export const VOICE_LANGUAGES = [
  { language: 'zh-CN', label: '普通话' },
  { language: 'zh-TW', label: '台湾国语' },
  { language: 'zh-HK', label: '粤语' },
] as const;

/** premium（高音质）、enhanced（增强）需在系统设置 → 辅助功能 → 朗读内容 → 声音 里下载 */
export type VoiceTier = 'premium' | 'enhanced' | 'default';

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  tier: VoiceTier;
}

export const VOICE_TIER_LABELS: Record<VoiceTier, string | null> = { premium: '高音质', enhanced: '增强', default: null };

const TIER_RANK: Record<VoiceTier, number> = { premium: 0, enhanced: 1, default: 2 };

/** expo-speech 把 iOS 的 premium 也报成 Default，只能从 identifier（com.apple.voice.premium.zh-CN.Lili）里看 */
function tierOf(v: Speech.Voice): VoiceTier {
  if (v.identifier.includes('.premium.')) return 'premium';
  if (v.identifier.includes('.enhanced.') || v.quality === Speech.VoiceQuality.Enhanced) return 'enhanced';
  return 'default';
}

let voicesPromise: Promise<VoiceOption[]> | null = null;
/** 设备上的中文语音，同一语言里音质高的在前。fresh 时重新读取：用户可能刚在系统设置里下载或删掉了语音 */
function loadVoices(fresh = false) {
  if (fresh) voicesPromise = null;
  voicesPromise ??= Speech.getAvailableVoicesAsync()
    .then((voices) =>
      voices
        .filter((v) => VOICE_LANGUAGES.some((l) => l.language === v.language))
        .map((v): VoiceOption => ({ id: v.identifier, name: v.name, language: v.language, tier: tierOf(v) }))
        .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.name.localeCompare(b.name, 'zh')),
    )
    .catch(() => []);
  return voicesPromise;
}

/** 选中的语音还在就用它；自动或已被删掉时用音质最好的普通话语音 */
export function resolveVoice(voices: VoiceOption[], chosen: string | null) {
  return voices.find((v) => v.id === chosen) ?? voices.find((v) => v.language === 'zh-CN');
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
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  /** null 为自动 */
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const texts = useRef<string[]>([]);
  /** 正在读的段落下标，改语速时从这一段重新开始 */
  const current = useRef(0);
  /** 每次重新排队都加一；旧队列被 stop 之后迟到的回调据此忽略 */
  const session = useRef(0);
  const rateChanged = useRef(false);

  useEffect(() => {
    void getSetting<number>(RATE_KEY, 1).then(setRate);
    void getSetting<string | null>(VOICE_KEY, null).then(setVoiceId);
    void loadVoices().then(setVoices);
    // 从系统设置下载完语音切回来，列表里马上就有
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void loadVoices(true).then(setVoices);
    });
    return () => {
      sub.remove();
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
    async (from: number, speed: number, chosen: string | null) => {
      const s = ++session.current;
      rateChanged.current = false;
      await Speech.stop();
      const [list] = await Promise.all([loadVoices(), activateAudio()]);
      const voice = resolveVoice(list, chosen)?.id;
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
      speakFrom(from, rate, voiceId).catch(finish);
    },
    [finish, rate, speakFrom, voiceId],
  );

  const pause = useCallback(() => {
    void Speech.pause();
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    // 暂停期间改过语速：已排队的段落还是旧语速，从当前段落重新排
    if (rateChanged.current) {
      rateChanged.current = false;
      speakFrom(current.current, rate, voiceId).catch(finish);
      return;
    }
    void Speech.resume();
    setState('playing');
  }, [finish, rate, speakFrom, voiceId]);

  /** 换到下一档语速；朗读中从当前段落按新语速重读，暂停中等继续时再生效 */
  const cycleRate = useCallback(() => {
    const next = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as (typeof SPEECH_RATES)[number]) + 1) % SPEECH_RATES.length];
    setRate(next);
    void setSetting(RATE_KEY, next);
    if (state === 'playing') speakFrom(current.current, next, voiceId).catch(finish);
    else if (state === 'paused') rateChanged.current = true;
  }, [finish, rate, speakFrom, state, voiceId]);

  /** 换语音（null 为自动）：朗读或暂停中都从当前段落用新语音接着读，选完马上能听到 */
  const chooseVoice = useCallback(
    (id: string | null) => {
      setVoiceId(id);
      void setSetting(VOICE_KEY, id);
      if (state !== 'idle') speakFrom(current.current, rate, id).catch(finish);
    },
    [finish, rate, speakFrom, state],
  );

  const voice = resolveVoice(voices, voiceId);

  return { state, rate, voices, voiceId, voice, start, onBlocks, pause, resume, stop: finish, cycleRate, chooseVoice };
}

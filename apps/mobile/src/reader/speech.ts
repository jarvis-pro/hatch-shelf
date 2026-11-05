import { chapterAudio, type AudioManifest } from '@shelf/spec';
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppState } from 'react-native';
import { getSetting, setSetting, type ChapterRow } from '@/db/queries';
import { loadAudioManifest } from '@/library/audio';
import { audioDir, bookDir } from '@/lib/paths';
import { addNowPlayingListener, clearNowPlaying, updateNowPlaying, type NowPlayingCommand } from '../../modules/now-playing';
import type { ToReader } from './bridge';
import { recordingEngine, systemEngine, type Engine } from './engines';

/**
 * 听书（README 第 8 节）：用系统语音逐段朗读，完全在本机运行，读完一章接着读下一章。
 * 段落由阅读器切好（ttsCollect → ttsBlocks）：开始时连后面各章一起切，App 在后台、WebView 被冻结时也能换章。
 * 一章一次排进系统的朗读队列，本章最后一段开始时排进下一章，段与段、章与章之间都没有停顿；
 * 每段开始时让阅读器标出这一段。音频会话设为 playback，静音键打开、锁屏或切到后台时都能接着读；
 * 锁屏和控制中心显示正在读的章节，锁屏按钮、耳机线控可以暂停和跳段。
 *
 * 原声（README 第 8.1 节）：书有预生成的录音时，以章为单位选引擎——本章每段都对得上录音清单才播录音，
 * 否则整章用系统语音，不在一章中间换声音。
 */

export type SpeechState = 'idle' | 'playing' | 'paused';

/** 定时停止：chapter 为读完本章停，数字为分钟数（到点后读完当前这一段再停）；null 为不定时 */
export type SleepTimer = null | 'chapter' | 15 | 30 | 60;

export const SLEEP_TIMERS: { value: SleepTimer; label: string }[] = [
  { value: null, label: '不定时' },
  { value: 'chapter', label: '读完本章' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '60 分钟' },
];

/** 语速档位：1 为系统默认语速 */
export const SPEECH_RATES = [0.8, 1, 1.25, 1.5] as const;

const RATE_KEY = 'speechRate';
/** 选中的语音 identifier；没有记录或为 null 时自动挑选 */
const VOICE_KEY = 'speechVoice';
/** 语音选「原声」时记下的值；本章不支持原声时用自动挑的系统语音 */
export const ORIGINAL_VOICE = 'original';


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

const stopEngines = () => Promise.all([systemEngine.stop(), recordingEngine.stop()]);

/** 正在用哪种声音读：原声，或系统语音 */
export type EngineKind = 'original' | 'system';

interface Book {
  id: string;
  title: string | undefined;
  chapters: ChapterRow[];
  /** WebView 当前显示的章节文件；只有它就是正在读的章节时才让阅读器标段落 */
  shownFile: RefObject<string | null>;
  /** 读到了另一章（自动接下一章，或锁屏、耳机的下一段跨过了章末）；c 从 0 开始 */
  onChapter(c: number): void;
}

/** 第 after 章之后第一个有段落的章节 */
function nextChapter(segments: Map<number, string[]>, count: number, after: number) {
  for (let c = after + 1; c < count; c++) {
    if (segments.get(c)?.length) return c;
  }
  return null;
}

export function useReadAloud(send: (msg: ToReader) => void, book: Book) {
  const [state, setState] = useState<SpeechState>('idle');
  const [rate, setRate] = useState<number>(1);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  /** null 为自动 */
  const [voiceId, setVoiceId] = useState<string | null>(null);
  /** 正在读的章节（从 0 开始）；不朗读时为 null */
  const [chapter, setChapter] = useState<number | null>(null);
  /** 播放面板的段落进度：正在读第 index 段，共 total 段 */
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  /** 手动滚走、正在读的段落不在屏幕上；面板显示「从这里读」 */
  const [away, setAway] = useState(false);
  const [sleep, setSleep] = useState<SleepTimer>(null);
  /** 本书的录音清单 */
  const [audio, setAudio] = useState<AudioManifest | null>(null);
  const audioRef = useRef<AudioManifest | null>(null);
  /** 正在读的这一章用的引擎、这一章有没有原声 */
  const [engineKind, setEngineKind] = useState<EngineKind>('system');
  const [chapterOriginal, setChapterOriginal] = useState(false);
  const engineRef = useRef<Engine>(systemEngine);
  /** 各章的录音文件（uri），按段落；null 为本章不支持原声。段落或清单变了就作废 */
  const recordings = useRef(new Map<number, string[][] | null>());
  /** 已切好的各章段落，按章节下标 */
  const segments = useRef(new Map<number, string[]>());
  /** 这次 ttsCollect 从第几章开始、following 对应哪些章 */
  const collecting = useRef<{ chapter: number; following: number[] } | null>(null);
  const reading = useRef(0);
  /** 正在读的段落下标，改语速时从这一段重新开始 */
  const current = useRef(0);
  /** 每次重新排队都加一；旧队列被 stop 之后迟到的回调据此忽略 */
  const session = useRef(0);
  const rateChanged = useRef(false);
  const sleepRef = useRef<SleepTimer>(null);
  /** 定时分钟数到点的时刻 */
  const deadline = useRef<number | null>(null);
  /** 来电等打断时由我们暂停的，打断结束后自动接着读 */
  const interrupted = useRef(false);
  const bookRef = useRef(book);
  useEffect(() => {
    bookRef.current = book;
  });

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
      void stopEngines();
      void clearNowPlaying();
      releaseAudio();
    };
  }, []);

  useEffect(() => {
    let live = true;
    void loadAudioManifest(book.id).then((m) => {
      if (!live) return;
      audioRef.current = m;
      recordings.current.clear();
      setAudio(m);
    });
    return () => {
      live = false;
    };
  }, [book.id]);

  /** 第 c 章的录音：每段都对得上清单、文件都在才返回 */
  const recordingsOf = useCallback((c: number) => {
    if (recordings.current.has(c)) return recordings.current.get(c)!;
    const manifest = audioRef.current;
    const file = bookRef.current.chapters[c]?.file;
    const texts = segments.current.get(c);
    let found: string[][] | null = null;
    if (manifest && file && texts) {
      const dir = audioDir(manifest.bookId);
      const files = chapterAudio(manifest, file, texts)?.map((list) => list.map((fp) => new File(dir, `${fp}.mp3`)));
      if (files?.every((list) => list.every((f) => f.exists))) found = files.map((list) => list.map((f) => f.uri));
    }
    recordings.current.set(c, found);
    return found;
  }, []);

  // 锁屏封面用书的 cover.png，没有就不显示
  const cover = useMemo(() => {
    const f = new File(bookDir(book.id), 'cover.png');
    return f.exists ? f.uri : null;
  }, [book.id]);

  const chooseSleep = useCallback((next: SleepTimer) => {
    setSleep(next);
    sleepRef.current = next;
    deadline.current = typeof next === 'number' ? Date.now() + next * 60_000 : null;
  }, []);

  const finish = useCallback(() => {
    session.current += 1;
    setState('idle');
    setChapter(null);
    setAway(false);
    chooseSleep(null);
    interrupted.current = false;
    send({ type: 'ttsMark', index: null });
    void stopEngines();
    void clearNowPlaying();
    releaseAudio();
  }, [chooseSleep, send]);

  /** 只有 WebView 正显示着正在读的章节时才标段落 */
  const mark = useCallback(
    (i: number, jump: boolean) => {
      const { chapters, shownFile } = bookRef.current;
      if (chapters[reading.current]?.file === shownFile.current) send({ type: 'ttsMark', index: i, jump });
    },
    [send],
  );

  const speakFrom = useCallback(
    /** jump：用户主动跳段，阅读器即使被手动滚走也要滚到这一段 */
    async (from: { chapter: number; index: number }, speed: number, chosen: string | null, jump = false) => {
      const s = ++session.current;
      /** 自动和「原声」在本章有录音时用原声；选了某个系统语音就总用它 */
      const wantsOriginal = chosen === null || chosen === ORIGINAL_VOICE;
      const filesOf = (c: number) => (wantsOriginal ? recordingsOf(c) : null);
      const enter = (c: number, i: number, scroll: boolean) => {
        const original = filesOf(c) !== null;
        engineRef.current = original ? recordingEngine : systemEngine;
        setEngineKind(original ? 'original' : 'system');
        setChapterOriginal(recordingsOf(c) !== null);
        if (reading.current !== c) {
          reading.current = c;
          setAway(false);
          bookRef.current.onChapter(c);
        }
        setChapter(c);
        setTotal(segments.current.get(c)?.length ?? 0);
        current.current = i;
        setIndex(i);
        mark(i, scroll);
      };
      enter(from.chapter, from.index, false);
      rateChanged.current = false;
      await stopEngines();
      const [list] = await Promise.all([loadVoices(), activateAudio()]);
      const voice = resolveVoice(list, chosen)?.id;
      if (s !== session.current) return;
      const alive = () => s === session.current;
      /** 已经排进队列的下一章 */
      const queued = new Set<number>();
      const count = bookRef.current.chapters.length;
      const enqueue = (c: number, begin: number) => {
        const texts = segments.current.get(c) ?? [];
        const files = filesOf(c);
        const engine = files ? recordingEngine : systemEngine;
        const last = texts.length - 1;
        const next = nextChapter(segments.current, count, c);
        const queueNext = () => {
          if (next === null || queued.has(next)) return;
          queued.add(next);
          enqueue(next, 0);
        };
        for (let i = begin; i <= last; i++) {
          engine.speak(
            {
              text: texts[i],
              files: files?.[i],
              onStart: () => {
                if (!alive()) return;
                enter(c, i, jump && c === from.chapter && i === from.index);
                // 最后一段开始时排进下一章，换章时不留空：后台没有声音的间隙里 App 可能被挂起。
                // 下一章换了引擎（原声 ↔ 系统语音）时两边的队列不相通，等这一段读完再开始
                const sameEngine = next !== null && (filesOf(next) ? recordingEngine : systemEngine) === engine;
                if (i === last && sleepRef.current !== 'chapter' && sameEngine) queueNext();
              },
              onDone: () => {
                if (!alive()) return;
                // 定时到点：读完这一段就停，下一段刚开头也一并停掉
                if (deadline.current !== null && Date.now() >= deadline.current) return finish();
                if (i !== last) return;
                if (sleepRef.current === 'chapter' || next === null) return finish();
                queueNext();
              },
              onError: () => void (alive() && finish()),
            },
            { rate: speed, voice },
          );
        }
      };
      enqueue(from.chapter, from.index);
      setState('playing');
    },
    [finish, mark, recordingsOf],
  );

  /** 从视口里第一段开始读第 at 章：先请阅读器切段落（连同还没切过的后面各章），回报后由 onBlocks 开始 */
  const start = useCallback(
    (at: number) => {
      void (async () => {
        const { id, chapters } = bookRef.current;
        const following = chapters.map((_, i) => i).filter((i) => i > at && !segments.current.has(i));
        const dir = bookDir(id);
        const markdowns = await Promise.all(following.map((i) => new File(dir, chapters[i].file).text().catch(() => '')));
        collecting.current = { chapter: at, following };
        send({ type: 'ttsCollect', following: markdowns });
      })();
    },
    [send],
  );

  const onBlocks = useCallback(
    (list: string[], from: number, following: string[][]) => {
      const req = collecting.current;
      if (!req) return;
      collecting.current = null;
      segments.current.set(req.chapter, list);
      req.following.forEach((c, k) => segments.current.set(c, following[k] ?? []));
      // 段落重新切过，录音要重新对
      recordings.current.delete(req.chapter);
      req.following.forEach((c) => recordings.current.delete(c));
      if (list.length === 0) return;
      // 从显示的这一章开始读，不算换章
      reading.current = req.chapter;
      speakFrom({ chapter: req.chapter, index: from }, rate, voiceId).catch(finish);
    },
    [finish, rate, speakFrom, voiceId],
  );

  const pause = useCallback(() => {
    engineRef.current.pause();
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    interrupted.current = false;
    // 暂停期间定时到了点：不再按它停
    if (deadline.current !== null && Date.now() >= deadline.current) chooseSleep(null);
    // 暂停期间改过语速：已排队的段落还是旧语速，从当前段落重新排
    if (rateChanged.current) {
      rateChanged.current = false;
      speakFrom({ chapter: reading.current, index: current.current }, rate, voiceId).catch(finish);
      return;
    }
    const engine = engineRef.current;
    void activateAudio()
      .then(() => engine.resume())
      .catch(() => {});
    setState('playing');
  }, [chooseSleep, finish, rate, speakFrom, voiceId]);

  /** 换到下一档语速；朗读中从当前段落按新语速重读，暂停中等继续时再生效 */
  const cycleRate = useCallback(() => {
    const next = SPEECH_RATES[(SPEECH_RATES.indexOf(rate as (typeof SPEECH_RATES)[number]) + 1) % SPEECH_RATES.length];
    setRate(next);
    void setSetting(RATE_KEY, next);
    // 原声直接改播放速度，不用从段首重读
    const { setRate: live } = engineRef.current;
    if (state !== 'idle' && live) live(next);
    else if (state === 'playing') speakFrom({ chapter: reading.current, index: current.current }, next, voiceId).catch(finish);
    else if (state === 'paused') rateChanged.current = true;
  }, [finish, rate, speakFrom, state, voiceId]);

  /** 换语音（null 为自动）：朗读或暂停中都从当前段落用新语音接着读，选完马上能听到 */
  const chooseVoice = useCallback(
    (id: string | null) => {
      setVoiceId(id);
      void setSetting(VOICE_KEY, id);
      if (state !== 'idle') speakFrom({ chapter: reading.current, index: current.current }, rate, id).catch(finish);
    },
    [finish, rate, speakFrom, state],
  );

  /** 跳到本章第 i 段（上一段 / 下一段 / 拖进度条），暂停中也直接开始读 */
  const seek = useCallback(
    (i: number) => {
      const texts = segments.current.get(reading.current) ?? [];
      if (state === 'idle' || texts.length === 0) return;
      const to = Math.min(texts.length - 1, Math.max(0, i));
      speakFrom({ chapter: reading.current, index: to }, rate, voiceId, true).catch(finish);
    },
    [finish, rate, speakFrom, state, voiceId],
  );

  /** 锁屏、耳机的下一段：本章最后一段时跳到下一章开头 */
  const skipNext = useCallback(() => {
    const last = (segments.current.get(reading.current)?.length ?? 0) - 1;
    const next = nextChapter(segments.current, bookRef.current.chapters.length, reading.current);
    if (current.current >= last && next !== null) {
      speakFrom({ chapter: next, index: 0 }, rate, voiceId, true).catch(finish);
    } else seek(current.current + 1);
  }, [finish, rate, seek, speakFrom, voiceId]);

  /** 阅读器显示出自动换到的章节后，标出正在读的段落并滚过去 */
  const resync = useCallback(() => {
    if (state !== 'idle') mark(current.current, true);
  }, [mark, state]);

  // 锁屏、控制中心的「正在播放」跟着章节和播放状态变
  const title = chapter !== null ? book.chapters[chapter]?.title : undefined;
  useEffect(() => {
    if (state === 'idle' || chapter === null) return;
    void updateNowPlaying({
      title: title ?? `第 ${chapter + 1} 章`,
      artist: book.title ?? '',
      artwork: cover,
      playing: state === 'playing',
    });
  }, [book.title, chapter, cover, state, title]);

  const handlers = useRef({ state, pause, resume, seek, skipNext });
  useEffect(() => {
    handlers.current = { state, pause, resume, seek, skipNext };
  });
  useEffect(() => {
    const sub = addNowPlayingListener((command: NowPlayingCommand) => {
      const h = handlers.current;
      if (h.state === 'idle') return;
      const playing = h.state === 'playing';
      switch (command) {
        case 'play':
          if (!playing) h.resume();
          break;
        case 'pause':
        case 'unplugged':
          if (playing) h.pause();
          break;
        case 'toggle':
          if (playing) h.pause();
          else h.resume();
          break;
        case 'next':
          h.skipNext();
          break;
        case 'previous':
          h.seek(current.current - 1);
          break;
        case 'interrupted':
          if (playing) {
            h.pause();
            interrupted.current = true;
          }
          break;
        case 'resumable':
          if (interrupted.current) h.resume();
          break;
      }
    });
    return () => sub.remove();
  }, []);

  const voice = resolveVoice(voices, voiceId);

  return {
    state,
    rate,
    voices,
    voiceId,
    voice,
    /** 本书有原声 */
    hasOriginal: audio !== null,
    /** 正在读的这一章：在用哪种声音、有没有原声 */
    engineKind,
    chapterOriginal,
    chapter,
    index,
    total,
    away,
    sleep,
    /** 阅读器回报的 ttsAway */
    onAway: setAway,
    start,
    onBlocks,
    pause,
    resume,
    stop: finish,
    cycleRate,
    chooseVoice,
    chooseSleep,
    seek,
    resync,
  };
}

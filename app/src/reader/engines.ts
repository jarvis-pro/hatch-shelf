import { createAudioPlaylist, type AudioPlaylist } from 'expo-audio';
import * as Speech from 'expo-speech';

/**
 * 听书的播放引擎（README 第 8.1 节）：系统语音（expo-speech）和原声（expo-audio 播预生成的录音）。
 * 两者都是「排队读一段段文字」：排进去的段落依次读，每段开始和结束时回调；
 * 队列、换章、定时、跳段、锁屏控制都在 speech.ts 里只写一次。
 */

export interface Utterance {
  text: string;
  /** 这一段的录音文件（uri，按顺序播放）；只有原声引擎用 */
  files?: string[];
  onStart(): void;
  onDone(): void;
  onError(): void;
}

export interface SpeakOptions {
  rate: number;
  /** 系统语音的 identifier；原声引擎不用 */
  voice?: string;
}

export interface Engine {
  /** 排到队尾；队列空着时马上开始读 */
  speak(u: Utterance, opts: SpeakOptions): void;
  pause(): void;
  resume(): void;
  /** 清空队列；之后不再回调已排队的段落 */
  stop(): Promise<void>;
  /** 不打断地改语速；不支持的引擎（系统语音）由调用方从当前段落重新排队 */
  setRate?(rate: number): void;
}

export const systemEngine: Engine = {
  speak(u, { rate, voice }) {
    Speech.speak(u.text, { language: 'zh-CN', voice, rate, onStart: u.onStart, onDone: u.onDone, onError: u.onError });
  },
  pause: () => void Speech.pause(),
  resume: () => void Speech.resume(),
  stop: () => Speech.stop(),
};

interface Track {
  u: Utterance;
  /** 这一段的第几个文件；0 开始时算这一段开始，最后一个读完算这一段读完 */
  part: number;
  last: boolean;
}

/**
 * 原声：所有段落的录音排进同一个播放列表（AVQueuePlayer），段与段、章与章之间无缝衔接，
 * 后台锁屏时也不会因为没有声音的间隙被挂起。不开启 expo-audio 自己的锁屏控制，
 * 「正在播放」仍由 now-playing 模块负责。语速用 AVPlayerItem 默认的保持音调变速
 */
function createRecordingEngine(): Engine {
  let playlist: AudioPlaylist | null = null;
  let tracks: Track[] = [];
  let subs: { remove(): void }[] = [];
  /** 列表已经播完；再排进来的段落（中间隔了一章系统语音）开一个新列表 */
  let finished = false;

  const close = () => {
    const p = playlist;
    playlist = null;
    tracks = [];
    finished = false;
    for (const s of subs) s.remove();
    subs = [];
    if (p) {
      p.pause();
      p.release();
    }
  };

  const done = (t: Track | undefined) => {
    if (t?.last) t.u.onDone();
  };

  const open = (rate: number) => {
    const p = createAudioPlaylist({ updateInterval: 1000 });
    p.playbackRate = rate;
    subs = [
      p.addListener('trackChanged', ({ previousIndex, currentIndex }) => {
        if (playlist !== p) return;
        done(tracks[previousIndex]);
        const t = tracks[currentIndex];
        if (t?.part === 0) t.u.onStart();
      }),
      p.addListener('playlistStatusUpdate', (s) => {
        if (playlist !== p || !s.didJustFinish || finished) return;
        finished = true;
        done(tracks[s.currentIndex]);
      }),
    ];
    playlist = p;
    return p;
  };

  return {
    speak(u, { rate }) {
      const files = u.files ?? [];
      if (files.length === 0) return u.onError();
      if (finished) close();
      const fresh = !playlist;
      const p = playlist ?? open(rate);
      files.forEach((uri, part) => {
        tracks.push({ u, part, last: part === files.length - 1 });
        p.add({ uri });
      });
      if (fresh) {
        p.play();
        u.onStart();
      }
    },
    pause: () => playlist?.pause(),
    resume: () => playlist?.play(),
    setRate(rate) {
      if (playlist) playlist.playbackRate = rate;
    },
    async stop() {
      close();
    },
  };
}

export const recordingEngine = createRecordingEngine();

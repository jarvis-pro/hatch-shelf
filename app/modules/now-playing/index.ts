import { requireOptionalNativeModule, type EventSubscription, type NativeModule } from 'expo';

/**
 * 锁屏「正在播放」与锁屏按钮、耳机线控（ios/NowPlayingModule.swift）。
 * 只有 iOS 实现；其他平台或还没重新构建 dev client 时为空操作
 */

export type NowPlayingCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'interrupted' | 'resumable' | 'unplugged';

export interface NowPlayingInfo {
  /** 章节名 */
  title: string;
  /** 书名 */
  artist: string;
  /** 封面 cover.png 的 file:// URL */
  artwork?: string | null;
  playing: boolean;
}

declare class NowPlayingNative extends NativeModule<{ onCommand(e: { command: NowPlayingCommand }): void }> {
  update(info: NowPlayingInfo): Promise<void>;
  clear(): Promise<void>;
}

const native = requireOptionalNativeModule<NowPlayingNative>('NowPlaying');

export function updateNowPlaying(info: NowPlayingInfo) {
  return native?.update(info) ?? Promise.resolve();
}

export function clearNowPlaying() {
  return native?.clear() ?? Promise.resolve();
}

export function addNowPlayingListener(listener: (command: NowPlayingCommand) => void): EventSubscription {
  return native?.addListener('onCommand', (e) => listener(e.command)) ?? { remove() {} };
}

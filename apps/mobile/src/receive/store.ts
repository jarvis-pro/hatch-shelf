import type { Pairing, SessionItem, SessionLog, SessionRequest } from '@shelf/spec';
import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { getBook, type BookRow } from '@/db/queries';
import type { ImportResult } from '@/import/pipeline';
import { notifyLibraryChanged } from '@/library/events';
import { startLanServer, type LanServer, type LanSession, type ReceivingUpload } from '@/server/lan-server';
import { loadComputers, removeComputer, saveComputer, type Computer } from './computers';

/**
 * 接收模式（README 第 5.2 节）：从书架「+」或扫码进入，开着局域网服务等 Dock 推送。
 * 状态放在模块里而不是某个页面里：离开接收页去看书时服务继续运行，顶部胶囊和接收页读同一份状态。
 */

/** 多久没有任何请求就自动结束 */
export const IDLE_MS = 5 * 60 * 1000;
/** 推送完成后多久自动结束 */
export const DONE_SECONDS = 8;

export type Phase =
  /** 没有开 */
  | 'off'
  /** 服务开着，等 Dock 发起推送 */
  | 'waiting'
  /** Dock 请求推送，等手机上确认 */
  | 'confirm'
  | 'receiving'
  /** 推送完了，倒计时后自动结束 */
  | 'done';

export type Entry =
  | { type: 'book'; bookId: string; result: Extract<ImportResult, { ok: true }>; book: BookRow | null; audioChapters: number }
  | { type: 'failed'; fileName: string; error: string }
  | { type: 'log'; log: SessionLog };

export interface ReceiveState {
  phase: Phase;
  error: string | null;
  /** 最近一次连上的电脑（刚扫码时就是二维码里的那台） */
  peer: Computer | null;
  /** 等待确认的推送 */
  request: (SessionRequest & { peer: Computer | null }) | null;
  /** 已确认的这次推送里的书，用来显示「第几本 / 共几本」 */
  plan: SessionItem[];
  entries: Entry[];
  /** 正在上传的文件；同时有多个时取最慢的 */
  current: (ReceivingUpload & { item: SessionItem | null }) | null;
  /** done 阶段剩余秒数 */
  countdown: number;
}

const initial: ReceiveState = { phase: 'off', error: null, peer: null, request: null, plan: [], entries: [], current: null, countdown: 0 };

let state = initial;
const listeners = new Set<() => void>();
const set = (patch: Partial<ReceiveState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const getReceiveState = () => state;

export function useReceive(): ReceiveState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let server: LanServer | null = null;
let computers: Computer[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let doneTimer: ReturnType<typeof setInterval> | null = null;
/** 回应挂起的推送请求 */
let answer: ((accepted: boolean) => void) | null = null;
const uploading = new Map<number, ReceivingUpload>();
let session: LanSession | null = null;

const resetIdle = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopReceiving, IDLE_MS);
};

/** 上传的文件名是 `<id>.zip` 或原声包 `<id>.audio.<章>.zip`，按 id 找到推送清单里的那本书 */
const itemOf = (name: string | undefined) => {
  const id = name?.replace(/(\.audio\..*)?\.(zip|md|markdown)$/i, '');
  return state.plan.find((i) => i.id === id) ?? null;
};

function updateCurrent() {
  const all = [...uploading.values()];
  const slowest = all.length ? all.reduce((a, b) => (b.ratio < a.ratio ? b : a)) : null;
  set({ current: slowest && { ...slowest, item: itemOf(slowest.name) } });
}

async function addResult(r: ImportResult) {
  if (!r.ok) {
    set({ entries: [...state.entries, { type: 'failed', fileName: r.fileName, error: r.error }] });
    return;
  }
  notifyLibraryChanged();
  const book = await getBook(r.bookId);
  const i = state.entries.findIndex((e) => e.type === 'book' && e.bookId === r.bookId);
  if (i < 0) {
    const audioChapters = r.status === 'audio' ? r.chapters : 0;
    set({ entries: [...state.entries, { type: 'book', bookId: r.bookId, result: r, book, audioChapters }] });
    return;
  }
  // 同一本书先推书、再按章推原声：合成一行，原声章数累加，状态保留书本身的（新书 / 已更新）
  const old = state.entries[i] as Extract<Entry, { type: 'book' }>;
  const merged: Entry = {
    ...old,
    book,
    result: r.status === 'audio' ? old.result : r,
    audioChapters: old.audioChapters + (r.status === 'audio' ? r.chapters : 0),
  };
  set({ entries: state.entries.map((e, j) => (j === i ? merged : e)) });
}

function listen() {
  server?.stop();
  uploading.clear();
  server = startLanServer({
    session: { get: () => session, set: (s) => (session = s) },
    isPaired: (key) => computers.some((c) => c.key === key),
    onActivity: (key) => {
      resetIdle();
      const peer = computers.find((c) => c.key === key) ?? null;
      if (peer && peer.key !== state.peer?.key) set({ peer });
    },
    onSessionRequest: (key, request, cancelled) =>
      new Promise<boolean>((resolve) => {
        answer?.(false);
        answer = resolve;
        // 推送完成的倒计时里又来了一次推送：停止倒计时，等这次确认
        if (doneTimer) clearInterval(doneTimer);
        doneTimer = null;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        set({ phase: 'confirm', request: { ...request, peer: computers.find((c) => c.key === key) ?? null } });
        void cancelled.then(() => {
          if (answer !== resolve) return;
          answer = null;
          resolve(false);
          if (state.phase === 'confirm') set({ phase: 'waiting', request: null });
        });
      }),
    onSessionLog: (log) => set({ entries: [...state.entries, { type: 'log', log }] }),
    // Dock 上点了「断开连接」：同一时间只连一台手机，断开就是解除配对，下次要重新扫码
    onBye: (key) => {
      computers = computers.filter((c) => c.key !== key);
      void removeComputer(key);
      stopReceiving();
    },
    onSessionEnd: () => {
      if (state.phase !== 'receiving') return;
      set({ phase: 'done', countdown: DONE_SECONDS, current: null });
      if (doneTimer) clearInterval(doneTimer);
      doneTimer = setInterval(() => {
        if (state.countdown <= 1) stopReceiving();
        else set({ countdown: state.countdown - 1 });
      }, 1000);
    },
    onReceiving: (key, upload) => {
      if (upload === null) uploading.delete(key);
      else uploading.set(key, upload);
      updateCurrent();
    },
    onUpload: (r) => void addResult(r),
    onError: (error) => {
      server?.stop();
      server = null;
      set({ ...initial, error });
    },
  });
}

/** 进入接收模式；已经开着时什么都不做 */
export async function startReceiving() {
  computers = await loadComputers();
  if (server) return;
  set({ ...initial, phase: 'waiting', peer: state.peer ?? computers[0] ?? null });
  listen();
  resetIdle();
}

/** 扫码配对：记下这台电脑并进入接收模式 */
export async function pairAndReceive(p: Pairing) {
  const computer = await saveComputer(p);
  computers = await loadComputers();
  if (!server) {
    set({ ...initial, phase: 'waiting', peer: computer });
    listen();
    resetIdle();
  } else set({ peer: computer });
}

export function stopReceiving() {
  answer?.(false);
  answer = null;
  session = null;
  server?.stop();
  server = null;
  uploading.clear();
  if (idleTimer) clearTimeout(idleTimer);
  if (doneTimer) clearInterval(doneTimer);
  idleTimer = doneTimer = null;
  set({ ...initial, peer: state.peer });
}

/** 确认框上点「开始接收」或「拒绝」 */
export function answerRequest(accepted: boolean) {
  const req = state.request;
  answer?.(accepted);
  answer = null;
  if (accepted && req) set({ phase: 'receiving', request: null, plan: req.items, entries: [], current: null });
  else set({ phase: 'waiting', request: null });
}

/** 已配对列表变了（设置里删掉了某台电脑） */
export async function reloadComputers() {
  computers = await loadComputers();
}

/** 第几本 / 共几本：已收完的书 + 正在传的那本 */
export function progressOf(s: ReceiveState) {
  const total = s.plan.length;
  const done = s.plan.filter((i) => s.entries.some((e) => e.type === 'book' && e.bookId === i.id)).length;
  const current = s.current?.item && !s.entries.some((e) => e.type === 'book' && e.bookId === s.current!.item!.id) ? 1 : 0;
  return { index: Math.min(total, done + current) || Math.min(total, 1), total };
}

// 后台期间监听的端口可能被系统回收：回到前台时重新监听，电脑端不用做什么
let prevApp = AppState.currentState;
AppState.addEventListener('change', (s) => {
  if (s === 'active' && prevApp === 'background' && server) listen();
  prevApp = s;
});

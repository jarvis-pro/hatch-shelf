import { useSyncExternalStore } from 'react';

/** 传书服务是否在运行：服务开启后会一直运行到手动停止，Tab 栏据此在「传书」上显示状态点 */
let running = false;
const listeners = new Set<() => void>();

export function setLanRunning(value: boolean) {
  if (running === value) return;
  running = value;
  listeners.forEach((l) => l());
}

export function useLanRunning() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => running,
  );
}

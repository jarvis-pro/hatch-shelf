import { useEffect } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();

/** 书架内容变化（导入、删除）时通知已挂载的页面刷新 */
export function notifyLibraryChanged() {
  listeners.forEach((l) => l());
}

export function useLibraryChanged(listener: Listener) {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

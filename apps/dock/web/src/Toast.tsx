import { Check, CircleAlert, Info, Unplug, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface Notice {
  text: string;
  /** 跟在正文后面的一段浅色说明，如失败原因 */
  sub?: string;
  tone: 'ok' | 'error' | 'info';
  /** 不给时按 tone 取：成功打勾、失败打叉、提示是 i */
  icon?: 'check' | 'x' | 'alert' | 'info' | 'unplug';
}

const ICONS: Record<NonNullable<Notice['icon']>, LucideIcon> = { check: Check, x: X, alert: CircleAlert, info: Info, unplug: Unplug };
const DEFAULT_ICON = { ok: 'check', error: 'x', info: 'info' } as const;
/** 成功和提示 4 秒，失败 6 秒 */
const DURATION = { ok: 4000, info: 4000, error: 6000 };
const LEAVE_MS = 220;

/**
 * 通用 Toast（设计稿「组件 / Toast」与「⑥ 通用 Toast」，左侧色条卡片）：一次性的结果都用它，顶栏下方居中，自动消失，鼠标停在上面时不消失。
 * 同一时间只有一条，新的替换旧的
 */
export function Toast({ notice, onDone }: { notice: Notice | null; onDone(): void }) {
  const [shown, setShown] = useState(notice);
  const [leaving, setLeaving] = useState(false);
  const [hover, setHover] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  if (notice && notice !== shown) {
    setShown(notice);
    setLeaving(false);
  }

  useEffect(() => {
    if (!shown || hover || leaving) return;
    const id = setTimeout(() => setLeaving(true), DURATION[shown.tone]);
    return () => clearTimeout(id);
  }, [shown, hover, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => {
      setShown(null);
      setLeaving(false);
      done.current();
    }, LEAVE_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  if (!shown) return null;
  const Icon = ICONS[shown.icon ?? DEFAULT_ICON[shown.tone]];
  return (
    <div
      key={shown.text}
      className={`toast ${shown.tone}${leaving ? ' leaving' : ''}`}
      role={shown.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="toast-ic">
        <Icon size={15} />
      </span>
      <div className="toast-text">
        <b>{shown.text}</b>
        {shown.sub && <span>{shown.sub}</span>}
      </div>
    </div>
  );
}

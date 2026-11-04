export const TMP_PREFIX = '.tmp-';
export const OLD_PREFIX = '.old-';

export interface RecoveryPlan {
  /** 把 `.old-<id>` 改回 `<id>`：替换到一半被中断，新版还没就位 */
  restore: string[];
  /** 直接删掉的残留目录：没写完的 `.tmp-<id>`，以及新版已就位的 `.old-<id>` */
  remove: string[];
}

/**
 * 根据 books/ 下的目录名，决定怎么收拾 writeBookAtomically 被中断后留下的残局。
 * 纯函数，便于测试；实际的改名和删除在 fs.ts 的 recoverInterruptedWrites 里做。
 */
export function planRecovery(names: string[]): RecoveryPlan {
  const present = new Set(names);
  const plan: RecoveryPlan = { restore: [], remove: [] };
  for (const name of names) {
    if (name.startsWith(TMP_PREFIX)) {
      plan.remove.push(name);
    } else if (name.startsWith(OLD_PREFIX)) {
      const id = name.slice(OLD_PREFIX.length);
      if (id && !present.has(id)) plan.restore.push(name);
      else plan.remove.push(name);
    }
  }
  return plan;
}

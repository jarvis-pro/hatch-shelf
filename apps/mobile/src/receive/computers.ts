import type { Pairing } from '@shelf/spec';
import { getSetting, setSetting } from '@/db/queries';

/** 扫码配对过的电脑（README 第 5.2 节）。存在 settings 表里，不进阅读数据备份 */
export interface Computer extends Pairing {
  pairedAt: number;
}

const KEY = 'pairedComputers';

export const loadComputers = () => getSetting<Computer[]>(KEY, []);

/** 同一个密钥再扫一次只更新名字；返回保存后的这台电脑 */
export async function saveComputer(p: Pairing): Promise<Computer> {
  const list = await loadComputers();
  const old = list.find((c) => c.key === p.key);
  const computer = { ...p, pairedAt: old?.pairedAt ?? Date.now() };
  await setSetting(KEY, [computer, ...list.filter((c) => c.key !== p.key)]);
  return computer;
}

export async function removeComputer(key: string) {
  await setSetting(
    KEY,
    (await loadComputers()).filter((c) => c.key !== key),
  );
}

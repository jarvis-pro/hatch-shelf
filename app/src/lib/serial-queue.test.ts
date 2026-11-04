import { describe, expect, it } from 'vitest';
import { createSerialQueue } from './serial-queue';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('createSerialQueue', () => {
  it('一次只跑一个任务，按提交顺序执行', async () => {
    const run = createSerialQueue();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} 开始`);
      await tick();
      log.push(`${name} 结束`);
      return name;
    };
    const results = await Promise.all([run(task('a')), run(task('b'))]);
    expect(results).toEqual(['a', 'b']);
    expect(log).toEqual(['a 开始', 'a 结束', 'b 开始', 'b 结束']);
  });

  it('前一个任务失败不影响后面的任务', async () => {
    const run = createSerialQueue();
    const failed = run(() => Promise.reject(new Error('坏了')));
    const next = run(() => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('坏了');
    await expect(next).resolves.toBe('ok');
  });
});

/**
 * 串行执行的任务队列：上一个任务结束（成功或失败）后才开始下一个。
 * 某个任务失败只影响它自己的调用方，不会让后面的任务停下来。
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
}

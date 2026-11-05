import { router } from 'expo-router';
import { loadComputers } from './computers';
import { startReceiving } from './store';

/** 「从电脑接收」：还没配对过电脑时先去扫码，配对过就直接开始接收 */
export async function openReceive() {
  if ((await loadComputers()).length === 0) {
    router.push('/scan');
    return;
  }
  await startReceiving();
  router.push('/receive');
}

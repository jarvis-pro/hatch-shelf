import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DOCK_PORT } from './server/config';

// 页面由 server/main.ts 在 DOCK_PORT 上提供；开发时 vite 跑在下一个端口，/api 转给服务端
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: DOCK_PORT + 1, strictPort: true, proxy: { '/api': `http://127.0.0.1:${DOCK_PORT}` } },
});

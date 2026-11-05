import { defineConfig } from 'vitest/config';

// 测试不走 vite.config.ts（那里的根目录是网页的 web/）
export default defineConfig({ test: { include: ['shared/**/*.test.ts', 'server/**/*.test.ts'] } });

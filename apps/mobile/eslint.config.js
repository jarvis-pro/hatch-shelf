// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', 'assets/*', 'src/samples.generated.ts', '.expo/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // SDK 58 的不少 API（如 File.write）是异步的，漏掉 await 会产生难查的竞态
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
]);

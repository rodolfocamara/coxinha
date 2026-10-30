import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    // Native Node storage shadows jsdom in Node 26 without a storage file.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['src-tauri/**', 'node_modules/**'],
    // Route/remount integration tests take 1-2s alone and exceed the 5s default
    // when ~100 files run in parallel on a loaded machine.
    testTimeout: 15_000,
  },
});

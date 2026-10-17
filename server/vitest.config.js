import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './test/global-setup.js',
    setupFiles: ['./test/setup.js'],
    hookTimeout: 120000,
    testTimeout: 30000,
    // Each file gets its own database, but they share one server; running
    // files sequentially keeps the concurrency test honest.
    fileParallelism: false
  }
});

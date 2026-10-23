import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Set here, not in setupFiles: ESM imports are hoisted, so assignments in
    // a setup file run after config/env.js has already read the environment.
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-jwt-secret-not-used-anywhere-real',
      TICKET_SECRET: 'test-only-ticket-secret-not-used-anywhere-real',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/gateguard_test_placeholder',
      RATE_LIMIT_DISABLED: '1',
      OTP_DEV_ECHO: '1',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: 'http://localhost:5173'
    },
    globalSetup: './test/global-setup.js',
    setupFiles: ['./test/setup.js'],
    hookTimeout: 120000,
    testTimeout: 30000,
    // Each file gets its own database, but they share one server; running
    // files sequentially keeps the concurrency test honest.
    fileParallelism: false
  }
});

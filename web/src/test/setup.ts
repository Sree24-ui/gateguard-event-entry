import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

// jsdom ships no SubtleCrypto; the offline ticket hash needs it.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

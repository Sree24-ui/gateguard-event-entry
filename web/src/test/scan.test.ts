import { describe, it, expect } from 'vitest';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { parseScanPayload, hashCode, offlineVerdict, newScanId } from '../lib/scan';
import type { OfflineManifest } from '../lib/types';

const EVENT = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const SECRET = 'test-ticket-secret-value';

/** Mirrors the server's buildQrPayload so the two stay in step. */
function serverPayload(eventId: string, code: string) {
  const sig = createHmac('sha256', SECRET)
    .update(`${eventId}:${code}`)
    .digest('base64url')
    .slice(0, 24);
  return `GG1:${eventId}:${code}:${sig}`;
}

const newCode = () => randomBytes(16).toString('base64url');

describe('parseScanPayload', () => {
  it('accepts a payload the server produced', () => {
    const code = newCode();
    expect(parseScanPayload(serverPayload(EVENT, code))).toEqual({
      ok: true,
      code,
      eventId: EVENT,
      signed: true,
      rotating: false
    });
  });

  it('accepts a bare code as manual entry', () => {
    const code = newCode();
    expect(parseScanPayload(` ${code} `)).toEqual({
      ok: true,
      code,
      eventId: null,
      signed: false,
      rotating: false
    });
  });

  it('rejects anything that is not a GateGuard ticket', () => {
    for (const input of [
      '',
      '   ',
      'https://example.com/qr',
      'GG1:short:abc:def',
      'GG9:' + EVENT + ':' + newCode() + ':sig',
      `GG1:${EVENT}:${newCode()}`,
      `GG1:${EVENT}:!!!!!!!!!!!!!!!!:sig`
    ]) {
      expect(parseScanPayload(input), input).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('does not try to verify the signature — the key stays on the server', () => {
    const code = newCode();
    const forged = `GG1:${EVENT}:${code}:${'x'.repeat(24)}`;
    // The device cannot tell; it reports structure only and lets the server decide.
    expect(parseScanPayload(forged)).toMatchObject({ ok: true, signed: true });
  });
});

describe('rotating codes on the device', () => {
  function rotating(eventId: string, code: string, counter: number) {
    const sig = createHmac('sha256', SECRET)
      .update(`${eventId}:${code}:${counter}`)
      .digest('base64url')
      .slice(0, 24);
    return `GG2:${eventId}:${code}:${counter}:${sig}`;
  }

  it('reads the ticket out of a rotating code', () => {
    const code = newCode();
    expect(parseScanPayload(rotating(EVENT, code, 58_000_000))).toEqual({
      ok: true,
      code,
      eventId: EVENT,
      signed: true,
      rotating: true
    });
  });

  it('does not judge expiry on the device — only the server knows', () => {
    const code = newCode();
    // A counter from years ago still parses; the server is what refuses it.
    expect(parseScanPayload(rotating(EVENT, code, 1))).toMatchObject({ ok: true, rotating: true });
  });

  it('rejects a malformed rotating code', () => {
    const code = newCode();
    for (const input of [
      `GG2:${EVENT}:${code}:notanumber:sig`,
      `GG2:${EVENT}:${code}:123`,
      `GG2:short:${code}:123:sig`
    ]) {
      expect(parseScanPayload(input), input).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('still reads the static code, which is what offline and print use', () => {
    const code = newCode();
    expect(parseScanPayload(serverPayload(EVENT, code))).toMatchObject({
      ok: true,
      rotating: false
    });
  });
});

describe('hashCode', () => {
  it('matches the server offlineHash exactly', async () => {
    const code = newCode();
    const server = createHash('sha256').update(code).digest('hex').slice(0, 16);
    await expect(hashCode(code)).resolves.toBe(server);
  });
});

describe('offlineVerdict', () => {
  const code = newCode();
  let manifest: OfflineManifest;

  async function build(overrides: Partial<OfflineManifest> = {}) {
    const hash = await hashCode(code);
    manifest = {
      eventId: EVENT,
      eventName: 'Test Fest',
      gates: ['Main Gate'],
      issuedAt: new Date().toISOString(),
      count: 1,
      validHashes: [hash],
      checkedInHashes: [],
      ...overrides
    };
    return hash;
  }

  it('provisionally admits a code in the cached set', async () => {
    await build();
    const parsed = parseScanPayload(serverPayload(EVENT, code));
    await expect(offlineVerdict(parsed, manifest, new Set())).resolves.toMatchObject({
      verdict: 'provisional_admit'
    });
  });

  it('refuses a code that is not in the cached set', async () => {
    await build();
    const parsed = parseScanPayload(serverPayload(EVENT, newCode()));
    await expect(offlineVerdict(parsed, manifest, new Set())).resolves.toMatchObject({
      verdict: 'unknown'
    });
  });

  it('refuses a ticket for another event', async () => {
    await build();
    const parsed = parseScanPayload(serverPayload('b'.repeat(24), code));
    await expect(offlineVerdict(parsed, manifest, new Set())).resolves.toMatchObject({
      verdict: 'wrong_event'
    });
  });

  it('refuses a code this device already let through', async () => {
    const hash = await build();
    const parsed = parseScanPayload(serverPayload(EVENT, code));
    await expect(offlineVerdict(parsed, manifest, new Set([hash]))).resolves.toMatchObject({
      verdict: 'already_admitted_here'
    });
  });

  it('reports already-checked-in from the last sync', async () => {
    const hash = await hashCode(code);
    await build({ checkedInHashes: [hash] });
    const parsed = parseScanPayload(serverPayload(EVENT, code));
    await expect(offlineVerdict(parsed, manifest, new Set())).resolves.toMatchObject({
      verdict: 'already_checked_in'
    });
  });

  it('defers to the server when the device has no cached list', async () => {
    const parsed = parseScanPayload(serverPayload(EVENT, code));
    await expect(offlineVerdict(parsed, undefined, new Set())).resolves.toMatchObject({
      verdict: 'no_manifest'
    });
  });
});

describe('newScanId', () => {
  it('does not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, newScanId));
    expect(ids.size).toBe(500);
  });
});

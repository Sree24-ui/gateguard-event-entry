import type { OfflineManifest } from './types';

export const QR_PREFIX = 'GG1';

export type ParsedScan =
  | { ok: true; code: string; eventId: string | null; signed: boolean }
  | { ok: false; reason: 'malformed' };

const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Structural parse of a scanned string. The signature is NOT verified here:
 * the HMAC key lives only on the server. The device can tell a GateGuard
 * ticket from a random QR, and nothing more.
 */
export function parseScanPayload(raw: string): ParsedScan {
  const input = (raw || '').trim();
  if (!input) return { ok: false, reason: 'malformed' };

  if (!input.includes(':')) {
    if (!CODE_RE.test(input)) return { ok: false, reason: 'malformed' };
    return { ok: true, code: input, eventId: null, signed: false };
  }

  const parts = input.split(':');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [prefix, eventId, code] = parts;
  if (prefix !== QR_PREFIX) return { ok: false, reason: 'malformed' };
  if (!/^[a-f0-9]{24}$/i.test(eventId)) return { ok: false, reason: 'malformed' };
  if (!CODE_RE.test(code)) return { ok: false, reason: 'malformed' };
  return { ok: true, code, eventId, signed: true };
}

/** Must match the server's `offlineHash`: first 16 hex chars of SHA-256. */
export async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export type OfflineVerdict =
  | 'provisional_admit'
  | 'already_admitted_here'
  | 'already_checked_in'
  | 'wrong_event'
  | 'unknown'
  | 'malformed'
  | 'no_manifest';

/**
 * The judgement an offline device is entitled to make. "provisional_admit"
 * means the code is in this event's preloaded valid set — never that the
 * check-in is official. Only the server can say that.
 */
export async function offlineVerdict(
  parsed: ParsedScan,
  manifest: OfflineManifest | undefined,
  locallyAdmitted: Set<string>
): Promise<{ verdict: OfflineVerdict; hash?: string }> {
  if (!parsed.ok) return { verdict: 'malformed' };
  if (!manifest) return { verdict: 'no_manifest' };
  if (parsed.eventId && parsed.eventId !== manifest.eventId) return { verdict: 'wrong_event' };

  const hash = await hashCode(parsed.code);
  if (locallyAdmitted.has(hash)) return { verdict: 'already_admitted_here', hash };
  if (!manifest.validHashes.includes(hash)) return { verdict: 'unknown', hash };
  if (manifest.checkedInHashes.includes(hash)) return { verdict: 'already_checked_in', hash };
  return { verdict: 'provisional_admit', hash };
}

/** Random enough that two devices never collide on a scan id. */
export function newScanId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

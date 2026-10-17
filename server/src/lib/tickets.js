import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const QR_PREFIX = 'GG1';
const SIG_LENGTH = 24; // base64url chars of the HMAC digest

/** 16 bytes of CSPRNG output -> 22 url-safe chars. Not enumerable. */
export function generateTicketCode() {
  return crypto.randomBytes(16).toString('base64url');
}

function sign(eventId, code) {
  return crypto
    .createHmac('sha256', env.ticketSecret)
    .update(`${eventId}:${code}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

/**
 * QR payload: GG1:<eventId>:<code>:<signature>
 * It deliberately carries no attendee name, email or phone, so a photographed
 * ticket leaks nothing about its holder.
 */
export function buildQrPayload(eventId, code) {
  const id = String(eventId);
  return `${QR_PREFIX}:${id}:${code}:${sign(id, code)}`;
}

/** Stable, non-reversible fingerprint used in scan logs. */
export function fingerprintCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 16);
}

/** Hash published in the offline manifest. Same function the client uses. */
export function offlineHash(code) {
  return fingerprintCode(code);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Parses a scanned string. Accepts a full signed payload or a bare ticket code
 * typed into the manual fallback field.
 *
 * Returns { ok: true, code, eventId, signed } or { ok: false, reason }
 * where reason is 'malformed' | 'invalid_signature'.
 */
export function parseScanInput(raw) {
  const input = String(raw || '').trim();
  if (!input) return { ok: false, reason: 'malformed' };

  if (!input.includes(':')) {
    // Manual entry: a bare code. Authenticity is decided by the database
    // lookup, since there is no signature to verify.
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(input)) return { ok: false, reason: 'malformed' };
    return { ok: true, code: input, eventId: null, signed: false };
  }

  const parts = input.split(':');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [prefix, eventId, code, signature] = parts;
  if (prefix !== QR_PREFIX) return { ok: false, reason: 'malformed' };
  if (!/^[a-f0-9]{24}$/i.test(eventId)) return { ok: false, reason: 'malformed' };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return { ok: false, reason: 'malformed' };
  if (!timingSafeEqual(signature, sign(eventId, code))) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true, code, eventId, signed: true };
}

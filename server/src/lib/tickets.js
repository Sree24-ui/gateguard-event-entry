import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const QR_PREFIX = 'GG1';        // static, signed once
export const QR_ROTATING_PREFIX = 'GG2'; // rotating, signed per time step
const SIG_LENGTH = 24; // base64url chars of the HMAC digest

/** How long one rotating code is valid for. */
export const TOKEN_STEP_MS = 30_000;
/**
 * Steps of slack either side of the server's own clock. One step tolerates a
 * phone 30s out of sync and a code shown just as it turns over; more than that
 * and a screenshot stays useful for too long.
 */
const TOKEN_WINDOW = 1;

export const currentCounter = (at = Date.now()) => Math.floor(at / TOKEN_STEP_MS);

/** 16 bytes of CSPRNG output -> 22 url-safe chars. Not enumerable. */
export function generateTicketCode() {
  return crypto.randomBytes(16).toString('base64url');
}

function sign(eventId, code, counter = null) {
  const message = counter === null ? `${eventId}:${code}` : `${eventId}:${code}:${counter}`;
  return crypto
    .createHmac('sha256', env.ticketSecret)
    .update(message)
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

/**
 * The rotating form. Valid for one 30-second step, so a forwarded screenshot
 * dies almost immediately. It does NOT stop someone sharing their live screen
 * — only the person at the gate can judge that.
 */
export function buildRotatingPayload(eventId, code, counter = currentCounter()) {
  const id = String(eventId);
  return `${QR_ROTATING_PREFIX}:${id}:${code}:${counter}:${sign(id, code, counter)}`;
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
    return { ok: true, code: input, eventId: null, signed: false, rotating: false, counter: null };
  }

  const parts = input.split(':');
  const prefix = parts[0];

  if (prefix === QR_ROTATING_PREFIX) {
    if (parts.length !== 5) return { ok: false, reason: 'malformed' };
    const [, eventId, code, rawCounter, signature] = parts;
    if (!/^[a-f0-9]{24}$/i.test(eventId)) return { ok: false, reason: 'malformed' };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return { ok: false, reason: 'malformed' };
    if (!/^\d{1,15}$/.test(rawCounter)) return { ok: false, reason: 'malformed' };

    const counter = Number(rawCounter);
    // Check the clock before the signature: an expired code is expired even
    // if it was signed correctly.
    if (Math.abs(counter - currentCounter()) > TOKEN_WINDOW) {
      return { ok: false, reason: 'expired' };
    }
    if (!timingSafeEqual(signature, sign(eventId, code, counter))) {
      return { ok: false, reason: 'invalid_signature' };
    }
    return { ok: true, code, eventId, signed: true, rotating: true, counter };
  }

  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [, eventId, code, signature] = parts;
  if (prefix !== QR_PREFIX) return { ok: false, reason: 'malformed' };
  if (!/^[a-f0-9]{24}$/i.test(eventId)) return { ok: false, reason: 'malformed' };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return { ok: false, reason: 'malformed' };
  if (!timingSafeEqual(signature, sign(eventId, code))) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true, code, eventId, signed: true, rotating: false, counter: null };
}

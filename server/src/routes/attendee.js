import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Ticket } from '../models/Ticket.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, issueSession } from '../middleware/auth.js';
import { wrap, badRequest, unauthorized, notFound } from '../lib/errors.js';
import { createLimiter } from '../lib/rateLimit.js';
import { buildQrPayload } from '../lib/tickets.js';

const router = express.Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const otpLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  message: 'Too many codes requested. Try again in a few minutes.'
});

const verifyLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many attempts. Try again in a few minutes.'
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190)
});

/** Six digits from a CSPRNG, not Math.random. */
const newOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Sends a sign-in code. Signing in is also signing up: an attendee is only
 * ever identified by an email that already appears on their tickets.
 */
router.post(
  '/otp/request',
  otpLimiter,
  validate(emailSchema),
  wrap(async (req, res) => {
    const { email } = req.body;
    const code = newOtp();

    await User.findOneAndUpdate(
      { email },
      {
        $set: {
          otpHash: await bcrypt.hash(code, 10),
          otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
          otpAttempts: 0
        },
        $setOnInsert: { email, name: email.split('@')[0], role: 'attendee' }
      },
      { upsert: true, new: true }
    );

    // ponytail: no email provider is wired up yet, so the code is logged and,
    // in development only, returned. Production needs a transport before this
    // is usable by a real attendee.
    console.log(`[gateguard] sign-in code for ${email}: ${code}`);

    res.json({
      sent: true,
      expiresInSeconds: OTP_TTL_MS / 1000,
      ...(env.otpDevEcho ? { devCode: code } : {})
    });
  })
);

router.post(
  '/otp/verify',
  verifyLimiter,
  validate(emailSchema.extend({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') })),
  wrap(async (req, res) => {
    const { email, code } = req.body;
    const user = await User.findOne({ email }).select('+otpHash');
    const invalid = unauthorized('That code is wrong or has expired');

    if (!user?.otpHash || !user.otpExpiresAt) throw invalid;
    if (user.otpExpiresAt.getTime() < Date.now()) throw invalid;
    if (user.otpAttempts >= OTP_MAX_ATTEMPTS) throw invalid;

    if (!(await bcrypt.compare(code, user.otpHash))) {
      await User.updateOne({ _id: user._id }, { $inc: { otpAttempts: 1 } });
      throw invalid;
    }

    // Single use.
    user.otpHash = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    user.lastLoginAt = new Date();
    await user.save();

    issueSession(res, user);
    res.json({ user: user.toPublic() });
  })
);

/** Every ticket issued to this attendee's email, across all events. */
router.get(
  '/tickets',
  requireAuth,
  requireRole('attendee'),
  wrap(async (req, res) => {
    const tickets = await Ticket.find({ 'attendee.email': req.user.email })
      .populate('event', 'name venue startsAt endsAt status reEntry')
      .sort({ createdAt: -1 })
      .limit(100);

    res.set('Cache-Control', 'no-store');
    res.json({
      tickets: tickets
        .filter((ticket) => ticket.event)
        .map((ticket) => ({
          code: ticket.code,
          qrPayload: buildQrPayload(ticket.event._id, ticket.code),
          status: ticket.status,
          state: ticket.state || (ticket.checkedInAt ? 'inside' : 'issued'),
          checkedInAt: ticket.checkedInAt,
          checkedInGate: ticket.checkedInGate,
          event: {
            id: ticket.event._id.toString(),
            name: ticket.event.name,
            venue: ticket.event.venue,
            startsAt: ticket.event.startsAt,
            endsAt: ticket.event.endsAt,
            status: ticket.event.status,
            reEntry: ticket.event.reEntry
          }
        }))
    });
  })
);

// --- Passkeys -------------------------------------------------------------
// The device checks the face or fingerprint itself and returns a signature.
// This server sees a public key and nothing else; no biometric is collected,
// transmitted or stored.

const rp = () => ({ rpID: env.rpId, origin: env.rpOrigin });

function storedCredentials(user) {
  return (user.passkeys || []).map((key) => ({
    id: key.credentialId,
    publicKey: Buffer.from(key.publicKey, 'base64url'),
    counter: key.counter
  }));
}

router.post(
  '/passkey/register/options',
  requireAuth,
  wrap(async (req, res) => {
    const options = await generateRegistrationOptions({
      rpName: 'GateGuard',
      rpID: rp().rpID,
      userName: req.user.email,
      userID: new TextEncoder().encode(req.user._id.toString()),
      attestationType: 'none',
      excludeCredentials: storedCredentials(req.user).map((key) => ({ id: key.id })),
      authenticatorSelection: {
        residentKey: 'preferred',
        // Forces the device to check the person, not just possession.
        userVerification: 'required',
        authenticatorAttachment: 'platform'
      }
    });

    await User.updateOne({ _id: req.user._id }, { $set: { currentChallenge: options.challenge } });
    res.json(options);
  })
);

router.post(
  '/passkey/register/verify',
  requireAuth,
  wrap(async (req, res) => {
    const user = await User.findById(req.user._id).select('+currentChallenge');
    if (!user?.currentChallenge) throw badRequest('Start the passkey setup again');

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      requireUserVerification: true
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw badRequest('That passkey could not be verified');
    }

    const { credential, credentialDeviceType } = verification.registrationInfo;
    user.passkeys.push({
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter ?? 0,
      deviceType: credentialDeviceType ?? '',
      label: 'This device'
    });
    user.currentChallenge = null;
    await user.save();

    res.json({ user: user.toPublic() });
  })
);

router.post(
  '/passkey/login/options',
  verifyLimiter,
  validate(emailSchema),
  wrap(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !user.passkeys.length) throw notFound('No passkey is set up for that email');

    const options = await generateAuthenticationOptions({
      rpID: rp().rpID,
      allowCredentials: storedCredentials(user).map((key) => ({ id: key.id })),
      userVerification: 'required'
    });

    await User.updateOne({ _id: user._id }, { $set: { currentChallenge: options.challenge } });
    res.json(options);
  })
);

router.post(
  '/passkey/login/verify',
  verifyLimiter,
  wrap(async (req, res) => {
    const credentialId = req.body?.id;
    if (typeof credentialId !== 'string') throw badRequest('Malformed passkey response');

    const user = await User.findOne({ 'passkeys.credentialId': credentialId }).select(
      '+currentChallenge'
    );
    if (!user?.currentChallenge) throw unauthorized('Start signing in again');

    const stored = user.passkeys.find((key) => key.credentialId === credentialId);
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, 'base64url'),
        counter: stored.counter
      },
      requireUserVerification: true
    });

    if (!verification.verified) throw unauthorized('That passkey did not verify');

    // A counter that fails to advance can mean a cloned authenticator.
    stored.counter = verification.authenticationInfo.newCounter;
    user.currentChallenge = null;
    user.lastLoginAt = new Date();
    await user.save();

    issueSession(res, user);
    res.json({ user: user.toPublic() });
  })
);

router.delete(
  '/passkey',
  requireAuth,
  wrap(async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $set: { passkeys: [], currentChallenge: null } });
    res.json({ ok: true });
  })
);

export default router;

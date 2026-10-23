import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, issueSession, clearSession } from '../middleware/auth.js';
import { wrap, conflict, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createLimiter } from '../lib/rateLimit.js';
import { env } from '../config/env.js';

const router = express.Router();

const authLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many attempts. Try again shortly.'
});

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190),
  password: z.string().min(8, 'Use at least 8 characters').max(200)
});

const registerSchema = credentials.extend({
  name: z.string().trim().min(2, 'Tell us your name').max(120)
});

// Self-service signup creates an organizer that can only manage the events it
// creates. Operator accounts are issued by an organizer (see routes/operators).
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  wrap(async (req, res) => {
    const { name, email, password } = req.body;
    if (await User.exists({ email })) throw conflict('That email already has an account');

    // Picking a role at signup has never granted anything here, and now the
    // account cannot reach the public until a human approves it — unless the
    // email is on a domain the institution has already vouched for.
    const domain = email.split('@')[1] ?? '';
    const institutional = env.institutionDomains.includes(domain);

    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'organizer',
      status: institutional ? 'approved' : 'pending',
      approvedAt: institutional ? new Date() : null
    });

    issueSession(res, user);
    audit({
      actor: user,
      action: 'auth.register',
      summary: `${email} created an organizer account (${user.status})`
    });
    res.status(201).json({ user: user.toPublic() });
  })
);

router.post(
  '/login',
  authLimiter,
  validate(credentials),
  wrap(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    // Same message either way: do not reveal which emails exist.
    const invalid = unauthorized('Email or password is incorrect');
    if (!user) throw invalid;
    if (!(await bcrypt.compare(password, user.passwordHash))) throw invalid;

    user.lastLoginAt = new Date();
    await user.save();
    issueSession(res, user);
    res.json({ user: user.toPublic() });
  })
);

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

export default router;

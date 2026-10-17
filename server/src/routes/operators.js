import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const router = express.Router();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Enter the operator name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  eventIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).default([])
});

const assignSchema = z.object({
  eventIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100)
});

// Only an organizer can mint gate-operator accounts, and only for its own
// events. There is no public path to a privileged account.
router.use(requireAuth, requireRole('organizer'));

async function ownedEventIds(organizerId, requested) {
  if (!requested.length) return [];
  const events = await Event.find({ _id: { $in: requested }, organizer: organizerId }).select('_id');
  return events.map((event) => event._id);
}

router.get(
  '/',
  wrap(async (req, res) => {
    const operators = await User.find({ organizer: req.user._id, role: 'operator' }).sort({
      createdAt: -1
    });
    res.json({ operators: operators.map((operator) => operator.toPublic()) });
  })
);

router.post(
  '/',
  validate(createSchema),
  wrap(async (req, res) => {
    const { name, email, password, eventIds } = req.body;
    if (await User.exists({ email })) throw conflict('That email already has an account');

    const operator = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'operator',
      organizer: req.user._id,
      assignedEvents: await ownedEventIds(req.user._id, eventIds)
    });

    audit({
      actor: req.user,
      action: 'operator.create',
      targetType: 'user',
      targetId: operator._id,
      summary: `Created gate operator ${email}`
    });
    res.status(201).json({ operator: operator.toPublic() });
  })
);

router.patch(
  '/:operatorId/events',
  validate(assignSchema),
  wrap(async (req, res) => {
    const operator = await User.findOne({
      _id: req.params.operatorId,
      organizer: req.user._id,
      role: 'operator'
    });
    if (!operator) throw notFound('Operator not found');

    operator.assignedEvents = await ownedEventIds(req.user._id, req.body.eventIds);
    await operator.save();

    audit({
      actor: req.user,
      action: 'operator.assign',
      targetType: 'user',
      targetId: operator._id,
      summary: `${operator.email} now works ${operator.assignedEvents.length} event(s)`
    });
    res.json({ operator: operator.toPublic() });
  })
);

router.delete(
  '/:operatorId',
  wrap(async (req, res) => {
    const operator = await User.findOneAndDelete({
      _id: req.params.operatorId,
      organizer: req.user._id,
      role: 'operator'
    });
    if (!operator) throw notFound('Operator not found');

    audit({
      actor: req.user,
      action: 'operator.delete',
      targetType: 'user',
      targetId: operator._id,
      summary: `Removed gate operator ${operator.email}`
    });
    res.json({ ok: true });
  })
);

export default router;

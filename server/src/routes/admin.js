import express from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap, notFound, badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const router = express.Router();

// Administrators are created by `npm run make-admin`, never by signing up.
router.use(requireAuth, requireRole('admin'));

const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Say why, for the record').max(300)
});

/** Organisers waiting to be vouched for, newest first. */
router.get(
  '/users',
  wrap(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.role) filter.role = String(req.query.role);

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
    const counts = await User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);

    res.json({
      users: users.map((user) => user.toPublic()),
      counts: Object.fromEntries(counts.map((row) => [row._id ?? 'approved', row.count]))
    });
  })
);

router.post(
  '/users/:userId/approve',
  wrap(async (req, res) => {
    const user = await User.findById(req.params.userId);
    if (!user) throw notFound('Account not found');

    user.status = 'approved';
    user.approvedBy = req.user._id;
    user.approvedAt = new Date();
    user.suspendedReason = '';
    await user.save();

    await audit({
      actor: req.user,
      action: 'admin.approve',
      targetType: 'user',
      targetId: user._id,
      summary: `Approved ${user.email} as an organiser`
    });
    res.json({ user: user.toPublic() });
  })
);

router.post(
  '/users/:userId/suspend',
  validate(reasonSchema),
  wrap(async (req, res) => {
    if (String(req.params.userId) === String(req.user._id)) {
      throw badRequest('You cannot suspend your own account');
    }
    const user = await User.findById(req.params.userId);
    if (!user) throw notFound('Account not found');

    user.status = 'suspended';
    user.suspendedReason = req.body.reason;
    await user.save();

    // Their public pages go dark immediately; loadOpenEvent checks the owner.
    const hidden = await Event.updateMany(
      { organizer: user._id, status: { $ne: 'draft' } },
      { $set: { status: 'draft' } }
    );

    await audit({
      actor: req.user,
      action: 'admin.suspend',
      targetType: 'user',
      targetId: user._id,
      summary: `Suspended ${user.email}: ${req.body.reason}`,
      meta: { eventsUnpublished: hidden.modifiedCount }
    });
    res.json({ user: user.toPublic(), eventsUnpublished: hidden.modifiedCount });
  })
);

router.post(
  '/users/:userId/reinstate',
  wrap(async (req, res) => {
    const user = await User.findById(req.params.userId);
    if (!user) throw notFound('Account not found');

    user.status = 'approved';
    user.suspendedReason = '';
    await user.save();

    await audit({
      actor: req.user,
      action: 'admin.reinstate',
      targetType: 'user',
      targetId: user._id,
      // Their events stay unpublished; reinstating is not republishing.
      summary: `Reinstated ${user.email}. Their events remain drafts`
    });
    res.json({ user: user.toPublic() });
  })
);

/** Everything the public can currently see, for moderation. */
router.get(
  '/events',
  wrap(async (req, res) => {
    const filter = req.query.all === 'true' ? {} : { status: { $ne: 'draft' } };
    const events = await Event.find(filter)
      .populate('organizer', 'name email status')
      .sort({ createdAt: -1 })
      .limit(200);

    const counts = await Promise.all(
      events.map((event) => Ticket.countDocuments({ event: event._id, status: 'valid' }))
    );

    res.json({
      events: events.map((event, index) => ({
        ...event.toPublic(),
        registered: counts[index],
        organizer: event.organizer
          ? {
              id: event.organizer._id.toString(),
              name: event.organizer.name,
              email: event.organizer.email,
              status: event.organizer.status || 'approved'
            }
          : null
      }))
    });
  })
);

router.post(
  '/events/:eventId/unpublish',
  validate(reasonSchema),
  wrap(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw notFound('Event not found');

    event.status = 'draft';
    await event.save();

    await audit({
      actor: req.user,
      action: 'admin.unpublish',
      event,
      targetType: 'event',
      targetId: event._id,
      summary: `Unpublished "${event.name}": ${req.body.reason}`
    });
    res.json({ event: event.toPublic() });
  })
);

export default router;

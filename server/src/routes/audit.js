import express from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { Event } from '../models/Event.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../lib/errors.js';

const router = express.Router();

router.use(requireAuth, requireRole('organizer', 'admin'));

router.get(
  '/',
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);

    // An administrator investigating abuse needs the whole trail, not a slice
    // of it scoped to events they happen to own.
    if (req.user.role === 'admin') {
      const entries = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit);
      return res.json({ entries: entries.map((entry) => entry.toPublic()) });
    }

    const ownEvents = await Event.find({ organizer: req.user._id }).select('_id');
    const eventIds = ownEvents.map((event) => event._id);

    const filter = {
      $or: [{ actor: req.user._id }, { event: { $in: eventIds } }]
    };
    if (req.query.eventId && /^[a-f0-9]{24}$/i.test(req.query.eventId)) {
      filter.$or = [{ event: req.query.eventId }];
    }

    const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ entries: entries.map((entry) => entry.toPublic()) });
  })
);

export default router;

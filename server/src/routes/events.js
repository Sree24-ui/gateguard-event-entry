import express from 'express';
import { z } from 'zod';
import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { ScanLog } from '../models/ScanLog.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, loadEvent, requireEventOwner } from '../middleware/auth.js';
import { wrap, badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { getEventStats, getEventAnalytics } from '../services/stats.js';
import { offlineHash } from '../lib/tickets.js';
import { toCsv, sendCsv } from '../lib/csv.js';

const router = express.Router();

const eventShape = z.object({
  name: z.string().trim().min(3, 'Give the event a name').max(140),
  description: z.string().trim().max(2000).default(''),
  venue: z.string().trim().max(200).default(''),
  startsAt: z.coerce.date({ message: 'Pick a start date and time' }),
  endsAt: z.coerce.date({ message: 'Pick an end date and time' }),
  capacity: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['draft', 'published', 'live', 'closed']).default('draft'),
  gates: z.array(z.string().trim().min(1).max(60)).min(1).max(20).default(['Main Gate']),
  publicRegistration: z.boolean().default(true),
  faceCheck: z.boolean().default(false)
});

const endsAfterStart = (data) =>
  !data.startsAt || !data.endsAt || data.endsAt > data.startsAt;
const dateOrder = { message: 'The event must end after it starts', path: ['endsAt'] };

const createEventBody = eventShape.refine(endsAfterStart, dateOrder);
const updateEventBody = eventShape.partial().refine(endsAfterStart, dateOrder);

router.use(requireAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const filter =
      req.user.role === 'operator'
        ? { _id: { $in: req.user.assignedEvents || [] } }
        : { organizer: req.user._id };

    const events = await Event.find(filter).sort({ startsAt: -1 }).limit(200);
    const stats = await Promise.all(events.map((event) => getEventStats(event._id)));

    res.json({
      events: events.map((event, i) => ({ ...event.toPublic(), stats: stats[i] }))
    });
  })
);

router.post(
  '/',
  requireRole('organizer'),
  validate(createEventBody),
  wrap(async (req, res) => {
    const event = await Event.create({ ...req.body, organizer: req.user._id });
    audit({
      actor: req.user,
      action: 'event.create',
      event,
      targetType: 'event',
      targetId: event._id,
      summary: `Created event "${event.name}"`
    });
    res.status(201).json({ event: { ...event.toPublic(), stats: await getEventStats(event._id) } });
  })
);

router.get(
  '/:eventId',
  loadEvent,
  wrap(async (req, res) => {
    res.json({
      event: { ...req.event.toPublic(), stats: await getEventStats(req.event._id) },
      role: req.isEventOwner ? 'organizer' : 'operator'
    });
  })
);

router.patch(
  '/:eventId',
  loadEvent,
  requireEventOwner,
  validate(updateEventBody),
  wrap(async (req, res) => {
    Object.assign(req.event, req.body);
    if (req.event.endsAt <= req.event.startsAt) {
      throw badRequest('Some fields need attention', [
        { field: 'endsAt', message: 'The event must end after it starts' }
      ]);
    }
    await req.event.save();
    audit({
      actor: req.user,
      action: 'event.update',
      event: req.event,
      targetType: 'event',
      targetId: req.event._id,
      summary: `Updated event "${req.event.name}"`
    });
    res.json({ event: { ...req.event.toPublic(), stats: await getEventStats(req.event._id) } });
  })
);

router.delete(
  '/:eventId',
  loadEvent,
  requireEventOwner,
  wrap(async (req, res) => {
    const checkedIn = await Ticket.countDocuments({
      event: req.event._id,
      checkedInAt: { $ne: null }
    });
    if (checkedIn > 0 && req.query.force !== 'true') {
      throw badRequest(
        `${checkedIn} attendee${checkedIn === 1 ? '' : 's'} already checked in. ` +
          'Close the event instead, or confirm the permanent delete.'
      );
    }

    const name = req.event.name;
    await Promise.all([
      Ticket.deleteMany({ event: req.event._id }),
      ScanLog.deleteMany({ event: req.event._id })
    ]);
    await req.event.deleteOne();
    audit({
      actor: req.user,
      action: 'event.delete',
      targetType: 'event',
      targetId: req.event._id,
      summary: `Deleted event "${name}" and its tickets`
    });
    res.json({ ok: true });
  })
);

router.get(
  '/:eventId/stats',
  loadEvent,
  wrap(async (req, res) => {
    res.json({ stats: await getEventStats(req.event._id) });
  })
);

router.get(
  '/:eventId/analytics',
  loadEvent,
  wrap(async (req, res) => {
    const bucketMinutes = Math.min(Math.max(Number(req.query.bucket) || 15, 5), 120);
    res.json({
      stats: await getEventStats(req.event._id),
      analytics: await getEventAnalytics(req.event._id, { bucketMinutes })
    });
  })
);

router.get(
  '/:eventId/scans',
  loadEvent,
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const filter = { event: req.event._id };
    if (req.query.outcome) filter.outcome = String(req.query.outcome);

    const scans = await ScanLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ scans: scans.map((scan) => scan.toPublic()) });
  })
);

/**
 * Scoped data an operator's device caches so it can judge a ticket while
 * offline: hashes of the valid codes for this event only. No attendee data,
 * and no signing key — the server keeps that.
 */
router.get(
  '/:eventId/offline-manifest',
  loadEvent,
  wrap(async (req, res) => {
    const tickets = await Ticket.find({ event: req.event._id, status: 'valid' })
      .select('code checkedInAt')
      .lean();

    res.set('Cache-Control', 'no-store');
    res.json({
      manifest: {
        eventId: req.event._id.toString(),
        eventName: req.event.name,
        gates: req.event.gates,
        issuedAt: new Date(),
        count: tickets.length,
        validHashes: tickets.map((t) => offlineHash(t.code)),
        // Lets the device warn "already checked in" before syncing. Advisory
        // only: the server decides the official outcome.
        checkedInHashes: tickets.filter((t) => t.checkedInAt).map((t) => offlineHash(t.code))
      }
    });
  })
);

router.get(
  '/:eventId/export/tickets.csv',
  loadEvent,
  requireEventOwner,
  wrap(async (req, res) => {
    const tickets = await Ticket.find({ event: req.event._id }).sort({ createdAt: 1 }).lean();
    const csv = toCsv(
      [
        { label: 'Name', value: (t) => t.attendee.name },
        { label: 'Email', value: (t) => t.attendee.email },
        { label: 'Phone', value: (t) => t.attendee.phone },
        { label: 'College ID', value: (t) => t.attendee.collegeId },
        { label: 'Ticket code', value: (t) => t.code },
        { label: 'Status', value: (t) => t.status },
        { label: 'Source', value: (t) => t.source },
        { label: 'Checked in at', value: (t) => t.checkedInAt },
        { label: 'Gate', value: (t) => t.checkedInGate },
        { label: 'Offline conflicts', value: (t) => t.conflictCount },
        { label: 'Registered at', value: (t) => t.createdAt }
      ],
      tickets
    );
    audit({
      actor: req.user,
      action: 'export.tickets',
      event: req.event,
      summary: `Exported ${tickets.length} attendee rows`
    });
    sendCsv(res, `gateguard-attendees-${req.event._id}.csv`, csv);
  })
);

router.get(
  '/:eventId/export/scans.csv',
  loadEvent,
  requireEventOwner,
  wrap(async (req, res) => {
    const scans = await ScanLog.find({ event: req.event._id }).sort({ createdAt: 1 }).lean();
    const csv = toCsv(
      [
        { label: 'Scanned at', value: (s) => s.scannedAt },
        { label: 'Recorded at', value: (s) => s.createdAt },
        { label: 'Outcome', value: (s) => s.outcome },
        { label: 'Attendee', value: (s) => s.attendeeName },
        { label: 'Gate', value: (s) => s.gate },
        { label: 'Operator', value: (s) => s.operatorName },
        { label: 'Mode', value: (s) => s.mode },
        { label: 'Entry', value: (s) => s.entry },
        { label: 'Code fingerprint', value: (s) => s.codeFingerprint },
        { label: 'Scan id', value: (s) => s.scanId }
      ],
      scans
    );
    sendCsv(res, `gateguard-scans-${req.event._id}.csv`, csv);
  })
);

export default router;

import express from 'express';
import { z } from 'zod';
import { Ticket } from '../models/Ticket.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, loadEvent, requireEventOwner } from '../middleware/auth.js';
import { wrap, conflict, notFound, badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { generateTicketCode, buildQrPayload } from '../lib/tickets.js';
import { getEventStats } from '../services/stats.js';

const router = express.Router({ mergeParams: true });

// A downscaled JPEG from the registration form. Capped well under the 1mb
// body limit; the client resizes to 320px before sending.
export const photoSchema = z
  .string()
  .regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'That is not a usable photo')
  .max(400_000, 'Photo is too large — retake it');

export const attendeeSchema = z.object({
  name: z.string().trim().min(2, 'Enter the attendee name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190),
  phone: z.string().trim().max(32).default(''),
  collegeId: z.string().trim().max(64).default(''),
  photo: photoSchema.optional()
});

const importSchema = z.object({
  attendees: z.array(attendeeSchema).min(1, 'Add at least one attendee').max(2000)
});

/**
 * Creates a ticket for an attendee. Rejects a second registration for the
 * same email on the same event, and enforces capacity server-side.
 */
export async function issueTicket(event, attendeeInput, source = 'organizer') {
  const { photo, ...attendee } = attendeeInput;
  if (event.capacity > 0) {
    const issued = await Ticket.countDocuments({ event: event._id, status: 'valid' });
    if (issued >= event.capacity) {
      throw conflict(`${event.name} is at capacity (${event.capacity} tickets)`);
    }
  }

  try {
    const ticket = await Ticket.create({
      event: event._id,
      code: generateTicketCode(),
      attendee,
      source,
      photo: photo ? { data: photo, capturedAt: new Date() } : undefined
    });
    return ticket;
  } catch (err) {
    if (err?.code === 11000) {
      throw conflict(`${attendee.email} is already registered for this event`);
    }
    throw err;
  }
}

export function ticketWithQr(ticket) {
  return {
    ...ticket.toPublic(),
    qrPayload: buildQrPayload(ticket.event, ticket.code)
  };
}

router.use(requireAuth, loadEvent);

router.get(
  '/',
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { event: req.event._id };

    if (req.query.status === 'checked_in') filter.checkedInAt = { $ne: null };
    if (req.query.status === 'pending') filter.checkedInAt = null;
    if (req.query.status === 'cancelled') filter.status = 'cancelled';

    const search = String(req.query.q || '').trim();
    if (search) {
      // Escape the input before it reaches a regular expression.
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { 'attendee.name': new RegExp(safe, 'i') },
        { 'attendee.email': new RegExp(safe, 'i') },
        { 'attendee.collegeId': new RegExp(safe, 'i') }
      ];
    }

    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Ticket.countDocuments(filter)
    ]);

    res.json({
      tickets: tickets.map((ticket) => ticket.toPublic()),
      page,
      limit,
      total
    });
  })
);

router.post(
  '/',
  requireEventOwner,
  validate(attendeeSchema),
  wrap(async (req, res) => {
    const ticket = await issueTicket(req.event, req.body, 'organizer');
    audit({
      actor: req.user,
      action: 'ticket.issue',
      event: req.event,
      targetType: 'ticket',
      targetId: ticket._id,
      summary: `Issued a ticket to ${ticket.attendee.email}`
    });
    res.status(201).json({
      ticket: ticketWithQr(ticket),
      stats: await getEventStats(req.event._id)
    });
  })
);

router.post(
  '/import',
  requireEventOwner,
  validate(importSchema),
  wrap(async (req, res) => {
    const created = [];
    const skipped = [];

    for (const attendee of req.body.attendees) {
      try {
        created.push(ticketWithQr(await issueTicket(req.event, attendee, 'import')));
      } catch (err) {
        skipped.push({ email: attendee.email, reason: err.message });
      }
    }

    audit({
      actor: req.user,
      action: 'ticket.import',
      event: req.event,
      targetType: 'event',
      targetId: req.event._id,
      summary: `Imported ${created.length} attendees (${skipped.length} skipped)`
    });

    res.status(created.length ? 201 : 409).json({
      created: created.length,
      skipped,
      tickets: created,
      stats: await getEventStats(req.event._id)
    });
  })
);

router.get(
  '/:ticketId',
  wrap(async (req, res) => {
    const ticket = await Ticket.findOne({ _id: req.params.ticketId, event: req.event._id });
    if (!ticket) throw notFound('Ticket not found');
    res.json({ ticket: ticketWithQr(ticket) });
  })
);

/** Issues a fresh code, which immediately invalidates the previous QR. */
router.post(
  '/:ticketId/reissue',
  requireEventOwner,
  wrap(async (req, res) => {
    const ticket = await Ticket.findOne({ _id: req.params.ticketId, event: req.event._id });
    if (!ticket) throw notFound('Ticket not found');
    // Reissuing cleared checkedInAt, which rewound the headcount for someone
    // already inside and left the scan log contradicting the stats.
    if (ticket.checkedInAt) {
      throw badRequest(
        'That attendee is already checked in, so reissuing would undo their entry. ' +
          'Cancel the ticket instead if you need to revoke it.'
      );
    }

    ticket.code = generateTicketCode();
    ticket.status = 'valid';
    ticket.reissuedAt = new Date();
    ticket.checkedInAt = null;
    ticket.checkedInBy = null;
    ticket.checkedInGate = null;
    ticket.checkInScanId = null;
    await ticket.save();

    audit({
      actor: req.user,
      action: 'ticket.reissue',
      event: req.event,
      targetType: 'ticket',
      targetId: ticket._id,
      summary: `Reissued the ticket for ${ticket.attendee.email}; the old QR no longer works`
    });
    res.json({ ticket: ticketWithQr(ticket), stats: await getEventStats(req.event._id) });
  })
);

router.post(
  '/:ticketId/cancel',
  requireEventOwner,
  wrap(async (req, res) => {
    const ticket = await Ticket.findOne({ _id: req.params.ticketId, event: req.event._id });
    if (!ticket) throw notFound('Ticket not found');
    if (ticket.checkedInAt) throw badRequest('That attendee has already been checked in');

    ticket.status = 'cancelled';
    await ticket.save();
    audit({
      actor: req.user,
      action: 'ticket.cancel',
      event: req.event,
      targetType: 'ticket',
      targetId: ticket._id,
      summary: `Cancelled the ticket for ${ticket.attendee.email}`
    });
    res.json({ ticket: ticket.toPublic(), stats: await getEventStats(req.event._id) });
  })
);

export default router;

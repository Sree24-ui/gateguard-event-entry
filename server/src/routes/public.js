import express from 'express';
import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { validate } from '../middleware/validate.js';
import { wrap, notFound, badRequest } from '../lib/errors.js';
import { issueTicket, ticketWithQr, attendeeSchema } from './tickets.js';
import { buildQrPayload } from '../lib/tickets.js';
import { audit } from '../lib/audit.js';
import { createLimiter } from '../lib/rateLimit.js';

const router = express.Router();

const registerLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  message: 'Too many registrations from here. Try again later.'
});

// Looking up a ticket means guessing a 128-bit code, but keep it bounded.
const ticketLookupLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  message: 'Too many lookups. Try again later.'
});

async function loadOpenEvent(eventId) {
  if (!/^[a-f0-9]{24}$/i.test(eventId || '')) throw notFound('Event not found');
  const event = await Event.findById(eventId);
  if (!event || event.status === 'draft') throw notFound('Event not found');
  return event;
}

/** Public event summary for the registration page. No attendee data. */
router.get(
  '/events/:eventId',
  wrap(async (req, res) => {
    const event = await loadOpenEvent(req.params.eventId);
    const issued = await Ticket.countDocuments({ event: event._id, status: 'valid' });

    res.json({
      event: {
        id: event._id.toString(),
        name: event.name,
        description: event.description,
        venue: event.venue,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        status: event.status,
        publicRegistration: event.publicRegistration,
        capacity: event.capacity,
        issued,
        spotsLeft: event.capacity > 0 ? Math.max(event.capacity - issued, 0) : null
      }
    });
  })
);

router.post(
  '/events/:eventId/register',
  registerLimiter,
  validate(attendeeSchema),
  wrap(async (req, res) => {
    const event = await loadOpenEvent(req.params.eventId);
    if (!event.publicRegistration) throw badRequest('This event is invite only');
    if (event.status === 'closed') throw badRequest('Registration for this event has closed');

    const ticket = await issueTicket(event, req.body, 'public');
    audit({
      action: 'ticket.public_register',
      event,
      targetType: 'ticket',
      targetId: ticket._id,
      summary: `${ticket.attendee.email} registered from the public page`
    });

    res.status(201).json({ ticket: ticketWithQr(ticket) });
  })
);

/**
 * An attendee opens their ticket with the code itself, which acts as the
 * capability. Only the data printed on the pass is returned.
 */
router.get(
  '/tickets/:code',
  ticketLookupLimiter,
  wrap(async (req, res) => {
    const code = String(req.params.code || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) throw notFound('Ticket not found');

    const ticket = await Ticket.findOne({ code }).populate('event', 'name venue startsAt endsAt status');
    if (!ticket || !ticket.event) throw notFound('Ticket not found');

    res.set('Cache-Control', 'no-store');
    res.json({
      ticket: {
        code: ticket.code,
        qrPayload: buildQrPayload(ticket.event._id, ticket.code),
        attendeeName: ticket.attendee.name,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt,
        checkedInGate: ticket.checkedInGate,
        event: {
          id: ticket.event._id.toString(),
          name: ticket.event.name,
          venue: ticket.event.venue,
          startsAt: ticket.event.startsAt,
          endsAt: ticket.event.endsAt,
          status: ticket.event.status
        }
      }
    });
  })
);

export default router;

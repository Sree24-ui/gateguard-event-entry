import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { unauthorized, forbidden, notFound } from '../lib/errors.js';

export const SESSION_COOKIE = 'gg_session';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: `${env.sessionDays}d`
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: env.sessionDays * 24 * 60 * 60 * 1000,
    path: '/'
  });
  return token;
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readToken(req) {
  if (req.cookies?.[SESSION_COOKIE]) return req.cookies[SESSION_COOKIE];
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return null;
}

/** Populates req.user, or throws 401. */
export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw unauthorized('Your session has expired. Sign in again.');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized('Account no longer exists');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This action requires the ${roles.join(' or ')} role`));
    }
    next();
  };
}

/**
 * Loads req.event and checks the caller may act on it. Organizers reach their
 * own events; operators reach only the events assigned to them.
 */
export async function loadEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(eventId || '')) throw notFound('Event not found');
    const event = await Event.findById(eventId);
    if (!event) throw notFound('Event not found');

    const user = req.user;
    const isOwner = String(event.organizer) === String(user._id);
    const isAssignedOperator =
      user.role === 'operator' &&
      (user.assignedEvents || []).some((id) => String(id) === String(event._id));

    if (!isOwner && !isAssignedOperator) throw forbidden('You do not have access to this event');

    req.event = event;
    req.isEventOwner = isOwner;
    next();
  } catch (err) {
    next(err);
  }
}

/** Organizer-only operations on an already loaded event. */
export function requireEventOwner(req, res, next) {
  if (!req.isEventOwner) return next(forbidden('Only the event organizer can do this'));
  next();
}

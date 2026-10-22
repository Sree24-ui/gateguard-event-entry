import rateLimit from 'express-rate-limit';

// Automated tests drive hundreds of requests through one process. This is an
// explicit, single-purpose flag rather than a NODE_ENV check, so no ordinary
// environment name can turn rate limiting off by accident.
const DISABLED = process.env.RATE_LIMIT_DISABLED === '1';

/** Shared limiter factory. */
export function createLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => DISABLED,
    message: { error: { code: 'rate_limited', message } }
  });
}

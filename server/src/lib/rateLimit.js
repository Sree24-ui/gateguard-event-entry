import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Shared limiter factory. Automated tests drive hundreds of requests through
 * one process, so limiting is skipped there; the production configuration is
 * exercised by hand (see README, "Rate limiting").
 */
export function createLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.nodeEnv === 'test',
    message: { error: { code: 'rate_limited', message } }
  });
}

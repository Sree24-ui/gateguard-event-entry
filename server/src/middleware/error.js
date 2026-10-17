import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

/** Single place that shapes error responses. Never leaks internals. */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details }
    });
  }

  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: 'bad_request',
        message: 'Some fields need attention',
        details: Object.entries(err.errors || {}).map(([field, e]) => ({
          field,
          message: e.message
        }))
      }
    });
  }

  if (err?.code === 11000) {
    return res.status(409).json({
      error: { code: 'conflict', message: 'That record already exists' }
    });
  }

  if (!env.isProduction) console.error(err);
  else console.error({ msg: 'unhandled_error', name: err?.name, message: err?.message });

  res.status(500).json({
    error: { code: 'server_error', message: 'Something went wrong on our side' }
  });
}

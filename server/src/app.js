import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { dbState } from './db/connect.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import ticketRoutes from './routes/tickets.js';
import checkinRoutes from './routes/checkin.js';
import publicRoutes from './routes/public.js';
import operatorRoutes from './routes/operators.js';
import auditRoutes from './routes/audit.js';
import attendeeRoutes from './routes/attendee.js';

export function createApp() {
  const app = express();

  // Vercel and most PaaS hosts sit behind one proxy; rate limiting and
  // `secure` cookies need the real client protocol and IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA is served by the static host, not Express, so a CSP here
      // would only apply to JSON responses.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' }
    })
  );

  // Browsers send an Origin header on every POST, including same-origin ones,
  // so this has to recognise its own host or it rejects the app's own writes.
  // A disallowed origin gets a response without CORS headers — the browser
  // blocks it — rather than an error, which would surface as a 500.
  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, { origin: true, credentials: true });

      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }

      if (sameOrigin || env.corsOrigins.includes(origin)) {
        return callback(null, { origin: true, credentials: true });
      }
      return callback(null, { origin: false });
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'gateguard-api',
      version: process.env.npm_package_version || '1.0.0',
      database: dbState(),
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString()
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/attendee', attendeeRoutes);
  app.use('/api/operators', operatorRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/events/:eventId/tickets', ticketRoutes);
  app.use('/api/events/:eventId/checkin', checkinRoutes);
  app.use('/api/events', eventRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

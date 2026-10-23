import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve .env from the repository root, not the working directory, so a
// script run from server/ finds the same file the server does.
dotenv.config({
  path: [fileURLToPath(new URL('../../../.env', import.meta.url)), '.env']
});

const required = ['MONGODB_URI', 'JWT_SECRET', 'TICKET_SECRET'];

function readEnv() {
  // No environment is exempt. A bypass here meant NODE_ENV=test silently
  // swapped in a published fallback secret, which forges any session.
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill it in.'
    );
  }

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    port: Number(process.env.PORT || 4000),
    mongoUri: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    ticketSecret: process.env.TICKET_SECRET,
    sessionDays: Number(process.env.SESSION_DAYS || 7),
    // Comma separated list. Empty means same-origin only, which is how the
    // production deployment runs (frontend and API share one origin).
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

export const env = readEnv();

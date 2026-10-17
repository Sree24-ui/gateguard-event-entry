import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGODB_URI', 'JWT_SECRET', 'TICKET_SECRET'];

function readEnv() {
  const isTest = process.env.NODE_ENV === 'test';
  const missing = isTest ? [] : required.filter((key) => !process.env[key]);
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
    mongoUri: process.env.MONGODB_URI || '',
    jwtSecret: process.env.JWT_SECRET || 'test-jwt-secret',
    ticketSecret: process.env.TICKET_SECRET || 'test-ticket-secret',
    sessionDays: Number(process.env.SESSION_DAYS || 7),
    // Comma separated list. Empty means same-origin only, which is how the
    // production deployment runs (frontend and API share one origin).
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    publicAppUrl: process.env.PUBLIC_APP_URL || '',
    operatorSignupEnabled: false
  };
}

export const env = readEnv();

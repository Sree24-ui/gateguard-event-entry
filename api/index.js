// Vercel Function entrypoint. vercel.json rewrites every /api/* request here
// and it is handled by the same Express app that runs locally.
import { createApp } from '../server/src/app.js';
import { connectDb } from '../server/src/db/connect.js';

const app = createApp();
let ready = null;

export default async function handler(req, res) {
  // A rewrite can hand the function its own route instead of the caller's
  // path. Express matches on req.url, so restore the original when that
  // happens; the header is set by the platform, never by the client.
  const original = req.headers['x-vercel-original-path'];
  if (original && !req.url.startsWith('/api/')) req.url = original;

  if (!ready) ready = connectDb();
  try {
    await ready;
  } catch (err) {
    ready = null;
    // The client gets a generic message; the cause belongs in the logs, or a
    // failing deployment is undiagnosable.
    console.error('[gateguard] database connection failed:', err?.message);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ error: { code: 'database_unavailable', message: 'Database is unreachable' } })
    );
    return;
  }
  return app(req, res);
}

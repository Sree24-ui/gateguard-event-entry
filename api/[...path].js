// Vercel Function entrypoint. The catch-all filename means every /api/*
// request lands here with its original path intact, and is handled by the
// same Express app that runs in local development.
import { createApp } from '../server/src/app.js';
import { connectDb } from '../server/src/db/connect.js';

const app = createApp();
let ready = null;

export default async function handler(req, res) {
  if (!ready) ready = connectDb();
  try {
    await ready;
  } catch (err) {
    ready = null;
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ error: { code: 'database_unavailable', message: 'Database is unreachable' } })
    );
    return;
  }
  return app(req, res);
}

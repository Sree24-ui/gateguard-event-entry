/**
 * One-time backfill for tickets issued before entry/exit tracking existed.
 * Anyone with a checkedInAt was, under the old one-way model, inside.
 *
 *   npm run backfill
 *
 * Safe to re-run: it only touches documents that have no `state` yet.
 */
import { connectDb, disconnectDb } from '../db/connect.js';
import { Ticket } from '../models/Ticket.js';

async function main() {
  await connectDb();

  const wasInside = await Ticket.updateMany(
    { state: { $exists: false }, checkedInAt: { $ne: null } },
    { $set: { state: 'inside', entryCount: 1, exitCount: 0, lastTokenCounter: 0 } }
  );
  const neverIn = await Ticket.updateMany(
    { state: { $exists: false } },
    { $set: { state: 'issued', entryCount: 0, exitCount: 0, lastTokenCounter: 0 } }
  );

  console.log(`[backfill] ${wasInside.modifiedCount} marked inside`);
  console.log(`[backfill] ${neverIn.modifiedCount} marked issued`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[backfill] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});

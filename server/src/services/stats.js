import { Ticket } from '../models/Ticket.js';
import { ScanLog } from '../models/ScanLog.js';

/** Authoritative attendance numbers, read straight from the database. */
export async function getEventStats(eventId, event = null) {
  const [registered, checkedIn, cancelled, conflicts, lastCheckIn, inside, exited, everExited] =
    await Promise.all([
    Ticket.countDocuments({ event: eventId, status: 'valid' }),
    Ticket.countDocuments({ event: eventId, status: 'valid', checkedInAt: { $ne: null } }),
    Ticket.countDocuments({ event: eventId, status: 'cancelled' }),
    Ticket.countDocuments({ event: eventId, conflictCount: { $gt: 0 } }),
    Ticket.findOne({ event: eventId, checkedInAt: { $ne: null } })
      .sort({ checkedInAt: -1 })
      .select('checkedInAt checkedInGate attendee.name')
      .lean(),
    Ticket.countDocuments({ event: eventId, status: 'valid', state: 'inside' }),
      Ticket.countDocuments({ event: eventId, status: 'valid', state: 'outside' }),
      // Whether this gate scans exits at all — not who happens to be outside
      // right now, which goes back to zero as soon as everyone re-enters.
      Ticket.countDocuments({ event: eventId, exitCount: { $gt: 0 } })
    ]);

  // Recorded occupancy, not "people inside": it is only as accurate as exit
  // scanning. A gate that admits without scanning exits drifts high.
  const limit = event?.occupancyLimit || event?.capacity || 0;

  return {
    registered,
    checkedIn,
    remaining: Math.max(registered - checkedIn, 0),
    cancelled,
    conflicts,
    attendancePct: registered === 0 ? 0 : Math.round((checkedIn / registered) * 1000) / 10,
    inside,
    exited,
    occupancyLimit: limit,
    occupancyPct: limit === 0 ? 0 : Math.round((inside / limit) * 1000) / 10,
    exitsRecorded: everExited > 0,
    lastCheckInAt: lastCheckIn?.checkedInAt || null,
    lastCheckInName: lastCheckIn?.attendee?.name || null,
    asOf: new Date()
  };
}

/** Per-gate throughput plus rejection counts, for the analytics view. */
export async function getEventAnalytics(eventId, { bucketMinutes = 15 } = {}) {
  const bucketMs = bucketMinutes * 60 * 1000;

  const [byGate, outcomes, timeline] = await Promise.all([
    Ticket.aggregate([
      { $match: { event: eventId, checkedInAt: { $ne: null } } },
      { $group: { _id: { $ifNull: ['$checkedInGate', 'Unknown'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    ScanLog.aggregate([
      { $match: { event: eventId } },
      { $group: { _id: '$outcome', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Ticket.aggregate([
      { $match: { event: eventId, checkedInAt: { $ne: null } } },
      {
        $group: {
          _id: {
            $toDate: {
              $subtract: [
                { $toLong: '$checkedInAt' },
                { $mod: [{ $toLong: '$checkedInAt' }, bucketMs] }
              ]
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  return {
    bucketMinutes,
    byGate: byGate.map((row) => ({ gate: row._id, count: row.count })),
    outcomes: outcomes.map((row) => ({ outcome: row._id, count: row.count })),
    timeline: timeline.map((row) => ({ at: row._id, count: row.count }))
  };
}

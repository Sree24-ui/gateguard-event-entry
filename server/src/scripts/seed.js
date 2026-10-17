/**
 * Seeds a clearly labelled demo organizer, operator and two events so the app
 * can be demonstrated without hand-entering data. Everything it creates is
 * marked `isDemo` / source 'demo' so the UI can label it as sample data.
 *
 *   npm run seed            # add demo data
 *   npm run seed -- --reset # wipe the demo organizer first
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../db/connect.js';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { ScanLog } from '../models/ScanLog.js';
import { AuditLog } from '../models/AuditLog.js';
import { generateTicketCode, fingerprintCode } from '../lib/tickets.js';

const DEMO_ORGANIZER = 'demo@gateguard.app';
const DEMO_OPERATOR = 'gate@gateguard.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'gateguard-demo';

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Kabir', 'Meera', 'Vivaan', 'Isha', 'Arjun',
  'Sara', 'Dhruv', 'Nisha', 'Advait', 'Tara', 'Kiaan', 'Riya', 'Veer', 'Anvi', 'Reyansh', 'Myra',
  'Aditya', 'Pari', 'Ishaan', 'Avni', 'Shaurya', 'Kyra', 'Atharv', 'Zara', 'Neel', 'Aanya'];
const LAST = ['Sharma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Singh', 'Desai', 'Gupta', 'Rao', 'Menon',
  'Kulkarni', 'Joshi', 'Bose', 'Chawla', 'Pillai'];

const pick = (list, i) => list[i % list.length];
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600 * 1000);

function attendee(i) {
  const first = pick(FIRST, i);
  const last = pick(LAST, Math.floor(i / 7) + i);
  return {
    name: `${first} ${last}`,
    email: `${first}.${last}${i}`.toLowerCase() + '@demo.college.edu',
    phone: `98${String(10000000 + i * 137).slice(0, 8)}`,
    collegeId: `CSE${2200 + i}`
  };
}

async function main() {
  const reset = process.argv.includes('--reset');
  await connectDb();

  if (reset) {
    const existing = await User.findOne({ email: DEMO_ORGANIZER });
    if (existing) {
      const events = await Event.find({ organizer: existing._id }).select('_id');
      const ids = events.map((e) => e._id);
      await Promise.all([
        Ticket.deleteMany({ event: { $in: ids } }),
        ScanLog.deleteMany({ event: { $in: ids } }),
        AuditLog.deleteMany({ event: { $in: ids } }),
        Event.deleteMany({ _id: { $in: ids } }),
        User.deleteMany({ $or: [{ _id: existing._id }, { organizer: existing._id }] })
      ]);
      console.log('[seed] removed previous demo data');
    }
  }

  let organizer = await User.findOne({ email: DEMO_ORGANIZER });
  if (!organizer) {
    organizer = await User.create({
      name: 'Demo Organizer',
      email: DEMO_ORGANIZER,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      role: 'organizer'
    });
  }

  const live = await Event.create({
    organizer: organizer._id,
    name: 'TechFest 2026 — Opening Night',
    description:
      'Flagship inter-college tech festival. Opening keynote, robotics showcase and the ' +
      'overnight hackathon kickoff in the main auditorium.',
    venue: 'Main Auditorium, Block C',
    startsAt: hoursFromNow(-1.5),
    endsAt: hoursFromNow(6),
    capacity: 300,
    status: 'live',
    gates: ['Main Gate', 'Side Gate', 'VIP Entry'],
    publicRegistration: true,
    isDemo: true
  });

  const upcoming = await Event.create({
    organizer: organizer._id,
    name: 'Culturals Auditions — Round 2',
    description: 'Dance, music and drama auditions for the annual cultural week.',
    venue: 'Open Air Theatre',
    startsAt: hoursFromNow(72),
    endsAt: hoursFromNow(78),
    capacity: 120,
    status: 'published',
    gates: ['Main Gate'],
    publicRegistration: true,
    isDemo: true
  });

  let operator = await User.findOne({ email: DEMO_OPERATOR });
  if (!operator) {
    operator = await User.create({
      name: 'Gate Operator',
      email: DEMO_OPERATOR,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      role: 'operator',
      organizer: organizer._id,
      assignedEvents: [live._id, upcoming._id]
    });
  } else {
    operator.assignedEvents = [live._id, upcoming._id];
    await operator.save();
  }

  // 84 registrations on the live event, 51 of them already through the gate.
  const liveTickets = [];
  for (let i = 0; i < 84; i += 1) {
    liveTickets.push({
      event: live._id,
      code: generateTicketCode(),
      attendee: attendee(i),
      source: 'demo'
    });
  }
  const created = await Ticket.insertMany(liveTickets);

  const gates = live.gates;
  const scanLogs = [];
  for (let i = 0; i < 51; i += 1) {
    const ticket = created[i];
    const gate = pick(gates, i);
    // Spread arrivals across the 90 minutes since doors opened.
    const at = new Date(live.startsAt.getTime() + Math.round((i / 51) * 85 * 60 * 1000));
    await Ticket.updateOne(
      { _id: ticket._id },
      {
        $set: {
          checkedInAt: at,
          checkedInBy: operator._id,
          checkedInGate: gate,
          checkInScanId: `demo-${ticket._id}`
        }
      }
    );
    scanLogs.push({
      event: live._id,
      ticket: ticket._id,
      scanId: `demo-${ticket._id}`,
      outcome: 'checked_in',
      mode: 'online',
      entry: i % 11 === 0 ? 'manual' : 'camera',
      gate,
      operator: operator._id,
      operatorName: operator.name,
      attendeeName: ticket.attendee.name,
      codeFingerprint: fingerprintCode(ticket.code),
      message: 'Checked in',
      scannedAt: at
    });
  }

  // A few realistic rejections so the analytics and audit views have content.
  const rejections = [
    { outcome: 'duplicate', attendeeName: created[3].attendee.name, ticket: created[3]._id },
    { outcome: 'duplicate', attendeeName: created[12].attendee.name, ticket: created[12]._id },
    { outcome: 'invalid_signature', attendeeName: '' },
    { outcome: 'unknown', attendeeName: '' },
    { outcome: 'wrong_event', attendeeName: '' }
  ];
  rejections.forEach((row, i) => {
    scanLogs.push({
      event: live._id,
      ticket: row.ticket || null,
      scanId: `demo-reject-${i}-${live._id}`,
      outcome: row.outcome,
      mode: 'online',
      entry: 'camera',
      gate: pick(gates, i),
      operator: operator._id,
      operatorName: operator.name,
      attendeeName: row.attendeeName,
      codeFingerprint: fingerprintCode(`demo-forged-${i}`),
      message: row.outcome,
      scannedAt: new Date(live.startsAt.getTime() + (20 + i * 9) * 60 * 1000)
    });
  });
  await ScanLog.insertMany(scanLogs);

  // Upcoming event: registrations only, nobody through the gate yet.
  await Ticket.insertMany(
    Array.from({ length: 37 }, (_, i) => ({
      event: upcoming._id,
      code: generateTicketCode(),
      attendee: attendee(i + 200),
      source: 'demo'
    }))
  );

  await AuditLog.insertMany([
    {
      actor: organizer._id,
      actorName: organizer.name,
      action: 'event.create',
      event: live._id,
      targetType: 'event',
      targetId: live._id.toString(),
      summary: `Created event "${live.name}"`
    },
    {
      actor: organizer._id,
      actorName: organizer.name,
      action: 'operator.create',
      targetType: 'user',
      targetId: operator._id.toString(),
      summary: `Created gate operator ${DEMO_OPERATOR}`
    },
    {
      actor: organizer._id,
      actorName: organizer.name,
      action: 'ticket.import',
      event: live._id,
      targetType: 'event',
      targetId: live._id.toString(),
      summary: 'Imported 84 attendees from the registration sheet'
    }
  ]);

  console.log(`[seed] organizer ${DEMO_ORGANIZER} / ${DEMO_PASSWORD}`);
  console.log(`[seed] operator  ${DEMO_OPERATOR} / ${DEMO_PASSWORD}`);
  console.log(`[seed] live event ${live._id} — 84 registered, 51 checked in`);
  console.log(`[seed] upcoming event ${upcoming._id} — 37 registered`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});

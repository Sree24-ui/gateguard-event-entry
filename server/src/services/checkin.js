import { Ticket } from '../models/Ticket.js';
import { ScanLog } from '../models/ScanLog.js';
import { parseScanInput, fingerprintCode } from '../lib/tickets.js';
import { getEventStats } from './stats.js';

const MESSAGES = {
  checked_in: 'Checked in',
  duplicate: 'Already checked in',
  conflict: 'Conflicting offline scan — already checked in elsewhere',
  invalid_signature: 'Ticket signature does not match — possible forgery',
  malformed: 'Not a GateGuard ticket',
  wrong_event: 'Ticket belongs to a different event',
  unknown: 'Ticket not found',
  cancelled: 'Ticket was cancelled',
  face_review: 'Compare the attendee with their registration photo',
  face_rejected: 'Operator reported the face did not match',
  re_entered: 'Re-entry allowed',
  checked_out: 'Exited',
  invalid_exit: 'Cannot exit — not recorded as inside',
  expired: 'That code has expired — ask for a fresh one',
  replayed: 'That code was already used — ask for a fresh one'
};

const OK_OUTCOMES = new Set(['checked_in', 're_entered', 'checked_out']);

function result(outcome, extra = {}) {
  return {
    ok: OK_OUTCOMES.has(outcome),
    outcome,
    message: MESSAGES[outcome] || outcome,
    ...extra
  };
}

function logToResult(log) {
  return result(log.outcome, {
    attendeeName: log.attendeeName || null,
    gate: log.gate,
    checkedInAt: log.outcome === 'checked_in' ? log.scannedAt : null,
    scanId: log.scanId,
    replayed: true,
    scan: log.toPublic ? log.toPublic() : log
  });
}

/**
 * Resolves one scan against the authoritative database.
 *
 * Guarantees:
 *  - at most one official check-in per ticket, enforced by a conditional
 *    update rather than read-then-write, so concurrent gates cannot both win;
 *  - the same `scanId` can be submitted any number of times and only ever
 *    produces one record, so retries and queue replays are safe.
 */
export async function processScan({
  eventId,
  raw,
  scanId,
  gate = 'Main Gate',
  mode = 'online',
  entry = 'camera',
  operator = null,
  scannedAt = new Date(),
  // Set when the event has face check on. The ticket is then held, not
  // claimed, until the operator confirms the person matches the photo.
  requireFace = false,
  faceConfirmed = false,
  // Which way through the gate. Entry is the default so every existing
  // caller keeps its behaviour.
  direction = 'entry',
  allowReEntry = false
}) {
  const eventKey = String(eventId);

  const existing = await ScanLog.findOne({ scanId });
  if (existing) return logToResult(existing);

  const parsed = parseScanInput(raw);
  const fingerprint = parsed.ok ? fingerprintCode(parsed.code) : fingerprintCode(raw || '');

  const writeLog = async (outcome, { ticket = null, attendeeName = '' } = {}) => {
    const payload = {
      event: eventKey,
      ticket: ticket?._id ?? null,
      scanId,
      outcome,
      mode,
      entry,
      direction,
      gate,
      operator: operator?.id ?? null,
      operatorName: operator?.name ?? '',
      attendeeName,
      codeFingerprint: fingerprint,
      message: MESSAGES[outcome] || outcome,
      scannedAt
    };
    try {
      return { log: await ScanLog.create(payload), created: true };
    } catch (err) {
      if (err?.code === 11000) {
        // Another request already recorded this scanId: replay its outcome.
        return { log: await ScanLog.findOne({ scanId }), created: false };
      }
      throw err;
    }
  };

  const finish = async (outcome, extra = {}, logOpts = {}) => {
    const { log, created } = await writeLog(outcome, logOpts);
    if (!created && log && log.outcome !== outcome) return logToResult(log);
    return result(outcome, { ...extra, scanId, scan: log?.toPublic?.() ?? null, created });
  };

  if (!parsed.ok) return finish(parsed.reason);

  if (parsed.signed && parsed.eventId !== eventKey) {
    return finish('wrong_event');
  }

  const ticket = await Ticket.findOne({ code: parsed.code }).select('+photo.data');
  if (!ticket) return finish('unknown');
  if (String(ticket.event) !== eventKey) {
    return finish('wrong_event', {}, { ticket });
  }
  if (ticket.status === 'cancelled') {
    return finish('cancelled', { attendeeName: ticket.attendee.name }, { ticket, attendeeName: ticket.attendee.name });
  }

  // Face check runs before the claim, so a refused face never consumes the
  // ticket. Both the review and the operator's verdict are logged.
  const state = ticket.state || (ticket.checkedInAt ? 'inside' : 'issued');

  const enforceToken = parsed.rotating && mode !== 'offline_sync';
  if (enforceToken && (ticket.lastTokenCounter || 0) >= parsed.counter) {
    return finish(
      'replayed',
      { attendeeName: ticket.attendee.name },
      { ticket, attendeeName: ticket.attendee.name }
    );
  }
  // $not rather than $lt: a ticket issued before this field existed has no
  // lastTokenCounter at all, and { $lt: n } does not match a missing field —
  // which silently made every older ticket unscannable.
  const tokenGuard = enforceToken
    ? { lastTokenCounter: { $not: { $gte: parsed.counter } } }
    : {};
  const tokenBurn = enforceToken ? { lastTokenCounter: parsed.counter } : {};

  if (direction === 'exit') {
    const exited = await Ticket.findOneAndUpdate(
      { _id: ticket._id, status: 'valid', state: 'inside', ...tokenGuard },
      {
        $set: { state: 'outside', lastExitAt: scannedAt, lastExitGate: gate, ...tokenBurn },
        $inc: { exitCount: 1 }
      },
      { new: true }
    );

    if (!exited) {
      return finish(
        'invalid_exit',
        {
          attendeeName: ticket.attendee.name,
          why: state === 'outside' ? 'Already recorded as outside' : 'Never recorded as inside'
        },
        { ticket, attendeeName: ticket.attendee.name }
      );
    }

    return finish(
      'checked_out',
      { attendeeName: exited.attendee.name, ticketId: exited._id.toString(), gate },
      { ticket: exited, attendeeName: exited.attendee.name }
    );
  }

  // With no photo on file there is nothing to compare, so the scan falls
  // through and is admitted normally; the ticket's own hasPhoto flag is what
  // tells the organizer no reference existed.
  if (requireFace && !faceConfirmed && ticket.photo?.data) {
    return finish(
      'face_review',
      {
        attendeeName: ticket.attendee.name,
        ticketId: ticket._id.toString(),
        photo: ticket.photo.data,
        photoCapturedAt: ticket.photo.capturedAt
      },
      { ticket, attendeeName: ticket.attendee.name }
    );
  }

  // Atomic claim, conditional on the state we expect. Only the request that
  // moves the ticket out of that state wins, so concurrent gates cannot both
  // admit the same person.
  const reEntering = state === 'outside' && allowReEntry;
  const claimed = await Ticket.findOneAndUpdate(
    {
      _id: ticket._id,
      status: 'valid',
      state: reEntering ? 'outside' : 'issued',
      ...tokenGuard
    },
    {
      $set: {
        state: 'inside',
        ...tokenBurn,
        checkedInBy: operator?.id ?? null,
        checkedInGate: gate,
        checkInScanId: scanId,
        // checkedInAt is the FIRST entry and is never overwritten.
        ...(reEntering ? {} : { checkedInAt: scannedAt }),
        ...(faceConfirmed ? { faceCheckedAt: new Date() } : {})
      },
      $inc: { entryCount: 1 }
    },
    { new: true }
  );

  if (claimed) {
    const outcome = reEntering ? 're_entered' : 'checked_in';
    return finish(
      outcome,
      {
        attendeeName: claimed.attendee.name,
        ticketId: claimed._id.toString(),
        checkedInAt: claimed.checkedInAt,
        entryCount: claimed.entryCount,
        gate
      },
      { ticket: claimed, attendeeName: claimed.attendee.name }
    );
  }

  // Lost the race, or scanned twice.
  const current = await Ticket.findById(ticket._id);
  const outcome = mode === 'offline_sync' ? 'conflict' : 'duplicate';
  const outcomeResult = await finish(
    outcome,
    {
      attendeeName: current.attendee.name,
      ticketId: current._id.toString(),
      firstCheckIn: {
        at: current.checkedInAt,
        gate: current.checkedInGate
      },
      why:
        current.state === 'outside'
          ? 'Already attended and re-entry is off for this event'
          : undefined
    },
    { ticket: current, attendeeName: current.attendee.name }
  );

  if (outcome === 'conflict' && outcomeResult.created) {
    await Ticket.updateOne({ _id: current._id }, { $inc: { conflictCount: 1 } });
  }
  return outcomeResult;
}

/**
 * Records an operator's "that is not them" verdict. The ticket is left valid
 * and unclaimed: the attendee can be sorted out at the desk, and the organizer
 * sees the refusal in the scan log.
 */
export async function recordFaceRejection({ eventId, code, scanId, gate, operator }) {
  const existing = await ScanLog.findOne({ scanId });
  if (existing) return result(existing.outcome, { replayed: true });

  const ticket = await Ticket.findOne({ code, event: eventId });
  const log = await ScanLog.create({
    event: String(eventId),
    ticket: ticket?._id ?? null,
    scanId,
    outcome: 'face_rejected',
    mode: 'online',
    entry: 'camera',
    gate,
    operator: operator?.id ?? null,
    operatorName: operator?.name ?? '',
    attendeeName: ticket?.attendee?.name ?? '',
    codeFingerprint: fingerprintCode(code),
    message: MESSAGES.face_rejected,
    scannedAt: new Date()
  });

  return result('face_rejected', {
    attendeeName: ticket?.attendee?.name ?? null,
    scanId,
    scan: log.toPublic()
  });
}

/** Processes a queue of offline scans in submission order. */
export async function processScanBatch(eventId, scans, context) {
  const results = [];
  for (const scan of scans) {
    results.push(
      await processScan({
        eventId,
        // A queued scan cannot be face-reviewed: the operator judged it hours
        // ago with no photo on the device. Refusing entry because the wifi
        // dropped is worse than admitting, so it is admitted and left with
        // faceCheckedAt null — the scan log's offline_sync mode and that null
        // are what tell the organizer which entries went unverified.
        requireFace: false,
        raw: scan.payload,
        scanId: scan.scanId,
        gate: scan.gate || context.gate,
        entry: scan.entry || 'camera',
        mode: 'offline_sync',
        operator: context.operator,
        direction: scan.direction || 'entry',
        allowReEntry: context.allowReEntry,
        scannedAt: scan.scannedAt ? new Date(scan.scannedAt) : new Date()
      })
    );
  }
  return { results, stats: await getEventStats(eventId) };
}

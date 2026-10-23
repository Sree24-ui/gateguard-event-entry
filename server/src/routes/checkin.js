import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, loadEvent } from '../middleware/auth.js';
import { wrap, badRequest } from '../lib/errors.js';
import { processScan, processScanBatch, recordFaceRejection } from '../services/checkin.js';
import { getEventStats } from '../services/stats.js';
import { createLimiter } from '../lib/rateLimit.js';

const router = express.Router({ mergeParams: true });

// Generous: a busy gate scans fast. Still bounded so a stolen session cannot
// be used to brute-force ticket codes.
const scanLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 240,
  message: 'Scanning too fast. Pause for a moment.'
});

// A queued offline scan can be hours old, but it cannot be from the future
// and it cannot predate the queue. Without bounds a client could write any
// timestamp into checkedInAt and skew every arrival chart.
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 2 * 60 * 1000;

const scannedAt = z.coerce
  .date()
  .optional()
  .refine(
    (value) =>
      !value ||
      (value.getTime() <= Date.now() + MAX_SKEW_MS &&
        value.getTime() >= Date.now() - MAX_BACKDATE_MS),
    { message: 'Scan time must be within the last 24 hours and not in the future' }
  );

const scanSchema = z.object({
  payload: z.string().trim().min(1, 'Nothing was scanned').max(400),
  scanId: z.string().trim().min(8, 'A scan id is required').max(64),
  gate: z.string().trim().max(60).default('Main Gate'),
  entry: z.enum(['camera', 'manual', 'api']).default('camera'),
  direction: z.enum(['entry', 'exit']).default('entry'),
  // Set by the operator after comparing the attendee with their photo.
  faceConfirmed: z.boolean().default(false),
  scannedAt
});

const faceRejectSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Not a ticket code'),
  scanId: z.string().trim().min(8).max(64),
  gate: z.string().trim().max(60).default('Main Gate')
});

const batchSchema = z.object({
  gate: z.string().trim().max(60).default('Main Gate'),
  scans: z
    .array(
      z.object({
        payload: z.string().trim().min(1).max(400),
        scanId: z.string().trim().min(8).max(64),
        gate: z.string().trim().max(60).optional(),
        entry: z.enum(['camera', 'manual', 'api']).optional(),
        direction: z.enum(['entry', 'exit']).optional(),
        scannedAt
      })
    )
    .min(1, 'Nothing to sync')
    .max(200, 'Sync at most 200 scans at a time')
});

router.use(requireAuth, loadEvent, scanLimiter);

function operatorContext(req) {
  return { id: req.user._id, name: req.user.name };
}

function assertScannable(event) {
  if (event.status === 'draft') {
    throw badRequest('Publish the event before checking attendees in');
  }
}

router.post(
  '/',
  validate(scanSchema),
  wrap(async (req, res) => {
    assertScannable(req.event);
    const { payload, scanId, gate, entry, scannedAt, faceConfirmed, direction } = req.body;

    const result = await processScan({
      eventId: req.event._id,
      raw: payload,
      scanId,
      gate,
      entry,
      mode: 'online',
      operator: operatorContext(req),
      scannedAt: scannedAt || new Date(),
      requireFace: req.event.faceCheck,
      faceConfirmed,
      direction,
      allowReEntry: req.event.reEntry
    });

    // A face review is a pending step, not a refusal, so it is not a 409.
    const status = result.ok || result.outcome === 'face_review' ? 200 : 409;
    res.status(status).json({
      result,
      stats: await getEventStats(req.event._id, req.event)
    });
  })
);

/** Replays a device's offline queue. Safe to call again with the same ids. */
router.post(
  '/batch',
  validate(batchSchema),
  wrap(async (req, res) => {
    assertScannable(req.event);
    const { results, stats } = await processScanBatch(req.event._id, req.body.scans, {
      gate: req.body.gate,
      operator: operatorContext(req),
      allowReEntry: req.event.reEntry
    });
    res.json({ results, stats });
  })
);

/** Logs that the operator judged the person not to match the photo. */
router.post(
  '/face-reject',
  validate(faceRejectSchema),
  wrap(async (req, res) => {
    assertScannable(req.event);
    const result = await recordFaceRejection({
      eventId: req.event._id,
      code: req.body.code,
      scanId: req.body.scanId,
      gate: req.body.gate,
      operator: operatorContext(req),
      allowReEntry: req.event.reEntry
    });
    res.json({ result, stats: await getEventStats(req.event._id, req.event) });
  })
);

export default router;

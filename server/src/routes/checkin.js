import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, loadEvent } from '../middleware/auth.js';
import { wrap, badRequest } from '../lib/errors.js';
import { processScan, processScanBatch } from '../services/checkin.js';
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

const scanSchema = z.object({
  payload: z.string().trim().min(1, 'Nothing was scanned').max(400),
  scanId: z.string().trim().min(8, 'A scan id is required').max(64),
  gate: z.string().trim().max(60).default('Main Gate'),
  entry: z.enum(['camera', 'manual', 'api']).default('camera'),
  scannedAt: z.coerce.date().optional()
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
        scannedAt: z.coerce.date().optional()
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
    const { payload, scanId, gate, entry, scannedAt } = req.body;

    const result = await processScan({
      eventId: req.event._id,
      raw: payload,
      scanId,
      gate,
      entry,
      mode: 'online',
      operator: operatorContext(req),
      scannedAt: scannedAt || new Date()
    });

    res.status(result.ok ? 200 : 409).json({
      result,
      stats: await getEventStats(req.event._id)
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
      operator: operatorContext(req)
    });
    res.json({ results, stats });
  })
);

export default router;

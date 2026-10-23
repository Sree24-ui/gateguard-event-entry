import mongoose from 'mongoose';

export const SCAN_OUTCOMES = [
  'checked_in',
  'duplicate',
  'invalid_signature',
  'malformed',
  'wrong_event',
  'unknown',
  'cancelled',
  'conflict',
  'face_review',
  'face_rejected',
  're_entered',
  'checked_out',
  'invalid_exit'
];

/**
 * Append-only record of every scan attempt, online or synced from a queue.
 * `scanId` is client generated and unique, which makes check-in idempotent:
 * a retried request replays the stored outcome instead of double-counting.
 */
const scanLogSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
    scanId: { type: String, required: true, unique: true },
    outcome: { type: String, enum: SCAN_OUTCOMES, required: true, index: true },
    mode: { type: String, enum: ['online', 'offline_sync'], default: 'online' },
  direction: { type: String, enum: ['entry', 'exit'], default: 'entry', index: true },
    entry: { type: String, enum: ['camera', 'manual', 'api'], default: 'camera' },
    gate: { type: String, default: 'Main Gate' },
    operator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    operatorName: { type: String, default: '' },
    attendeeName: { type: String, default: '' },
    // Truncated SHA-256 of the scanned code. Enough to group repeat attempts
    // from a forged ticket without storing the credential itself.
    codeFingerprint: { type: String, default: '' },
    message: { type: String, default: '' },
    scannedAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
);

scanLogSchema.index({ event: 1, createdAt: -1 });

scanLogSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    scanId: this.scanId,
    outcome: this.outcome,
    mode: this.mode,
    direction: this.direction,
    entry: this.entry,
    gate: this.gate,
    operatorName: this.operatorName,
    attendeeName: this.attendeeName,
    message: this.message,
    scannedAt: this.scannedAt,
    createdAt: this.createdAt
  };
};

export const ScanLog = mongoose.models.ScanLog || mongoose.model('ScanLog', scanLogSchema);

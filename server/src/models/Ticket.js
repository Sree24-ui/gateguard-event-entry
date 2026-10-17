import mongoose from 'mongoose';

/**
 * One document per attendee registration. The `code` is the ticket secret:
 * 16 bytes of CSPRNG output, so it cannot be guessed or enumerated.
 */
const ticketSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    code: { type: String, required: true, unique: true },
    attendee: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      email: { type: String, required: true, lowercase: true, trim: true, maxlength: 190 },
      phone: { type: String, trim: true, maxlength: 32, default: '' },
      collegeId: { type: String, trim: true, maxlength: 64, default: '' }
    },
    status: { type: String, enum: ['valid', 'cancelled'], default: 'valid', index: true },
    source: {
      type: String,
      enum: ['organizer', 'public', 'import', 'demo'],
      default: 'organizer'
    },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    checkedInGate: { type: String, default: null },
    checkInScanId: { type: String, default: null },
    // Set when an offline scan arrives for a ticket that was already claimed
    // by a different scan. Surfaced to the organizer for review.
    conflictCount: { type: Number, default: 0 },
    reissuedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// One registration per email per event.
ticketSchema.index({ event: 1, 'attendee.email': 1 }, { unique: true });
ticketSchema.index({ event: 1, checkedInAt: 1 });
ticketSchema.index({ event: 1, createdAt: -1 });

ticketSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    eventId: this.event.toString?.() ?? String(this.event),
    code: this.code,
    attendee: {
      name: this.attendee.name,
      email: this.attendee.email,
      phone: this.attendee.phone,
      collegeId: this.attendee.collegeId
    },
    status: this.status,
    source: this.source,
    checkedInAt: this.checkedInAt,
    checkedInGate: this.checkedInGate,
    conflictCount: this.conflictCount,
    createdAt: this.createdAt
  };
};

export const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);

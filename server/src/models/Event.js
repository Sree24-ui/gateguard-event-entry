import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema(
  {
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    venue: { type: String, trim: true, maxlength: 200, default: '' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    capacity: { type: Number, min: 0, default: 0 }, // 0 = unlimited
    status: {
      type: String,
      enum: ['draft', 'published', 'live', 'closed'],
      default: 'draft',
      index: true
    },
    gates: { type: [String], default: ['Main Gate'] },
    publicRegistration: { type: Boolean, default: true },
    // When on, a scanned ticket is held for the operator to compare the
    // attendee against the photo taken at registration before admitting.
    faceCheck: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false }
  },
  { timestamps: true }
);

eventSchema.index({ organizer: 1, startsAt: -1 });

eventSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    description: this.description,
    venue: this.venue,
    startsAt: this.startsAt,
    endsAt: this.endsAt,
    capacity: this.capacity,
    status: this.status,
    gates: this.gates,
    publicRegistration: this.publicRegistration,
    faceCheck: this.faceCheck,
    isDemo: this.isDemo,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

export const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

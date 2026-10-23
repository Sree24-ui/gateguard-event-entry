import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 190
    },
    // Attendees never set a password: they sign in with a one-time code and
    // then a passkey. Only staff accounts carry a hash.
    passwordHash: {
      type: String,
      select: false,
      required() {
        return this.role !== 'attendee';
      }
    },
    role: {
      type: String,
      enum: ['organizer', 'operator', 'attendee'],
      default: 'organizer',
      index: true
    },
    // Operators belong to the organizer who created them and can only work
    // the events they were assigned to.
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
    lastLoginAt: { type: Date, default: null },

    // One-time sign-in code. Stored hashed so a database read cannot be
    // replayed into a session.
    otpHash: { type: String, select: false, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },

    // WebAuthn. Only public keys live here — the fingerprint or face never
    // leaves the device's secure enclave and is never sent to this server.
    passkeys: [
      {
        _id: false,
        credentialId: { type: String, required: true },
        publicKey: { type: String, required: true },
        counter: { type: Number, default: 0 },
        deviceType: { type: String, default: '' },
        label: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    currentChallenge: { type: String, select: false, default: null }
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    assignedEvents: (this.assignedEvents || []).map((id) => id.toString()),
    hasPasskey: (this.passkeys || []).length > 0,
    createdAt: this.createdAt
  };
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);

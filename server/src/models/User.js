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
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['organizer', 'operator'], default: 'organizer', index: true },
    // Operators belong to the organizer who created them and can only work
    // the events they were assigned to.
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
    lastLoginAt: { type: Date, default: null }
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
    createdAt: this.createdAt
  };
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);

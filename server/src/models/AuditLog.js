import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'system' },
    action: { type: String, required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null, index: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    summary: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

auditLogSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    actorName: this.actorName,
    action: this.action,
    eventId: this.event ? this.event.toString() : null,
    targetType: this.targetType,
    targetId: this.targetId,
    summary: this.summary,
    meta: this.meta,
    createdAt: this.createdAt
  };
};

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

import { AuditLog } from '../models/AuditLog.js';

/** Fire-and-forget audit entry; never breaks the request it describes. */
export function audit({ actor, action, event, targetType, targetId, summary, meta }) {
  return AuditLog.create({
    actor: actor?._id ?? null,
    actorName: actor?.name ?? 'system',
    action,
    event: event?._id ?? event ?? null,
    targetType: targetType || '',
    targetId: targetId ? String(targetId) : '',
    summary: summary || '',
    meta: meta || {}
  }).catch((err) => console.error({ msg: 'audit_failed', action, error: err?.message }));
}

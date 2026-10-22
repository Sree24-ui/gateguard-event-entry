export type Role = 'organizer' | 'operator';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  assignedEvents: string[];
  createdAt: string;
}

export type EventStatus = 'draft' | 'published' | 'live' | 'closed';

export interface EventStats {
  registered: number;
  checkedIn: number;
  remaining: number;
  cancelled: number;
  conflicts: number;
  attendancePct: number;
  lastCheckInAt: string | null;
  lastCheckInName: string | null;
  asOf: string;
}

export interface GateEvent {
  id: string;
  name: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: EventStatus;
  gates: string[];
  publicRegistration: boolean;
  faceCheck: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: EventStats;
}

export interface Attendee {
  name: string;
  email: string;
  phone: string;
  collegeId: string;
}

export interface Ticket {
  id: string;
  eventId: string;
  code: string;
  attendee: Attendee;
  status: 'valid' | 'cancelled';
  source: 'organizer' | 'public' | 'import' | 'demo';
  checkedInAt: string | null;
  checkedInGate: string | null;
  conflictCount: number;
  hasPhoto: boolean;
  faceCheckedAt: string | null;
  createdAt: string;
  qrPayload?: string;
}

export type ScanOutcome =
  | 'checked_in'
  | 'duplicate'
  | 'conflict'
  | 'invalid_signature'
  | 'malformed'
  | 'wrong_event'
  | 'unknown'
  | 'cancelled'
  | 'face_review'
  | 'face_rejected';

export interface ScanResult {
  ok: boolean;
  outcome: ScanOutcome;
  message: string;
  attendeeName?: string | null;
  ticketId?: string;
  checkedInAt?: string | null;
  gate?: string;
  scanId?: string;
  replayed?: boolean;
  firstCheckIn?: { at: string | null; gate: string | null };
  /** Present only on a face_review result, for the operator to compare. */
  photo?: string;
  photoCapturedAt?: string | null;
}

export interface ScanLogEntry {
  id: string;
  scanId: string;
  outcome: ScanOutcome;
  mode: 'online' | 'offline_sync';
  entry: 'camera' | 'manual' | 'api';
  gate: string;
  operatorName: string;
  attendeeName: string;
  message: string;
  scannedAt: string;
  createdAt: string;
}

export interface Analytics {
  bucketMinutes: number;
  byGate: { gate: string; count: number }[];
  outcomes: { outcome: ScanOutcome; count: number }[];
  timeline: { at: string; count: number }[];
}

export interface AuditEntry {
  id: string;
  actorName: string;
  action: string;
  eventId: string | null;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface OfflineManifest {
  eventId: string;
  eventName: string;
  gates: string[];
  issuedAt: string;
  count: number;
  validHashes: string[];
  checkedInHashes: string[];
}

export interface PublicEvent {
  id: string;
  name: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  publicRegistration: boolean;
  faceCheck: boolean;
  capacity: number;
  issued: number;
  spotsLeft: number | null;
}

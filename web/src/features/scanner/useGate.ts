import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import {
  dropFromQueue,
  listQueue,
  loadAdmitted,
  loadManifest,
  markAttempt,
  queueScan,
  rememberAdmitted,
  saveManifest,
  type QueuedScan
} from '../../lib/offline';
import { newScanId, offlineVerdict, parseScanPayload } from '../../lib/scan';
import type { EventStats, OfflineManifest, ScanOutcome, ScanResult } from '../../lib/types';

/**
 * True when the request did not produce an authoritative answer: the device
 * is offline, the server never replied, it failed, or it asked us to back
 * off. None of these mean "refused" — the ticket's fate is still unknown, so
 * the scan goes to the queue instead of showing the operator a red screen.
 */
function unresolved(err: ApiError) {
  return err.offline || err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429;
}

/**
 * How many times a queued scan is retried before the device stops on its own.
 * `attempts` was recorded but never read, so a failing server was retried
 * every 1.2s forever — and a 429 guaranteed it stayed rate limited.
 */
const MAX_SYNC_ATTEMPTS = 5;
const RETRY_BASE_MS = 2000;

/** Ignore the same code while it sits in front of the lens. */
const SAME_CODE_COOLDOWN_MS = 4000;
/** Never fire two lookups back to back, whatever is in frame. */
const ANY_SCAN_COOLDOWN_MS = 900;

export type Verdict = 'admit' | 'reject' | 'pending' | 'review' | 'exit';

export interface GateResult {
  id: string;
  verdict: Verdict;
  word: string;
  name: string | null;
  why: string;
  outcome: ScanOutcome | 'queued' | 'duplicate_local';
  at: string;
  entry: 'camera' | 'manual';
  /** Set on a face review: the registration photo and what to resubmit. */
  photo?: string;
  pendingPayload?: string;
}

const SERVER_COPY: Record<ScanOutcome, { verdict: Verdict; word: string }> = {
  checked_in: { verdict: 'admit', word: 'Admit' },
  duplicate: { verdict: 'reject', word: 'Already in' },
  conflict: { verdict: 'reject', word: 'Conflict' },
  invalid_signature: { verdict: 'reject', word: 'Forged' },
  malformed: { verdict: 'reject', word: 'Not a ticket' },
  wrong_event: { verdict: 'reject', word: 'Wrong event' },
  unknown: { verdict: 'reject', word: 'Unknown' },
  cancelled: { verdict: 'reject', word: 'Cancelled' },
  face_review: { verdict: 'review', word: 'Check face' },
  face_rejected: { verdict: 'reject', word: 'Not them' },
  re_entered: { verdict: 'admit', word: 'Back in' },
  checked_out: { verdict: 'exit', word: 'Exit' },
  invalid_exit: { verdict: 'reject', word: 'Not inside' },
  expired: { verdict: 'reject', word: 'Expired' },
  replayed: { verdict: 'reject', word: 'Code used' }
};

/**
 * Never index SERVER_COPY directly: an outcome a deployed bundle has not seen
 * yet threw a TypeError, which fell through to the offline path and silently
 * queued a scan the server had already decided.
 */
function copyFor(outcome: ScanOutcome) {
  return SERVER_COPY[outcome] ?? { verdict: 'reject' as Verdict, word: 'Refused' };
}

function describe(result: ScanResult) {
  if (result.why) return result.why;
  if (result.outcome === 'duplicate' || result.outcome === 'conflict') {
    const at = result.firstCheckIn?.at ? new Date(result.firstCheckIn.at) : null;
    const gate = result.firstCheckIn?.gate;
    if (at) {
      const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return gate ? `Entered at ${time} via ${gate}` : `Entered at ${time}`;
    }
  }
  return result.message;
}

interface Options {
  eventId: string;
  gate: string;
  direction: 'entry' | 'exit';
  online: boolean;
  onStats: (stats: EventStats) => void;
}

export function useGate({ eventId, gate, direction, online, onStats }: Options) {
  const [result, setResult] = useState<GateResult | null>(null);
  const [history, setHistory] = useState<GateResult[]>([]);
  const [queued, setQueued] = useState<QueuedScan[]>([]);
  const [manifest, setManifest] = useState<OfflineManifest | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);

  const admittedRef = useRef<Set<string>>(new Set());
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const lastScanAtRef = useRef(0);
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const refreshQueue = useCallback(async () => {
    setQueued(await listQueue(eventId));
  }, [eventId]);

  // Load whatever this device already knows about the event.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, admitted, pending] = await Promise.all([
        loadManifest(eventId),
        loadAdmitted(eventId),
        listQueue(eventId)
      ]);
      if (cancelled) return;
      admittedRef.current = admitted;
      setManifest(stored);
      setQueued(pending);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  /** Pulls the hashed ticket set so the device can judge tickets offline. */
  const refreshManifest = useCallback(async () => {
    const { manifest: fresh } = await api.get<{ manifest: OfflineManifest }>(
      `/events/${eventId}/offline-manifest`
    );
    await saveManifest(fresh);
    setManifest(fresh);
    return fresh;
  }, [eventId]);

  const record = useCallback((entry: GateResult) => {
    setResult(entry);
    setHistory((current) => [entry, ...current].slice(0, 25));
  }, []);

  /** Replays the device queue. Safe to call repeatedly: scan ids dedupe it. */
  const sync = useCallback(async () => {
    const pending = await listQueue(eventId);
    if (!pending.length) {
      setQueued([]);
      return { synced: 0, conflicts: 0 };
    }

    setSyncing(true);
    try {
      const body = {
        gate: gateRef.current,
        scans: pending.map((scan) => ({
          payload: scan.payload,
          scanId: scan.scanId,
          gate: scan.gate,
          entry: scan.entry,
          direction: scan.direction,
          scannedAt: scan.scannedAt
        }))
      };
      const response = await api.post<{ results: ScanResult[]; stats: EventStats }>(
        `/events/${eventId}/checkin/batch`,
        body
      );

      await dropFromQueue(pending.map((scan) => scan.scanId));
      onStats(response.stats);
      await refreshQueue();

      const conflicts = response.results.filter(
        (item) => item.outcome === 'conflict' || item.outcome === 'duplicate'
      ).length;

      // If the operator is still looking at a "Queued" verdict, replace it
      // with what the server actually decided for that same scan.
      setResult((current) => {
        if (!current || current.outcome !== 'queued') return current;
        const resolved = response.results.find((item) => item.scanId === current.id);
        if (!resolved) return current;
        const copy = copyFor(resolved.outcome);
        return {
          ...current,
          verdict: copy.verdict,
          word: copy.word,
          name: resolved.attendeeName ?? current.name,
          why: `Confirmed on sync — ${describe(resolved)}`,
          outcome: resolved.outcome
        };
      });

      setHistory((current) => [
        ...response.results
          .filter((item) => !item.ok)
          .map((item, index) => ({
            id: `${item.scanId ?? 'sync'}-${index}`,
            verdict: 'reject' as Verdict,
            word: copyFor(item.outcome).word,
            name: item.attendeeName ?? null,
            why: `Resolved on sync — ${describe(item)}`,
            outcome: item.outcome,
            at: new Date().toISOString(),
            entry: 'camera' as const
          })),
        ...current
      ].slice(0, 25));

      return { synced: response.results.length, conflicts };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Sync failed';
      await Promise.all(pending.map((scan) => markAttempt(scan.scanId, message)));
      await refreshQueue();
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [eventId, onStats, refreshQueue]);

  /** Queues a scan this device could not confirm with the server. */
  const enqueue = useCallback(
    async (payload: string, entry: 'camera' | 'manual', hash: string | undefined, why: string) => {
      const scan: QueuedScan = {
        scanId: newScanId(),
        eventId,
        payload,
        gate: gateRef.current,
        entry,
        direction: directionRef.current,
        scannedAt: new Date().toISOString(),
        attempts: 0,
        localVerdict: 'provisional'
      };
      await queueScan(scan);
      if (hash) {
        admittedRef.current.add(hash);
        await rememberAdmitted(eventId, hash);
      }
      await refreshQueue();
      record({
        id: scan.scanId,
        verdict: 'pending',
        word: 'Queued',
        name: null,
        why,
        outcome: 'queued',
        at: scan.scannedAt,
        entry
      });
    },
    [eventId, record, refreshQueue]
  );

  const submit = useCallback(
    async (raw: string, entry: 'camera' | 'manual') => {
      const now = Date.now();
      if (entry === 'camera') {
        if (now - lastScanAtRef.current < ANY_SCAN_COOLDOWN_MS) return;
        const last = lastCodeRef.current;
        if (last && last.code === raw && now - last.at < SAME_CODE_COOLDOWN_MS) return;
      }
      lastScanAtRef.current = now;
      lastCodeRef.current = { code: raw, at: now };

      setBusy(true);
      try {
        if (online) {
          try {
            const response = await api.post<{ result: ScanResult; stats: EventStats }>(
              `/events/${eventId}/checkin`,
              {
                payload: raw,
                scanId: newScanId(),
                gate: gateRef.current,
                entry,
                direction: directionRef.current
              }
            );
            onStats(response.stats);
            const copy = copyFor(response.result.outcome);
            record({
              id: response.result.scanId ?? newScanId(),
              verdict: copy.verdict,
              word: copy.word,
              name: response.result.attendeeName ?? null,
              why: describe(response.result),
              outcome: response.result.outcome,
              at: new Date().toISOString(),
              entry,
              photo: response.result.photo,
              pendingPayload: response.result.outcome === 'face_review' ? raw : undefined
            });
            return;
          } catch (err) {
            // A refused ticket arrives as a 409 that still carries the full
            // result. Only a genuine network failure falls through to the
            // offline path below.
            if (err instanceof ApiError && !unresolved(err)) {
              const payload = err.body as { result?: ScanResult; stats?: EventStats } | undefined;
              if (payload?.result) {
                if (payload.stats) onStats(payload.stats);
                const copy = copyFor(payload.result.outcome);
                record({
                  id: payload.result.scanId ?? newScanId(),
                  verdict: copy.verdict,
                  word: copy.word,
                  name: payload.result.attendeeName ?? null,
                  why: describe(payload.result),
                  outcome: payload.result.outcome,
                  at: new Date().toISOString(),
                  entry
                });
                return;
              }
              record({
                id: newScanId(),
                verdict: 'reject',
                word: err.status === 403 ? 'No access' : 'Refused',
                name: null,
                why: err.message,
                outcome: 'malformed',
                at: new Date().toISOString(),
                entry
              });
              return;
            }
          }
        }

        // Offline (or the request never left the device).
        const parsed = parseScanPayload(raw);
        const { verdict, hash } = await offlineVerdict(parsed, manifest, admittedRef.current);

        if (verdict === 'provisional_admit') {
          await enqueue(raw, entry, hash, 'Valid on this device — awaiting server verification');
          return;
        }
        if (verdict === 'no_manifest') {
          await enqueue(
            raw,
            entry,
            undefined,
            'This device has no offline ticket list — the server will decide'
          );
          return;
        }

        const offlineCopy: Record<string, { word: string; why: string }> = {
          malformed: { word: 'Not a ticket', why: 'That QR code is not a GateGuard ticket' },
          wrong_event: { word: 'Wrong event', why: 'This ticket belongs to a different event' },
          unknown: { word: 'Unknown', why: 'Not in this event’s ticket list' },
          already_admitted_here: {
            word: 'Already in',
            why: 'This device already let that ticket through'
          },
          already_checked_in: {
            word: 'Already in',
            why: `Checked in as of the last sync${
              manifest ? ` (${new Date(manifest.issuedAt).toLocaleTimeString()})` : ''
            }`
          }
        };
        const copy = offlineCopy[verdict];
        record({
          id: newScanId(),
          verdict: 'reject',
          word: copy.word,
          name: null,
          why: copy.why,
          outcome: verdict === 'already_admitted_here' ? 'duplicate_local' : (verdict as ScanOutcome),
          at: new Date().toISOString(),
          entry
        });
      } finally {
        setBusy(false);
      }
    },
    [eventId, enqueue, manifest, online, onStats, record]
  );

  /** The operator says the face matches: admit for real. */
  const confirmFace = useCallback(async () => {
    const pending = result?.pendingPayload;
    if (!pending) return;
    setBusy(true);
    try {
      const response = await api.post<{ result: ScanResult; stats: EventStats }>(
        `/events/${eventId}/checkin`,
        {
          payload: pending,
          scanId: newScanId(),
          gate: gateRef.current,
          entry: 'camera',
          direction: directionRef.current,
          faceConfirmed: true
        }
      );
      onStats(response.stats);
      const copy = copyFor(response.result.outcome);
      record({
        id: response.result.scanId ?? newScanId(),
        verdict: copy.verdict,
        word: copy.word,
        name: response.result.attendeeName ?? null,
        why: describe(response.result),
        outcome: response.result.outcome,
        at: new Date().toISOString(),
        entry: 'camera'
      });
    } finally {
      setBusy(false);
    }
  }, [eventId, onStats, record, result]);

  /** The operator says it is not them: log it, leave the ticket unused. */
  const rejectFace = useCallback(async () => {
    const pending = result?.pendingPayload;
    if (!pending) return;
    const parsed = parseScanPayload(pending);
    if (!parsed.ok) return;
    setBusy(true);
    try {
      const response = await api.post<{ result: ScanResult; stats: EventStats }>(
        `/events/${eventId}/checkin/face-reject`,
        { code: parsed.code, scanId: newScanId(), gate: gateRef.current }
      );
      onStats(response.stats);
      record({
        id: response.result.scanId ?? newScanId(),
        verdict: 'reject',
        word: 'Not them',
        name: response.result.attendeeName ?? null,
        why: 'Face did not match the registration photo — sent to the desk',
        outcome: 'face_rejected',
        at: new Date().toISOString(),
        entry: 'camera'
      });
    } finally {
      setBusy(false);
    }
  }, [eventId, onStats, record, result]);

  // Drain the queue as soon as the connection is back, backing off as
  // attempts accumulate and stopping once the cap is reached. A stalled queue
  // is surfaced through `stalled` so the operator can retry deliberately.
  const attempts = queued.reduce((most, scan) => Math.max(most, scan.attempts), 0);
  const stalled = attempts >= MAX_SYNC_ATTEMPTS;

  useEffect(() => {
    if (!online || !queued.length || syncing || stalled) return;
    const delay = RETRY_BASE_MS * 2 ** attempts;
    const timer = window.setTimeout(() => {
      sync().catch(() => undefined);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [online, queued.length, syncing, stalled, attempts, sync]);

  return {
    result,
    history,
    queued,
    stalled,
    manifest,
    syncing,
    busy,
    submit,
    confirmFace,
    rejectFace,
    sync,
    refreshManifest,
    clearResult: () => setResult(null)
  };
}

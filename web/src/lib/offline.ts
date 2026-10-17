import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OfflineManifest } from './types';

export interface QueuedScan {
  scanId: string;
  eventId: string;
  payload: string;
  gate: string;
  entry: 'camera' | 'manual';
  scannedAt: string;
  attempts: number;
  lastError?: string;
  /** What the device decided locally, before the server saw it. */
  localVerdict: string;
}

interface GateGuardDB extends DBSchema {
  queue: { key: string; value: QueuedScan; indexes: { byEvent: string } };
  manifests: { key: string; value: OfflineManifest };
  admitted: { key: string; value: { id: string; eventId: string; hash: string; at: string } };
}

let dbPromise: Promise<IDBPDatabase<GateGuardDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<GateGuardDB>('gateguard', 1, {
      upgrade(database) {
        const queue = database.createObjectStore('queue', { keyPath: 'scanId' });
        queue.createIndex('byEvent', 'eventId');
        database.createObjectStore('manifests', { keyPath: 'eventId' });
        database.createObjectStore('admitted', { keyPath: 'id' });
      }
    });
  }
  return dbPromise;
}

export async function queueScan(scan: QueuedScan) {
  await (await db()).put('queue', scan);
}

export async function listQueue(eventId: string) {
  const all = await (await db()).getAllFromIndex('queue', 'byEvent', eventId);
  return all.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

export async function queueSize(eventId: string) {
  return (await listQueue(eventId)).length;
}

export async function dropFromQueue(scanIds: string[]) {
  const database = await db();
  const tx = database.transaction('queue', 'readwrite');
  await Promise.all(scanIds.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function markAttempt(scanId: string, error: string) {
  const database = await db();
  const existing = await database.get('queue', scanId);
  if (!existing) return;
  await database.put('queue', { ...existing, attempts: existing.attempts + 1, lastError: error });
}

export async function saveManifest(manifest: OfflineManifest) {
  await (await db()).put('manifests', manifest);
}

export async function loadManifest(eventId: string) {
  return (await db()).get('manifests', eventId);
}

/** Remembers which codes this device let through, so it never queues twice. */
export async function rememberAdmitted(eventId: string, hash: string) {
  await (await db()).put('admitted', {
    id: `${eventId}:${hash}`,
    eventId,
    hash,
    at: new Date().toISOString()
  });
}

export async function loadAdmitted(eventId: string) {
  const all = await (await db()).getAll('admitted');
  return new Set(all.filter((row) => row.eventId === eventId).map((row) => row.hash));
}

export async function clearEventData(eventId: string) {
  const database = await db();
  const queued = await listQueue(eventId);
  await dropFromQueue(queued.map((scan) => scan.scanId));
  await database.delete('manifests', eventId);
  const admitted = await database.getAll('admitted');
  const tx = database.transaction('admitted', 'readwrite');
  await Promise.all(
    admitted.filter((row) => row.eventId === eventId).map((row) => tx.store.delete(row.id))
  );
  await tx.done;
}

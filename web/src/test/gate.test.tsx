import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createHmac, randomBytes } from 'node:crypto';
import { useGate } from '../features/scanner/useGate';

const EVENT = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const SECRET = 'test-ticket-secret-value';

const payloadFor = (code: string, eventId = EVENT) => {
  const sig = createHmac('sha256', SECRET).update(`${eventId}:${code}`).digest('base64url').slice(0, 24);
  return `GG1:${eventId}:${code}:${sig}`;
};
const newCode = () => randomBytes(16).toString('base64url');

// IndexedDB is absent in jsdom; the queue is covered by its own contract here.
const queue: Record<string, unknown> = {};
vi.mock('../lib/offline', () => ({
  queueScan: vi.fn(async (scan: { scanId: string }) => {
    queue[scan.scanId] = scan;
  }),
  listQueue: vi.fn(async () => Object.values(queue)),
  dropFromQueue: vi.fn(async (ids: string[]) => ids.forEach((id) => delete queue[id])),
  markAttempt: vi.fn(async () => undefined),
  loadManifest: vi.fn(async () => undefined),
  saveManifest: vi.fn(async () => undefined),
  rememberAdmitted: vi.fn(async () => undefined),
  loadAdmitted: vi.fn(async () => new Set<string>())
}));

const STATS = {
  registered: 10,
  checkedIn: 1,
  remaining: 9,
  cancelled: 0,
  conflicts: 0,
  attendancePct: 10,
  lastCheckInAt: null,
  lastCheckInName: null,
  asOf: new Date().toISOString()
};

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body)
    } as Response;
  });
}

type Handler = () => { status: number; body: unknown };

function setup(online = true, handler: Handler = () => ({ status: 200, body: { result: { ok: true, outcome: 'checked_in', message: 'Checked in', attendeeName: 'Aarav Sharma' }, stats: STATS } })) {
  const fetchSpy = mockFetch(handler);
  vi.stubGlobal('fetch', fetchSpy);
  const onStats = vi.fn();
  const hook = renderHook(() =>
    useGate({ eventId: EVENT, gate: 'Main Gate', online, onStats })
  );
  return { hook, fetchSpy, onStats };
}

beforeEach(() => {
  for (const key of Object.keys(queue)) delete queue[key];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useGate online', () => {
  it('admits a valid ticket and pushes fresh stats', async () => {
    const { hook, onStats } = setup();
    await act(async () => {
      await hook.result.current.submit(payloadFor(newCode()), 'camera');
    });

    expect(hook.result.current.result).toMatchObject({
      verdict: 'admit',
      word: 'Admit',
      name: 'Aarav Sharma'
    });
    expect(onStats).toHaveBeenCalledWith(STATS);
  });

  it('shows the refusal carried by a 409, not a generic error', async () => {
    const { hook } = setup(true, () => ({
      status: 409,
      body: {
        error: { code: 'conflict', message: 'Already checked in' },
        result: {
          ok: false,
          outcome: 'duplicate',
          message: 'Already checked in',
          attendeeName: 'Diya Patel',
          firstCheckIn: { at: '2026-10-17T13:04:00.000Z', gate: 'Side Gate' }
        },
        stats: STATS
      }
    }));

    await act(async () => {
      await hook.result.current.submit(payloadFor(newCode()), 'camera');
    });

    expect(hook.result.current.result).toMatchObject({
      verdict: 'reject',
      word: 'Already in',
      name: 'Diya Patel'
    });
    expect(hook.result.current.result?.why).toMatch(/Side Gate/);
  });

  it('ignores the same code while it sits in front of the camera', async () => {
    const { hook, fetchSpy } = setup();
    const payload = payloadFor(newCode());

    await act(async () => {
      await hook.result.current.submit(payload, 'camera');
      await hook.result.current.submit(payload, 'camera');
      await hook.result.current.submit(payload, 'camera');
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never debounces a manually typed code', async () => {
    const { hook, fetchSpy } = setup();
    const code = newCode();

    await act(async () => {
      await hook.result.current.submit(code, 'manual');
      await hook.result.current.submit(code, 'manual');
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('useGate face check', () => {
  it('holds a review, keeps the payload, then admits on confirm', async () => {
    let call = 0;
    const { hook } = setup(true, () => {
      call += 1;
      return call === 1
        ? {
            status: 200,
            body: {
              result: {
                ok: false,
                outcome: 'face_review',
                message: 'Compare the attendee with their registration photo',
                attendeeName: 'Meera Nair',
                photo: 'data:image/jpeg;base64,AAAA'
              },
              stats: STATS
            }
          }
        : {
            status: 200,
            body: {
              result: { ok: true, outcome: 'checked_in', message: 'Checked in', attendeeName: 'Meera Nair' },
              stats: { ...STATS, checkedIn: 2 }
            }
          };
    });

    const payload = payloadFor(newCode());
    await act(async () => {
      await hook.result.current.submit(payload, 'camera');
    });

    expect(hook.result.current.result).toMatchObject({
      verdict: 'review',
      word: 'Check face',
      name: 'Meera Nair',
      photo: 'data:image/jpeg;base64,AAAA'
    });
    // The payload is kept so the confirm can resubmit it.
    expect(hook.result.current.result?.pendingPayload).toBe(payload);

    await act(async () => {
      await hook.result.current.confirmFace();
    });

    expect(hook.result.current.result).toMatchObject({ verdict: 'admit', word: 'Admit' });
  });

  it('does nothing when there is no review pending', async () => {
    const { hook, fetchSpy } = setup();
    await act(async () => {
      await hook.result.current.confirmFace();
      await hook.result.current.rejectFace();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('useGate offline', () => {
  it('queues a scan it cannot verify and labels it as awaiting the server', async () => {
    const { hook, fetchSpy } = setup(false);

    await act(async () => {
      await hook.result.current.submit(payloadFor(newCode()), 'camera');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(hook.result.current.result).toMatchObject({ verdict: 'pending', word: 'Queued' });
    expect(hook.result.current.result?.why).toMatch(/server/i);
    await waitFor(() => expect(Object.keys(queue)).toHaveLength(1));
  });

  it('refuses a QR that is not a ticket without queueing it', async () => {
    const { hook } = setup(false);

    await act(async () => {
      await hook.result.current.submit('https://example.com/not-a-ticket', 'manual');
    });

    expect(hook.result.current.result).toMatchObject({ verdict: 'reject', word: 'Not a ticket' });
    expect(Object.keys(queue)).toHaveLength(0);
  });

  it('queues rather than refusing when the server errors out', async () => {
    // A 502 from a proxy in front of a dead backend is not a refusal: the
    // ticket's fate is unknown, so it must not show the operator a red screen.
    const { hook } = setup(true, () => ({
      status: 502,
      body: { error: { code: 'bad_gateway', message: 'Bad gateway' } }
    }));

    await act(async () => {
      await hook.result.current.submit(payloadFor(newCode()), 'camera');
    });

    expect(hook.result.current.result).toMatchObject({ verdict: 'pending', word: 'Queued' });
    await waitFor(() => expect(Object.keys(queue)).toHaveLength(1));
  });

  it('still refuses on a definitive 403 from the server', async () => {
    const { hook } = setup(true, () => ({
      status: 403,
      body: { error: { code: 'forbidden', message: 'You do not have access to this event' } }
    }));

    await act(async () => {
      await hook.result.current.submit(payloadFor(newCode()), 'camera');
    });

    expect(hook.result.current.result).toMatchObject({ verdict: 'reject', word: 'No access' });
    expect(Object.keys(queue)).toHaveLength(0);
  });

  it('falls back to the queue when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const hook = renderHook(() =>
      useGate({ eventId: EVENT, gate: 'Main Gate', online: true, onStats: vi.fn() })
    );

    await act(async () => {
      await hook.result.current.submit(payloadFor(newCode()), 'camera');
    });

    expect(hook.result.current.result).toMatchObject({ verdict: 'pending' });
    await waitFor(() => expect(Object.keys(queue)).toHaveLength(1));
  });
});

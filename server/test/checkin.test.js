import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, signedInOrganizer, createEvent, addAttendee, scanId } from './helpers.js';
import { buildQrPayload, generateTicketCode } from '../src/lib/tickets.js';

async function liveEventWithAttendee(attendee = {}) {
  const { agent, user } = await signedInOrganizer();
  const event = await createEvent(agent);
  const res = await addAttendee(agent, event.id, attendee);
  return { agent, user, event, ticket: res.body.ticket };
}

const scan = (agent, eventId, body) =>
  agent.post(`/api/events/${eventId}/checkin`).send({ gate: 'Main Gate', ...body });

describe('gate check-in', () => {
  it('checks in a valid ticket and moves the live headcount', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee({ name: 'Valid Visitor' });

    const before = await agent.get(`/api/events/${event.id}/stats`);
    expect(before.body.stats).toMatchObject({ registered: 1, checkedIn: 0, remaining: 1 });
    expect(before.body.stats.attendancePct).toBe(0);

    const res = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ ok: true, outcome: 'checked_in' });
    expect(res.body.result.attendeeName).toBe('Valid Visitor');
    expect(res.body.stats).toMatchObject({
      registered: 1,
      checkedIn: 1,
      remaining: 0,
      attendancePct: 100
    });
  });

  it('rejects the same ticket a second time and says where it was used', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId(), gate: 'Side Gate' });

    const again = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });

    expect(again.status).toBe(409);
    expect(again.body.result.outcome).toBe('duplicate');
    expect(again.body.result.ok).toBe(false);
    expect(again.body.result.firstCheckIn.gate).toBe('Side Gate');
    expect(new Date(again.body.result.firstCheckIn.at).getTime()).toBeGreaterThan(0);
    expect(again.body.stats.checkedIn).toBe(1);
  });

  it('rejects a forged signature, a malformed string and an unknown code', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();

    const [, , , sig] = ticket.qrPayload.split(':');
    const forged = `GG1:${event.id}:${generateTicketCode()}:${sig}`;
    const forgedRes = await scan(agent, event.id, { payload: forged, scanId: scanId() });
    expect(forgedRes.status).toBe(409);
    expect(forgedRes.body.result.outcome).toBe('invalid_signature');

    const junk = await scan(agent, event.id, { payload: 'definitely not a ticket', scanId: scanId() });
    expect(junk.body.result.outcome).toBe('malformed');

    // Correctly signed for this event, but no such ticket in the database.
    const orphan = buildQrPayload(event.id, generateTicketCode());
    const unknown = await scan(agent, event.id, { payload: orphan, scanId: scanId() });
    expect(unknown.body.result.outcome).toBe('unknown');

    expect((await agent.get(`/api/events/${event.id}/stats`)).body.stats.checkedIn).toBe(0);
  });

  it("rejects a ticket issued for a different event", async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();
    const other = await createEvent(agent, { name: 'Other Event' });

    const res = await scan(agent, other.id, { payload: ticket.qrPayload, scanId: scanId() });

    expect(res.status).toBe(409);
    expect(res.body.result.outcome).toBe('wrong_event');
    expect((await agent.get(`/api/events/${event.id}/stats`)).body.stats.checkedIn).toBe(0);
  });

  it('rejects a cancelled ticket', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();
    await agent.post(`/api/events/${event.id}/tickets/${ticket.id}/cancel`);

    const res = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    expect(res.body.result.outcome).toBe('cancelled');
  });

  it('accepts a code typed into the manual fallback', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();
    const res = await scan(agent, event.id, {
      payload: ticket.code,
      scanId: scanId(),
      entry: 'manual'
    });

    expect(res.body.result.outcome).toBe('checked_in');
    const scans = await agent.get(`/api/events/${event.id}/scans`);
    expect(scans.body.scans[0].entry).toBe('manual');
  });

  it('lets only one of two simultaneous scans claim the ticket', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();

    // Six parallel requests with distinct scan ids: the real two-operator race.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() })
      )
    );

    const outcomes = responses.map((res) => res.body.result.outcome);
    expect(outcomes.filter((outcome) => outcome === 'checked_in')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(5);
    expect((await agent.get(`/api/events/${event.id}/stats`)).body.stats.checkedIn).toBe(1);
  });

  it('replays the stored outcome when the same scanId is retried', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee();
    const id = scanId();

    const first = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: id });
    const retry = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: id });

    expect(first.body.result.outcome).toBe('checked_in');
    expect(retry.body.result.outcome).toBe('checked_in');
    expect(retry.body.result.replayed).toBe(true);
    expect((await agent.get(`/api/events/${event.id}/stats`)).body.stats.checkedIn).toBe(1);

    const scans = await agent.get(`/api/events/${event.id}/scans`);
    expect(scans.body.scans.filter((s) => s.scanId === id)).toHaveLength(1);
  });

  it('refuses to scan a draft event', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { status: 'draft' });
    const res = await addAttendee(agent, event.id);

    const scanRes = await scan(agent, event.id, {
      payload: res.body.ticket.qrPayload,
      scanId: scanId()
    });
    expect(scanRes.status).toBe(400);
    expect(scanRes.body.error.message).toMatch(/publish the event/i);
  });
});

describe('offline queue sync', () => {
  it('syncs a queue once, idempotently, and keeps the counts right', async () => {
    const { agent, event } = await liveEventWithAttendee({ email: 'a@test.dev' });
    const second = await addAttendee(agent, event.id, { email: 'b@test.dev' });
    const first = await agent.get(`/api/events/${event.id}/tickets`);
    const codes = first.body.tickets.map((t) => t.code);

    const queue = codes.map((code, i) => ({
      payload: buildQrPayload(event.id, code),
      scanId: `queued-${i}`,
      scannedAt: new Date(Date.now() - 60000).toISOString(),
      entry: 'camera'
    }));

    const sync = await agent
      .post(`/api/events/${event.id}/checkin/batch`)
      .send({ gate: 'Side Gate', scans: queue });

    expect(sync.status).toBe(200);
    expect(sync.body.results.map((r) => r.outcome)).toEqual(['checked_in', 'checked_in']);
    expect(sync.body.stats.checkedIn).toBe(2);

    // The device retries the same queue after a flaky response.
    const retry = await agent
      .post(`/api/events/${event.id}/checkin/batch`)
      .send({ gate: 'Side Gate', scans: queue });

    expect(retry.body.results.every((r) => r.outcome === 'checked_in')).toBe(true);
    expect(retry.body.results.every((r) => r.replayed)).toBe(true);
    expect(retry.body.stats.checkedIn).toBe(2);
    expect(second.status).toBe(201);
  });

  it('flags an offline scan of a ticket another gate already used', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee({ name: 'Contested Guest' });

    // Gate A was online and checked the ticket in.
    await scan(agent, event.id, {
      payload: ticket.qrPayload,
      scanId: scanId(),
      gate: 'Main Gate'
    });

    // Gate B was offline and queued the same ticket; it syncs afterwards.
    const sync = await agent.post(`/api/events/${event.id}/checkin/batch`).send({
      gate: 'Side Gate',
      scans: [
        {
          payload: ticket.qrPayload,
          scanId: 'offline-conflict-1',
          scannedAt: new Date().toISOString()
        }
      ]
    });

    expect(sync.body.results[0].outcome).toBe('conflict');
    expect(sync.body.results[0].firstCheckIn.gate).toBe('Main Gate');
    expect(sync.body.stats.checkedIn).toBe(1);
    expect(sync.body.stats.conflicts).toBe(1);

    const scans = await agent.get(`/api/events/${event.id}/scans?outcome=conflict`);
    expect(scans.body.scans).toHaveLength(1);
    expect(scans.body.scans[0].gate).toBe('Side Gate');
  });
});

describe('offline manifest', () => {
  it('ships code hashes and no attendee data', async () => {
    const { agent, event, ticket } = await liveEventWithAttendee({
      name: 'Manifest Person',
      email: 'manifest@test.dev'
    });

    const res = await agent.get(`/api/events/${event.id}/offline-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.manifest.count).toBe(1);
    expect(res.body.manifest.validHashes).toHaveLength(1);
    expect(res.body.manifest.validHashes[0]).toMatch(/^[a-f0-9]{16}$/);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('manifest@test.dev');
    expect(body).not.toContain('Manifest Person');
    expect(body).not.toContain(ticket.code);
  });
});

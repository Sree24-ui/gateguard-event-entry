import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, signedInOrganizer, createEvent, addAttendee, scanId } from './helpers.js';
import {
  buildRotatingPayload,
  parseScanInput,
  currentCounter,
  TOKEN_STEP_MS
} from '../src/lib/tickets.js';

const scan = (agent, eventId, body) =>
  agent.post(`/api/events/${eventId}/checkin`).send({ gate: 'Main Gate', ...body });

afterEach(() => vi.useRealTimers());

describe('rotating code format', () => {
  const EVENT = 'a'.repeat(24);
  const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

  it('accepts the current step and one step either side', () => {
    const now = currentCounter();
    for (const counter of [now - 1, now, now + 1]) {
      const parsed = parseScanInput(buildRotatingPayload(EVENT, CODE, counter));
      expect(parsed, `counter ${counter - now}`).toMatchObject({
        ok: true,
        code: CODE,
        rotating: true,
        counter
      });
    }
  });

  it('expires a code from outside the window', () => {
    const now = currentCounter();
    expect(parseScanInput(buildRotatingPayload(EVENT, CODE, now - 2))).toMatchObject({
      ok: false,
      reason: 'expired'
    });
    expect(parseScanInput(buildRotatingPayload(EVENT, CODE, now + 5))).toMatchObject({
      ok: false,
      reason: 'expired'
    });
  });

  it('refuses a code whose counter was edited to a live one', () => {
    const now = currentCounter();
    const [, eventId, code, , signature] = buildRotatingPayload(EVENT, CODE, now - 1).split(':');
    // Moving the counter forward puts it in the window but breaks the signature.
    const forged = `GG2:${eventId}:${code}:${now}:${signature}`;
    expect(parseScanInput(forged)).toMatchObject({ ok: false, reason: 'invalid_signature' });
  });

  it('still accepts the static code, so printed and offline tickets work', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id);

    expect(parseScanInput(body.ticket.qrPayload)).toMatchObject({ ok: true, rotating: false });
  });
});

describe('rotating codes at the gate', () => {
  it('admits a fresh code and refuses the same one twice', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id);

    const token = await request(app).get(`/api/public/tickets/${body.ticket.code}/token`);
    expect(token.status).toBe(200);
    expect(token.body.stepMs).toBe(TOKEN_STEP_MS);
    expect(token.body.payload.startsWith('GG2:')).toBe(true);

    const first = await scan(agent, event.id, { payload: token.body.payload, scanId: scanId() });
    expect(first.body.result.outcome).toBe('checked_in');

    // The person leaves and tries to come back in on the same screenshot.
    await scan(agent, event.id, {
      payload: token.body.payload,
      scanId: scanId(),
      direction: 'exit'
    });
    const replay = await scan(agent, event.id, {
      payload: token.body.payload,
      scanId: scanId()
    });
    expect(replay.status).toBe(409);
    expect(replay.body.result.outcome).toBe('replayed');
  });

  it('refuses an expired code at the gate', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { reEntry: true });
    const { body } = await addAttendee(agent, event.id);

    const stale = buildRotatingPayload(event.id, body.ticket.code, currentCounter() - 4);
    const res = await scan(agent, event.id, { payload: stale, scanId: scanId() });

    expect(res.status).toBe(409);
    expect(res.body.result.outcome).toBe('expired');
    expect(res.body.stats.checkedIn).toBe(0);
  });

  it('lets a later code through after an earlier one was used', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { reEntry: true });
    const { body } = await addAttendee(agent, event.id);
    const now = currentCounter();

    await scan(agent, event.id, {
      payload: buildRotatingPayload(event.id, body.ticket.code, now - 1),
      scanId: scanId()
    });
    await scan(agent, event.id, {
      payload: buildRotatingPayload(event.id, body.ticket.code, now),
      scanId: scanId(),
      direction: 'exit'
    });

    // A genuinely newer code is accepted.
    const back = await scan(agent, event.id, {
      payload: buildRotatingPayload(event.id, body.ticket.code, now + 1),
      scanId: scanId()
    });
    expect(back.body.result.outcome).toBe('re_entered');
  });

  it('needs a fresh code to scan the same person twice inside one step', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { reEntry: true });
    const { body } = await addAttendee(agent, event.id);
    const payload = buildRotatingPayload(event.id, body.ticket.code, currentCounter());

    await scan(agent, event.id, { payload, scanId: scanId() });

    // Single-use is the whole point, so an exit on the same code is refused.
    // The operator waits for the pass to refresh, or types the code by hand.
    const exit = await scan(agent, event.id, { payload, scanId: scanId(), direction: 'exit' });
    expect(exit.body.result.outcome).toBe('replayed');

    // The manual fallback is unaffected: a bare code carries no counter.
    const manual = await scan(agent, event.id, {
      payload: body.ticket.code,
      scanId: scanId(),
      entry: 'manual',
      direction: 'exit'
    });
    expect(manual.body.result.outcome).toBe('checked_out');
  });

  it('does not apply replay protection to a synced offline queue', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id);

    // A queued scan carries a code from whenever the gate was offline.
    const queued = buildRotatingPayload(event.id, body.ticket.code, currentCounter());
    const sync = await agent.post(`/api/events/${event.id}/checkin/batch`).send({
      gate: 'Main Gate',
      scans: [{ payload: queued, scanId: 'queued-rotating-1' }]
    });

    expect(sync.body.results[0].outcome).toBe('checked_in');
  });

  it('still scans a ticket issued before rotating codes existed', async () => {
    const { Ticket } = await import('../src/models/Ticket.js');
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id);

    // Simulate a document from before the field was added. Mongo will not
    // match { $lt: n } against a missing field.
    await Ticket.updateOne({ code: body.ticket.code }, { $unset: { lastTokenCounter: 1 } });

    const fresh = buildRotatingPayload(event.id, body.ticket.code, currentCounter());
    const res = await scan(agent, event.id, { payload: fresh, scanId: scanId() });

    expect(res.body.result.outcome).toBe('checked_in');
  });

  it('gives a code back to someone who left, when re-entry is on', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { reEntry: true });
    const { body } = await addAttendee(agent, event.id);
    const code = body.ticket.code;

    const token = await request(app).get(`/api/public/tickets/${code}/token`);
    await scan(agent, event.id, { payload: token.body.payload, scanId: scanId() });

    // Inside, so the pass should not hand out a code that cannot be used.
    expect((await request(app).get(`/api/public/tickets/${code}/token`)).status).toBe(400);

    await scan(agent, event.id, { payload: code, scanId: scanId(), direction: 'exit' });

    const after = await request(app).get(`/api/public/tickets/${code}/token`);
    expect(after.status).toBe(200);

    const pass = await request(app).get(`/api/public/tickets/${code}`);
    expect(pass.body.ticket.state).toBe('outside');
    expect(pass.body.ticket.event.reEntry).toBe(true);
  });

  it('refuses a token for a cancelled ticket', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id);
    await agent.post(`/api/events/${event.id}/tickets/${body.ticket.id}/cancel`);

    const token = await request(app).get(`/api/public/tickets/${body.ticket.code}/token`);
    expect(token.status).toBe(400);
  });
});

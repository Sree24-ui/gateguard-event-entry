import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, signedInOrganizer, createEvent, addAttendee } from './helpers.js';
import { parseScanInput, buildQrPayload, generateTicketCode } from '../src/lib/tickets.js';

describe('ticket issuing', () => {
  it('creates an event and issues a unique signed ticket per attendee', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);

    const a = await addAttendee(agent, event.id, { email: 'one@test.dev' });
    const b = await addAttendee(agent, event.id, { email: 'two@test.dev' });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.ticket.code).not.toBe(b.body.ticket.code);
    // 16 random bytes -> 22 base64url chars.
    expect(a.body.ticket.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.body.ticket.qrPayload.startsWith(`GG1:${event.id}:`)).toBe(true);
    expect(a.body.stats.registered).toBe(1);
    expect(b.body.stats.registered).toBe(2);
  });

  it('keeps attendee contact details out of the QR payload', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const res = await addAttendee(agent, event.id, {
      name: 'Private Person',
      email: 'private@test.dev',
      phone: '9876543210'
    });

    const payload = res.body.ticket.qrPayload;
    expect(payload).not.toContain('private@test.dev');
    expect(payload).not.toContain('Private Person');
    expect(payload).not.toContain('9876543210');
  });

  it('rejects a duplicate registration for the same email', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    await addAttendee(agent, event.id, { email: 'dup@test.dev' });
    const again = await addAttendee(agent, event.id, { email: 'dup@test.dev' });

    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already registered/i);
  });

  it('enforces capacity on the server', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { capacity: 1 });
    await addAttendee(agent, event.id, { email: 'first@test.dev' });
    const over = await addAttendee(agent, event.id, { email: 'second@test.dev' });

    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/capacity/i);
  });

  it('lets an attendee open their ticket with the code and nothing else', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id, { email: 'holder@test.dev' });

    const ok = await request(app).get(`/api/public/tickets/${body.ticket.code}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ticket.qrPayload).toBe(body.ticket.qrPayload);
    expect(ok.body.ticket.attendeeName).toBe('Test Attendee');
    // The public view must not expose the rest of the attendee record.
    expect(ok.body.ticket.attendee).toBeUndefined();

    const missing = await request(app).get('/api/public/tickets/AAAAAAAAAAAAAAAAAAAAAA');
    expect(missing.status).toBe(404);
  });

  it('invalidates the previous QR when a ticket is reissued', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id, { email: 'reissue@test.dev' });

    const reissued = await agent.post(`/api/events/${event.id}/tickets/${body.ticket.id}/reissue`);
    expect(reissued.status).toBe(200);
    expect(reissued.body.ticket.code).not.toBe(body.ticket.code);

    const old = await request(app).get(`/api/public/tickets/${body.ticket.code}`);
    expect(old.status).toBe(404);
  });
});

describe('payload signing', () => {
  it('accepts its own payload and refuses a tampered one', () => {
    const eventId = 'a'.repeat(24);
    const code = generateTicketCode();
    const payload = buildQrPayload(eventId, code);

    expect(parseScanInput(payload)).toMatchObject({ ok: true, code, eventId, signed: true });

    const [prefix, id, realCode, sig] = payload.split(':');
    expect(parseScanInput(`${prefix}:${id}:${generateTicketCode()}:${sig}`)).toMatchObject({
      ok: false,
      reason: 'invalid_signature'
    });
    expect(parseScanInput(`${prefix}:${'b'.repeat(24)}:${realCode}:${sig}`)).toMatchObject({
      ok: false,
      reason: 'invalid_signature'
    });
    expect(parseScanInput('https://example.com/not-a-ticket')).toMatchObject({
      ok: false,
      reason: 'malformed'
    });
    expect(parseScanInput('')).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('treats a bare code as manual entry', () => {
    const code = generateTicketCode();
    expect(parseScanInput(code)).toMatchObject({ ok: true, code, signed: false });
  });
});

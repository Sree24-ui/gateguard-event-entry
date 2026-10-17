import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  app,
  registerOrganizer,
  signedInOrganizer,
  createEvent,
  addAttendee,
  eventPayload,
  scanId
} from './helpers.js';

describe('authorization', () => {
  it('blocks unauthenticated access to every protected route', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);

    const routes = [
      ['get', '/api/auth/me'],
      ['get', '/api/events'],
      ['post', '/api/events'],
      ['get', `/api/events/${event.id}`],
      ['patch', `/api/events/${event.id}`],
      ['delete', `/api/events/${event.id}`],
      ['get', `/api/events/${event.id}/stats`],
      ['get', `/api/events/${event.id}/tickets`],
      ['post', `/api/events/${event.id}/tickets`],
      ['get', `/api/events/${event.id}/scans`],
      ['get', `/api/events/${event.id}/offline-manifest`],
      ['get', `/api/events/${event.id}/export/tickets.csv`],
      ['post', `/api/events/${event.id}/checkin`],
      ['post', `/api/events/${event.id}/checkin/batch`],
      ['get', '/api/operators'],
      ['get', '/api/audit']
    ];

    for (const [method, path] of routes) {
      const res = await request(app)[method](path).send({});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });

  it("refuses to show or scan another organizer's event", async () => {
    const owner = await signedInOrganizer();
    const event = await createEvent(owner.agent);
    const ticket = (await addAttendee(owner.agent, event.id)).body.ticket;

    const stranger = await signedInOrganizer();
    expect((await stranger.agent.get(`/api/events/${event.id}`)).status).toBe(403);
    expect((await stranger.agent.get(`/api/events/${event.id}/tickets`)).status).toBe(403);
    expect((await stranger.agent.get(`/api/events/${event.id}/offline-manifest`)).status).toBe(403);
    expect(
      (
        await stranger.agent
          .post(`/api/events/${event.id}/checkin`)
          .send({ payload: ticket.qrPayload, scanId: scanId() })
      ).status
    ).toBe(403);

    // The ticket is untouched.
    expect((await owner.agent.get(`/api/events/${event.id}/stats`)).body.stats.checkedIn).toBe(0);
  });

  it('only lets an operator work the events it was assigned', async () => {
    const { agent } = await signedInOrganizer();
    const assigned = await createEvent(agent);
    const other = await createEvent(agent, { name: 'Unassigned Event' });

    const created = await agent.post('/api/operators').send({
      name: 'Gate Person',
      email: 'operator-scope@test.dev',
      password: 'operator-pass-1',
      eventIds: [assigned.id]
    });
    expect(created.status).toBe(201);

    const operator = request.agent(app);
    await operator
      .post('/api/auth/login')
      .send({ email: 'operator-scope@test.dev', password: 'operator-pass-1' });

    expect((await operator.get(`/api/events/${assigned.id}`)).status).toBe(200);
    expect((await operator.get(`/api/events/${other.id}`)).status).toBe(403);

    // Operators scan; they do not create events, issue tickets or read audits.
    expect((await operator.post('/api/events').send(eventPayload())).status).toBe(403);
    expect(
      (await operator.post(`/api/events/${assigned.id}/tickets`).send({
        name: 'Sneaky',
        email: 'sneaky@test.dev'
      })).status
    ).toBe(403);
    expect((await operator.get('/api/operators')).status).toBe(403);
    expect((await operator.get('/api/audit')).status).toBe(403);
    expect((await operator.get(`/api/events/${assigned.id}/export/tickets.csv`)).status).toBe(403);
  });

  it('cannot self-register as an operator', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Would Be Operator',
      email: 'escalate@test.dev',
      password: 'escalate-pass-1',
      role: 'operator'
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('organizer');
  });

  it('clears the session on sign out', async () => {
    const { agent } = await signedInOrganizer();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a tampered session token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', ['gg_session=not.a.real.token']);
    expect(res.status).toBe(401);
  });
});

describe('cross-origin handling', () => {
  // Browsers attach Origin to every POST, same-origin ones included. Treating
  // that as a disallowed origin broke every write from the deployed app.
  it('accepts a same-origin write, where Origin matches Host', async () => {
    const { email } = await registerOrganizer();

    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', 'gateguard.example.com')
      .set('Origin', 'https://gateguard.example.com')
      .send({ email, password: 'super-secret-1' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it('refuses a foreign origin without CORS headers, and never with a 500', async () => {
    const { email } = await registerOrganizer();

    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', 'gateguard.example.com')
      .set('Origin', 'https://attacker.example.com')
      .send({ email, password: 'super-secret-1' });

    // The browser is what blocks the read, via the missing header.
    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a non-browser caller that sends no Origin', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});

describe('server-side validation', () => {
  it('rejects bad event input with field level detail', async () => {
    const { agent } = await signedInOrganizer();

    const short = await agent.post('/api/events').send(eventPayload({ name: 'ab' }));
    expect(short.status).toBe(400);
    expect(short.body.error.details.some((d) => d.field === 'name')).toBe(true);

    const backwards = await agent.post('/api/events').send(
      eventPayload({
        startsAt: new Date(Date.now() + 7200 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 3600 * 1000).toISOString()
      })
    );
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details.some((d) => d.field === 'endsAt')).toBe(true);

    const badStatus = await agent.post('/api/events').send(eventPayload({ status: 'whatever' }));
    expect(badStatus.status).toBe(400);
  });

  it('rejects bad attendee input and a malformed scan body', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);

    const badEmail = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Someone', email: 'not-an-email' });
    expect(badEmail.status).toBe(400);

    const noName = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: '', email: 'ok@test.dev' });
    expect(noName.status).toBe(400);

    const noScanId = await agent
      .post(`/api/events/${event.id}/checkin`)
      .send({ payload: 'something' });
    expect(noScanId.status).toBe(400);

    const emptyBatch = await agent
      .post(`/api/events/${event.id}/checkin/batch`)
      .send({ scans: [] });
    expect(emptyBatch.status).toBe(400);
  });

  it('does not treat a regex as a search operator', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    await addAttendee(agent, event.id, { name: 'Normal Name', email: 'normal@test.dev' });

    const res = await agent.get(`/api/events/${event.id}/tickets?q=${encodeURIComponent('.*')}`);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(0);
  });

  it('returns 404 for an unknown route and never leaks a stack trace', async () => {
    const res = await request(app).get('/api/not-a-real-route');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at \/|node_modules/);
  });

  it('answers the health check without a session', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'gateguard-api' });
    expect(res.body.database).toBe('connected');
  });
});

describe('public registration', () => {
  it('registers an attendee and hands back a ticket, but not for a draft event', async () => {
    const { agent } = await signedInOrganizer();
    const live = await createEvent(agent);
    const draft = await createEvent(agent, { name: 'Hidden Draft', status: 'draft' });

    const ok = await request(app)
      .post(`/api/public/events/${live.id}/register`)
      .send({ name: 'Public Person', email: 'public@test.dev' });
    expect(ok.status).toBe(201);
    expect(ok.body.ticket.qrPayload).toContain(`GG1:${live.id}:`);

    expect((await request(app).get(`/api/public/events/${draft.id}`)).status).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/public/events/${draft.id}/register`)
          .send({ name: 'Nope', email: 'nope@test.dev' })
      ).status
    ).toBe(404);
  });

  it('honours the invite-only switch', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { publicRegistration: false });

    const res = await request(app)
      .post(`/api/public/events/${event.id}/register`)
      .send({ name: 'Uninvited', email: 'uninvited@test.dev' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/invite only/i);
  });
});

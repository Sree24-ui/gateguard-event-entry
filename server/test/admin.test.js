import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, signedInOrganizer, createEvent, eventPayload } from './helpers.js';
import { User } from '../src/models/User.js';

/** An organiser whose email is not on an institutional domain. */
async function pendingOrganizer() {
  const email = `outsider-${Math.random().toString(36).slice(2, 9)}@gmail.com`;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name: 'Outside Host', email, password: 'outsider-pass-1' });
  if (res.status !== 201) throw new Error(`register failed: ${res.text}`);
  return { agent, email, user: res.body.user };
}

async function signedInAdmin() {
  const email = `admin-${Math.random().toString(36).slice(2, 9)}@test.dev`;
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name: 'Admin', email, password: 'admin-pass-1' });
  await User.updateOne({ email }, { $set: { role: 'admin', status: 'approved' } });
  await agent.post('/api/auth/login').send({ email, password: 'admin-pass-1' });
  return { agent, email };
}

describe('organiser approval', () => {
  it('leaves a signup from an unknown domain pending, and says so', async () => {
    const { user } = await pendingOrganizer();
    expect(user.role).toBe('organizer');
    expect(user.status).toBe('pending');
  });

  it('approves a signup from an institutional domain on sight', async () => {
    const { user } = await signedInOrganizer();
    expect(user.status).toBe('approved');
  });

  it('lets a pending organiser build privately but not publish', async () => {
    const { agent } = await pendingOrganizer();

    const draft = await agent.post('/api/events').send(eventPayload({ status: 'draft' }));
    expect(draft.status).toBe(201);

    // The private workflow still works end to end.
    const ticket = await agent
      .post(`/api/events/${draft.body.event.id}/tickets`)
      .send({ name: 'Private Guest', email: 'private@test.dev' });
    expect(ticket.status).toBe(201);

    const published = await agent.post('/api/events').send(eventPayload({ status: 'live' }));
    expect(published.status).toBe(403);
    expect(published.body.error.message).toMatch(/awaiting approval/i);

    const promoted = await agent
      .patch(`/api/events/${draft.body.event.id}`)
      .send({ status: 'published' });
    expect(promoted.status).toBe(403);
  });

  it('opens publishing the moment an administrator approves', async () => {
    const { agent, user } = await pendingOrganizer();
    const { agent: admin } = await signedInAdmin();

    const queue = await admin.get('/api/admin/users?status=pending');
    expect(queue.body.users.some((u) => u.id === user.id)).toBe(true);

    const approved = await admin.post(`/api/admin/users/${user.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.user.status).toBe('approved');

    const published = await agent.post('/api/events').send(eventPayload({ status: 'live' }));
    expect(published.status).toBe(201);
  });
});

describe('suspension', () => {
  it('ends the session, hides the public pages and keeps the record', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { status: 'live' });
    const me = await agent.get('/api/auth/me');

    // The event is publicly visible first.
    expect((await request(app).get(`/api/public/events/${event.id}`)).status).toBe(200);

    const { agent: admin } = await signedInAdmin();
    const suspended = await admin
      .post(`/api/admin/users/${me.body.user.id}/suspend`)
      .send({ reason: 'Selling tickets to an event that does not exist' });

    expect(suspended.status).toBe(200);
    expect(suspended.body.eventsUnpublished).toBe(1);

    // Their session is dead and the public page is gone.
    expect((await agent.get('/api/events')).status).toBe(403);
    expect((await request(app).get(`/api/public/events/${event.id}`)).status).toBe(404);

    const trail = await admin.get('/api/audit');
    expect(JSON.stringify(trail.body)).toMatch(/Selling tickets/);
  });

  it('reinstating restores access but not publication', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { status: 'live' });
    const me = await agent.get('/api/auth/me');
    const { agent: admin } = await signedInAdmin();

    await admin.post(`/api/admin/users/${me.body.user.id}/suspend`).send({ reason: 'Under review' });
    await admin.post(`/api/admin/users/${me.body.user.id}/reinstate`);

    expect((await agent.get('/api/events')).status).toBe(200);
    // Still a draft: reinstating someone is not republishing their events.
    expect((await request(app).get(`/api/public/events/${event.id}`)).status).toBe(404);
  });

  it('will not let an administrator suspend themselves', async () => {
    const { agent, email } = await signedInAdmin();
    const me = await User.findOne({ email });

    const res = await agent.post(`/api/admin/users/${me._id}/suspend`).send({ reason: 'Oops' });
    expect(res.status).toBe(400);
  });
});

describe('moderation', () => {
  it('unpublishes an event with a recorded reason', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { status: 'live', name: 'Dubious Fest' });
    const { agent: admin } = await signedInAdmin();

    const listed = await admin.get('/api/admin/events');
    expect(listed.body.events.some((e) => e.id === event.id)).toBe(true);

    const res = await admin
      .post(`/api/admin/events/${event.id}/unpublish`)
      .send({ reason: 'Impersonating another club' });

    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('draft');
    expect((await request(app).get(`/api/public/events/${event.id}`)).status).toBe(404);
  });

  it('requires a reason, so the audit trail is never empty', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { status: 'live' });
    const { agent: admin } = await signedInAdmin();

    expect(
      (await admin.post(`/api/admin/events/${event.id}/unpublish`).send({ reason: '' })).status
    ).toBe(400);
  });
});

describe('admin is not self-service', () => {
  it('refuses the admin area to organisers, operators and anonymous callers', async () => {
    expect((await request(app).get('/api/admin/users')).status).toBe(401);

    const { agent } = await signedInOrganizer();
    expect((await agent.get('/api/admin/users')).status).toBe(403);
    expect((await agent.get('/api/admin/events')).status).toBe(403);
    expect((await agent.post('/api/admin/users/x/approve')).status).toBe(403);
  });

  it('cannot be obtained by asking for it at signup', async () => {
    const email = `wannabe-${Math.random().toString(36).slice(2, 9)}@test.dev`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Wannabe', email, password: 'wannabe-pass-1', role: 'admin', status: 'approved' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('organizer');
  });
});

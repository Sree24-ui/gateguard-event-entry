import request from 'supertest';
import { createApp } from '../src/app.js';

export const app = createApp();

export async function registerOrganizer(overrides = {}) {
  const email = overrides.email || `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test Organizer', email, password: 'super-secret-1', ...overrides });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { agent: request.agent(app), cookie: res.headers['set-cookie'], user: res.body.user, email };
}

/** Returns a supertest agent that carries the session cookie. */
export async function signedInOrganizer(overrides = {}) {
  const { email } = await registerOrganizer(overrides);
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password: overrides.password || 'super-secret-1' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
  return { agent, user: res.body.user, email };
}

export function eventPayload(overrides = {}) {
  const start = new Date(Date.now() + 3600 * 1000);
  return {
    name: 'Test Fest 2026',
    description: 'A test event',
    venue: 'Main Hall',
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 4 * 3600 * 1000).toISOString(),
    capacity: 100,
    status: 'live',
    gates: ['Main Gate', 'Side Gate'],
    publicRegistration: true,
    ...overrides
  };
}

export async function createEvent(agent, overrides = {}) {
  const res = await agent.post('/api/events').send(eventPayload(overrides));
  if (res.status !== 201) throw new Error(`createEvent failed: ${res.status} ${res.text}`);
  return res.body.event;
}

export async function addAttendee(agent, eventId, attendee = {}) {
  const res = await agent
    .post(`/api/events/${eventId}/tickets`)
    .send({
      name: attendee.name || 'Test Attendee',
      email: attendee.email || `att-${Math.random().toString(36).slice(2, 10)}@test.dev`,
      phone: attendee.phone || '',
      collegeId: attendee.collegeId || ''
    });
  return res;
}

export const scanId = () => `scan-${Math.random().toString(36).slice(2)}-${Date.now()}`;

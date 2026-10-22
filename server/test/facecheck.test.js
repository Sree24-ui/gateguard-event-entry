import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, signedInOrganizer, createEvent, addAttendee, scanId } from './helpers.js';

const PHOTO =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const scan = (agent, eventId, body) =>
  agent.post(`/api/events/${eventId}/checkin`).send({ gate: 'Main Gate', ...body });

describe('face check', () => {
  it('holds the ticket for review instead of admitting, then admits on confirm', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { faceCheck: true });
    const { body } = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Photo Person', email: 'photo@test.dev', photo: PHOTO });

    const review = await scan(agent, event.id, {
      payload: body.ticket.qrPayload,
      scanId: scanId()
    });

    // A review is a pending step, not a refusal.
    expect(review.status).toBe(200);
    expect(review.body.result.outcome).toBe('face_review');
    expect(review.body.result.photo).toBe(PHOTO);
    // Crucially the ticket is NOT consumed yet.
    expect(review.body.stats.checkedIn).toBe(0);

    const admit = await scan(agent, event.id, {
      payload: body.ticket.qrPayload,
      scanId: scanId(),
      faceConfirmed: true
    });

    expect(admit.body.result.outcome).toBe('checked_in');
    expect(admit.body.stats.checkedIn).toBe(1);
  });

  it('leaves the ticket usable when the operator says it is not them', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { faceCheck: true });
    const { body } = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Impostor Target', email: 'target@test.dev', photo: PHOTO });

    const rejected = await agent
      .post(`/api/events/${event.id}/checkin/face-reject`)
      .send({ code: body.ticket.code, scanId: scanId(), gate: 'Main Gate' });

    expect(rejected.status).toBe(200);
    expect(rejected.body.result.outcome).toBe('face_rejected');
    expect(rejected.body.stats.checkedIn).toBe(0);

    const scans = await agent.get(`/api/events/${event.id}/scans?outcome=face_rejected`);
    expect(scans.body.scans).toHaveLength(1);

    // The real attendee can still be admitted afterwards.
    const admit = await scan(agent, event.id, {
      payload: body.ticket.qrPayload,
      scanId: scanId(),
      faceConfirmed: true
    });
    expect(admit.body.result.outcome).toBe('checked_in');
  });

  it('admits normally when the event wants a face check but no photo exists', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { faceCheck: true });
    const res = await addAttendee(agent, event.id, { email: 'nophoto@test.dev' });

    const admit = await scan(agent, event.id, {
      payload: res.body.ticket.qrPayload,
      scanId: scanId()
    });

    expect(admit.body.result.outcome).toBe('checked_in');
  });

  it('never returns the photo from the attendee list', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { faceCheck: true });
    await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Photo Person', email: 'photo@test.dev', photo: PHOTO });

    const list = await agent.get(`/api/events/${event.id}/tickets`);
    expect(JSON.stringify(list.body)).not.toContain('base64');
    expect(list.body.tickets[0].hasPhoto).toBe(true);
  });

  it('rejects a photo that is not an image or is oversized', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);

    const notAnImage = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Bad', email: 'bad@test.dev', photo: 'data:text/html;base64,PHNjcmlwdD4=' });
    expect(notAnImage.status).toBe(400);

    const huge = await agent.post(`/api/events/${event.id}/tickets`).send({
      name: 'Huge',
      email: 'huge@test.dev',
      photo: `data:image/jpeg;base64,${'A'.repeat(400_001)}`
    });
    expect(huge.status).toBe(400);
  });
});

describe('face check and the offline queue', () => {
  it('admits a queued scan but leaves it marked unverified', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { faceCheck: true });
    const { body } = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Queued Person', email: 'queued@test.dev', photo: PHOTO });

    const sync = await agent.post(`/api/events/${event.id}/checkin/batch`).send({
      gate: 'Main Gate',
      scans: [{ payload: body.ticket.qrPayload, scanId: 'offline-face-1' }]
    });

    // Refusing entry because the wifi dropped would be worse, so it admits —
    // but it must not claim the face was checked.
    expect(sync.body.results[0].outcome).toBe('checked_in');
    const list = await agent.get(`/api/events/${event.id}/tickets`);
    expect(list.body.tickets[0].faceCheckedAt).toBeNull();

    const scans = await agent.get(`/api/events/${event.id}/scans`);
    expect(scans.body.scans[0].mode).toBe('offline_sync');
  });

  it('records faceCheckedAt when the operator did confirm', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, { faceCheck: true });
    const { body } = await agent
      .post(`/api/events/${event.id}/tickets`)
      .send({ name: 'Verified Person', email: 'verified@test.dev', photo: PHOTO });

    await scan(agent, event.id, {
      payload: body.ticket.qrPayload,
      scanId: scanId(),
      faceConfirmed: true
    });

    const list = await agent.get(`/api/events/${event.id}/tickets`);
    expect(list.body.tickets[0].faceCheckedAt).not.toBeNull();
  });
});

describe('fixes', () => {
  it('leaves untouched fields alone on a partial update', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent, {
      status: 'live',
      gates: ['Main Gate', 'Side Gate', 'VIP Entry'],
      capacity: 300,
      publicRegistration: true,
      faceCheck: true
    });

    // Changing one field must not reset every field that has a default.
    const patched = await agent.patch(`/api/events/${event.id}`).send({ capacity: 400 });

    expect(patched.status).toBe(200);
    expect(patched.body.event).toMatchObject({
      capacity: 400,
      status: 'live',
      gates: ['Main Gate', 'Side Gate', 'VIP Entry'],
      publicRegistration: true,
      faceCheck: true
    });
    expect(patched.body.event.name).toBe(event.name);
  });

  it('refuses to reissue a ticket that is already checked in', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id, { email: 'inside@test.dev' });
    await scan(agent, event.id, { payload: body.ticket.qrPayload, scanId: scanId() });

    const reissue = await agent.post(`/api/events/${event.id}/tickets/${body.ticket.id}/reissue`);

    expect(reissue.status).toBe(400);
    expect(reissue.body.error.message).toMatch(/already checked in/i);
    // The headcount is untouched.
    expect((await agent.get(`/api/events/${event.id}/stats`)).body.stats.checkedIn).toBe(1);
  });

  it('refuses a scan timestamp from the future or the distant past', async () => {
    const { agent } = await signedInOrganizer();
    const event = await createEvent(agent);
    const { body } = await addAttendee(agent, event.id);

    for (const offset of [36 * 3600 * 1000, -8 * 24 * 3600 * 1000]) {
      const res = await scan(agent, event.id, {
        payload: body.ticket.qrPayload,
        scanId: scanId(),
        scannedAt: new Date(Date.now() + offset).toISOString()
      });
      expect(res.status).toBe(400);
    }

    // A plausible offline backlog is still accepted.
    const ok = await scan(agent, event.id, {
      payload: body.ticket.qrPayload,
      scanId: scanId(),
      scannedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    });
    expect(ok.body.result.outcome).toBe('checked_in');
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, signedInOrganizer, createEvent, addAttendee } from './helpers.js';
import { User } from '../src/models/User.js';

const EMAIL = 'attendee@demo.college.edu';

async function signedInAttendee(email = EMAIL) {
  const agent = request.agent(app);
  const asked = await agent.post('/api/attendee/otp/request').send({ email });
  const verified = await agent
    .post('/api/attendee/otp/verify')
    .send({ email, code: asked.body.devCode });
  if (verified.status !== 200) throw new Error(`otp verify failed: ${verified.text}`);
  return { agent, user: verified.body.user };
}

describe('attendee sign-in', () => {
  it('creates an attendee on first code request and signs them in', async () => {
    const agent = request.agent(app);
    const asked = await agent.post('/api/attendee/otp/request').send({ email: EMAIL });

    expect(asked.status).toBe(200);
    expect(asked.body.devCode).toMatch(/^\d{6}$/);

    const verified = await agent
      .post('/api/attendee/otp/verify')
      .send({ email: EMAIL, code: asked.body.devCode });

    expect(verified.status).toBe(200);
    expect(verified.body.user).toMatchObject({ email: EMAIL, role: 'attendee' });
    // No password was ever set, and none is needed.
    expect((await agent.get('/api/auth/me')).body.user.role).toBe('attendee');
  });

  it('never stores the code in readable form', async () => {
    const agent = request.agent(app);
    const asked = await agent.post('/api/attendee/otp/request').send({ email: EMAIL });

    const stored = await User.findOne({ email: EMAIL }).select('+otpHash');
    expect(stored.otpHash).not.toBe(asked.body.devCode);
    expect(stored.otpHash.startsWith('$2')).toBe(true);
  });

  it('refuses a wrong code, and burns the right one after a single use', async () => {
    const agent = request.agent(app);
    const asked = await agent.post('/api/attendee/otp/request').send({ email: EMAIL });

    const wrong = await agent.post('/api/attendee/otp/verify').send({ email: EMAIL, code: '000000' });
    expect(wrong.status).toBe(401);

    const right = await agent
      .post('/api/attendee/otp/verify')
      .send({ email: EMAIL, code: asked.body.devCode });
    expect(right.status).toBe(200);

    const replay = await agent
      .post('/api/attendee/otp/verify')
      .send({ email: EMAIL, code: asked.body.devCode });
    expect(replay.status).toBe(401);
  });

  it('refuses an expired code', async () => {
    const agent = request.agent(app);
    const asked = await agent.post('/api/attendee/otp/request').send({ email: EMAIL });
    await User.updateOne({ email: EMAIL }, { $set: { otpExpiresAt: new Date(Date.now() - 1000) } });

    const res = await agent
      .post('/api/attendee/otp/verify')
      .send({ email: EMAIL, code: asked.body.devCode });
    expect(res.status).toBe(401);
  });

  it('stops guessing after five wrong attempts, even with the right code', async () => {
    const agent = request.agent(app);
    const asked = await agent.post('/api/attendee/otp/request').send({ email: EMAIL });

    for (let i = 0; i < 5; i += 1) {
      await agent.post('/api/attendee/otp/verify').send({ email: EMAIL, code: '111111' });
    }

    const res = await agent
      .post('/api/attendee/otp/verify')
      .send({ email: EMAIL, code: asked.body.devCode });
    expect(res.status).toBe(401);
  });
});

describe('my tickets', () => {
  it('returns this attendee’s tickets across every event, and nobody else’s', async () => {
    const { agent: organizer } = await signedInOrganizer();
    const first = await createEvent(organizer, { name: 'Fest One' });
    const second = await createEvent(organizer, { name: 'Fest Two' });
    await addAttendee(organizer, first.id, { email: EMAIL, name: 'Mine One' });
    await addAttendee(organizer, second.id, { email: EMAIL, name: 'Mine Two' });
    await addAttendee(organizer, first.id, { email: 'someone.else@demo.edu', name: 'Not Mine' });

    const { agent } = await signedInAttendee();
    const res = await agent.get('/api/attendee/tickets');

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.tickets.map((t) => t.event.name).sort()).toEqual(['Fest One', 'Fest Two']);
    expect(JSON.stringify(res.body)).not.toContain('someone.else@demo.edu');
    expect(res.body.tickets[0].qrPayload.startsWith('GG1:')).toBe(true);
  });

  it('is closed to anonymous callers and to staff accounts', async () => {
    expect((await request(app).get('/api/attendee/tickets')).status).toBe(401);
    const { agent: organizer } = await signedInOrganizer();
    expect((await organizer.get('/api/attendee/tickets')).status).toBe(403);
  });
});

describe('passkeys', () => {
  it('offers registration options that demand the device verify the person', async () => {
    const { agent } = await signedInAttendee();
    const res = await agent.post('/api/attendee/passkey/register/options');

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeTruthy();
    expect(res.body.rp.id).toBe('localhost');
    expect(res.body.authenticatorSelection.userVerification).toBe('required');

    // The challenge is kept server-side and never exposed again.
    const stored = await User.findOne({ email: EMAIL }).select('+currentChallenge');
    expect(stored.currentChallenge).toBe(res.body.challenge);
    expect((await agent.get('/api/auth/me')).body.user.currentChallenge).toBeUndefined();
  });

  it('refuses a registration that does not match the stored challenge', async () => {
    const { agent } = await signedInAttendee();
    await agent.post('/api/attendee/passkey/register/options');

    const res = await agent
      .post('/api/attendee/passkey/register/verify')
      .send({ id: 'fake', rawId: 'fake', type: 'public-key', response: {} });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const stored = await User.findOne({ email: EMAIL });
    expect(stored.passkeys).toHaveLength(0);
  });

  it('will not start a passkey sign-in for an email with no passkey', async () => {
    await signedInAttendee();
    const res = await request(app)
      .post('/api/attendee/passkey/login/options')
      .send({ email: EMAIL });

    expect(res.status).toBe(404);
  });

  it('reports whether the account has a passkey, without exposing key material', async () => {
    const { agent } = await signedInAttendee();
    const before = await agent.get('/api/auth/me');
    expect(before.body.user.hasPasskey).toBe(false);

    await User.updateOne(
      { email: EMAIL },
      {
        $push: {
          passkeys: { credentialId: 'abc', publicKey: 'ZGVmZw', counter: 0, label: 'Test' }
        }
      }
    );

    const after = await agent.get('/api/auth/me');
    expect(after.body.user.hasPasskey).toBe(true);
    expect(JSON.stringify(after.body)).not.toContain('ZGVmZw');
  });
});

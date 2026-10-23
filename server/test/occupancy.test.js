import { describe, it, expect } from 'vitest';
import { app, signedInOrganizer, createEvent, addAttendee, scanId } from './helpers.js';

const scan = (agent, eventId, body) =>
  agent.post(`/api/events/${eventId}/checkin`).send({ gate: 'Main Gate', ...body });

async function eventWithTicket(overrides = {}) {
  const { agent } = await signedInOrganizer();
  const event = await createEvent(agent, overrides);
  const { body } = await addAttendee(agent, event.id);
  return { agent, event, ticket: body.ticket };
}

describe('entry and exit', () => {
  it('moves a ticket inside, then outside, and tracks occupancy', async () => {
    const { agent, event, ticket } = await eventWithTicket({ occupancyLimit: 10 });

    const entry = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    expect(entry.body.result.outcome).toBe('checked_in');
    expect(entry.body.stats.inside).toBe(1);
    expect(entry.body.stats.occupancyLimit).toBe(10);
    expect(entry.body.stats.occupancyPct).toBe(10);

    const exit = await scan(agent, event.id, {
      payload: ticket.qrPayload,
      scanId: scanId(),
      direction: 'exit'
    });
    expect(exit.body.result.outcome).toBe('checked_out');
    expect(exit.body.stats.inside).toBe(0);
    expect(exit.body.stats.exited).toBe(1);
    // Attendance is cumulative; occupancy is not.
    expect(exit.body.stats.checkedIn).toBe(1);
  });

  it('refuses an exit for someone never recorded inside, and a second exit', async () => {
    const { agent, event, ticket } = await eventWithTicket();

    const early = await scan(agent, event.id, {
      payload: ticket.qrPayload,
      scanId: scanId(),
      direction: 'exit'
    });
    expect(early.status).toBe(409);
    expect(early.body.result.outcome).toBe('invalid_exit');
    expect(early.body.stats.inside).toBe(0);

    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId(), direction: 'exit' });

    const twice = await scan(agent, event.id, {
      payload: ticket.qrPayload,
      scanId: scanId(),
      direction: 'exit'
    });
    expect(twice.body.result.outcome).toBe('invalid_exit');
    expect(twice.body.stats.inside).toBe(0);
  });

  it('refuses re-entry when the organizer has it off', async () => {
    const { agent, event, ticket } = await eventWithTicket({ reEntry: false });

    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId(), direction: 'exit' });

    const back = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    expect(back.status).toBe(409);
    expect(back.body.result.outcome).toBe('duplicate');
    expect(back.body.result.why).toMatch(/re-entry is off/i);
    expect(back.body.stats.inside).toBe(0);
  });

  it('allows re-entry when the organizer has it on, without double counting attendance', async () => {
    const { agent, event, ticket } = await eventWithTicket({ reEntry: true });

    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId(), direction: 'exit' });

    const back = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    expect(back.status).toBe(200);
    expect(back.body.result.outcome).toBe('re_entered');
    expect(back.body.result.entryCount).toBe(2);
    expect(back.body.stats.inside).toBe(1);
    // One person attended, however many times they stepped out.
    expect(back.body.stats.checkedIn).toBe(1);
  });

  it('refuses a second entry while already inside', async () => {
    const { agent, event, ticket } = await eventWithTicket({ reEntry: true });

    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    const again = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });

    expect(again.body.result.outcome).toBe('duplicate');
    expect(again.body.stats.inside).toBe(1);
  });

  it('lets only one of several simultaneous exits succeed', async () => {
    const { agent, event, ticket } = await eventWithTicket();
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        scan(agent, event.id, {
          payload: ticket.qrPayload,
          scanId: scanId(),
          direction: 'exit'
        })
      )
    );

    const outcomes = responses.map((res) => res.body.result.outcome);
    expect(outcomes.filter((o) => o === 'checked_out')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'invalid_exit')).toHaveLength(4);

    const stats = await agent.get(`/api/events/${event.id}/stats`);
    expect(stats.body.stats.inside).toBe(0);
    expect(stats.body.stats.exited).toBe(1);
  });

  it('falls back to capacity when no occupancy limit is set, and reports whether exits were seen', async () => {
    const { agent, event, ticket } = await eventWithTicket({ capacity: 4, occupancyLimit: 0 });

    const entry = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    expect(entry.body.stats.occupancyLimit).toBe(4);
    expect(entry.body.stats.occupancyPct).toBe(25);
    // No exit has been scanned, so the occupancy figure is unverified.
    expect(entry.body.stats.exitsRecorded).toBe(false);

    const exit = await scan(agent, event.id, {
      payload: ticket.qrPayload,
      scanId: scanId(),
      direction: 'exit'
    });
    expect(exit.body.stats.exitsRecorded).toBe(true);
  });

  it('still reports that exits are being scanned after everyone re-enters', async () => {
    const { agent, event, ticket } = await eventWithTicket({ reEntry: true, occupancyLimit: 5 });

    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId(), direction: 'exit' });
    const back = await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });

    // Nobody is currently outside, but this gate clearly does scan exits, so
    // the occupancy figure must not be labelled unverified.
    expect(back.body.stats.exited).toBe(0);
    expect(back.body.stats.exitsRecorded).toBe(true);
  });

  it('records the direction on every scan', async () => {
    const { agent, event, ticket } = await eventWithTicket();
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId() });
    await scan(agent, event.id, { payload: ticket.qrPayload, scanId: scanId(), direction: 'exit' });

    const scans = await agent.get(`/api/events/${event.id}/scans`);
    expect(scans.body.scans.map((s) => s.direction)).toEqual(['exit', 'entry']);
  });
});

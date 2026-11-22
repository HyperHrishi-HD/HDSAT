// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearOutbox, flushOutbox, queueAttempt, queuedCount, type QueuedAttempt } from './outbox';

function entry(n: number): QueuedAttempt {
  return {
    eventId: `evt-${n}`,
    questionId: `Q-${n}`,
    response: 'A',
    mode: 'practice',
    timeSpentSeconds: 30,
    sessionId: null,
    queuedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('offline outbox', () => {
  it('queues each attempt once and reports the backlog', () => {
    expect(queueAttempt(entry(1))).toBe(1);
    expect(queueAttempt(entry(1))).toBe(1);
    expect(queueAttempt(entry(2))).toBe(2);
    expect(queuedCount()).toBe(2);
  });

  it('drops entries the server accepted', async () => {
    queueAttempt(entry(1));
    queueAttempt(entry(2));
    const result = await flushOutbox(async () => {});
    expect(result).toEqual({ sent: 2, remaining: 0 });
    expect(queuedCount()).toBe(0);
  });

  it('keeps the backlog when the network is still down', async () => {
    queueAttempt(entry(1));
    queueAttempt(entry(2));
    const result = await flushOutbox(async () => {
      throw new Error('offline');
    });
    expect(result).toEqual({ sent: 0, remaining: 2 });
    expect(queuedCount()).toBe(2);
  });

  it('drops an entry the server cannot accept permanently', async () => {
    queueAttempt(entry(1));
    const result = await flushOutbox(
      async () => {
        throw new Error('unknown question');
      },
      () => true
    );
    expect(result).toEqual({ sent: 0, remaining: 0 });
  });

  it('can be cleared', () => {
    queueAttempt(entry(1));
    expect(clearOutbox()).toBe(0);
    expect(queuedCount()).toBe(0);
  });
});

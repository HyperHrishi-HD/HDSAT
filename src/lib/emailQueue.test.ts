// @vitest-environment jsdom
/**
 * The mail ceiling parks a request instead of refusing it. These tests pin the
 * two things that make that honest: the queue is keyed by address and kind (so
 * one address never holds two slots), and a parked request is attempted once per
 * UTC day — the same day boundary Postgres counts the budget on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_QUEUE_KEY,
  EMAIL_QUEUE_MAX,
  EMAIL_QUEUE_PER_OPEN,
  EMAIL_QUEUE_TTL_MS,
  dueQueuedEmails,
  loadEmailQueue,
  markQueuedAttempt,
  queueEmail,
  removeQueuedEmail,
  utcDay,
} from './emailQueue';

const NOON = Date.UTC(2026, 9, 25, 12, 0, 0);

beforeEach(() => {
  window.localStorage.clear();
});

describe('deferred email queue', () => {
  it('parks a request and reports it back', () => {
    queueEmail('student@example.com', 'confirm', NOON);
    const queue = loadEmailQueue(NOON);
    expect(queue).toHaveLength(1);
    expect(queue[0].email).toBe('student@example.com');
    expect(queue[0].kind).toBe('confirm');
    expect(queue[0].queuedAt).toBe(NOON);
  });

  it('keeps one slot per address and kind, and the original request time', () => {
    queueEmail('student@example.com', 'confirm', NOON);
    queueEmail('Student@Example.com', 'confirm', NOON + 60_000);
    queueEmail('student@example.com', 'reset', NOON + 120_000);
    const queue = loadEmailQueue(NOON + 120_000);
    expect(queue).toHaveLength(2);
    const confirm = queue.find((entry) => entry.kind === 'confirm')!;
    // The 24-hour code window started at the first request, so that timestamp
    // is what has to survive a re-request.
    expect(confirm.queuedAt).toBe(NOON);
    expect(confirm.email).toBe('Student@Example.com');
  });

  it('is due at once, then not again until the UTC day turns over', () => {
    queueEmail('student@example.com', 'confirm', NOON);
    expect(dueQueuedEmails(loadEmailQueue(NOON), NOON)).toHaveLength(1);

    markQueuedAttempt('student@example.com', 'confirm', NOON);
    expect(dueQueuedEmails(loadEmailQueue(NOON), NOON)).toHaveLength(0);
    // 23:59 UTC is still the same accounting day.
    const lateSameDay = Date.UTC(2026, 9, 25, 23, 59, 0);
    expect(utcDay(lateSameDay)).toBe(utcDay(NOON));
    expect(dueQueuedEmails(loadEmailQueue(lateSameDay), lateSameDay)).toHaveLength(0);
    // One minute later the budget has reset and the request may go.
    const nextDay = Date.UTC(2026, 9, 26, 0, 1, 0);
    expect(dueQueuedEmails(loadEmailQueue(nextDay), nextDay)).toHaveLength(1);
  });

  it('forgets a request older than its window', () => {
    queueEmail('student@example.com', 'confirm', NOON);
    const later = NOON + EMAIL_QUEUE_TTL_MS + 1;
    expect(loadEmailQueue(later)).toHaveLength(0);
  });

  it('drops by address and kind, leaving the other kind alone', () => {
    queueEmail('student@example.com', 'confirm', NOON);
    queueEmail('student@example.com', 'reset', NOON);
    removeQueuedEmail('student@example.com', 'confirm', NOON);
    const queue = loadEmailQueue(NOON);
    expect(queue.map((entry) => entry.kind)).toEqual(['reset']);
  });

  it('never grows past its cap, and keeps the newest requests', () => {
    for (let i = 0; i < EMAIL_QUEUE_MAX + 3; i += 1) {
      queueEmail(`student${i}@example.com`, 'confirm', NOON + i * 1000);
    }
    const queue = loadEmailQueue(NOON + 10_000);
    expect(queue).toHaveLength(EMAIL_QUEUE_MAX);
    expect(queue[queue.length - 1].email).toBe(`student${EMAIL_QUEUE_MAX + 2}@example.com`);
  });

  it('flushes a bounded number per app open', () => {
    for (let i = 0; i < EMAIL_QUEUE_MAX; i += 1) {
      queueEmail(`student${i}@example.com`, 'confirm', NOON + i * 1000);
    }
    const due = dueQueuedEmails(loadEmailQueue(NOON + 10_000), NOON + 10_000);
    expect(due.length).toBeGreaterThan(EMAIL_QUEUE_PER_OPEN);
  });

  it('survives unreadable storage instead of throwing', () => {
    window.localStorage.setItem(EMAIL_QUEUE_KEY, '{not json');
    expect(loadEmailQueue(NOON)).toEqual([]);
    expect(() => queueEmail('student@example.com', 'confirm', NOON)).not.toThrow();
    expect(loadEmailQueue(NOON)).toHaveLength(1);
  });

  it('ignores entries with no address', () => {
    window.localStorage.setItem(
      EMAIL_QUEUE_KEY,
      JSON.stringify([{ email: '  ', kind: 'confirm', queuedAt: NOON, lastAttemptDay: '' }])
    );
    expect(loadEmailQueue(NOON)).toEqual([]);
  });
});

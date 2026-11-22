import type { AttemptMode } from './types';

/**
 * Answers written while the network is down.
 *
 * Every attempt is already saved in the local profile, so nothing is lost; this
 * queue exists so a failed cloud write is retried instead of silently staying on
 * one device. Entries keep the same client event id the attempt used locally, and
 * `submit_question_attempt` is idempotent on that id, so a replay cannot double
 * count coins, streaks or progress. The queue is capped so a long offline stretch
 * cannot fill localStorage.
 */
const KEY = 'hdsat.outbox.v1';
const MAX_ENTRIES = 500;

export interface QueuedAttempt {
  eventId: string;
  questionId: string;
  response: string;
  mode: AttemptMode;
  timeSpentSeconds: number;
  sessionId: string | null;
  queuedAt: string;
}

function read(): QueuedAttempt[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is QueuedAttempt =>
        Boolean(entry) &&
        typeof (entry as QueuedAttempt).eventId === 'string' &&
        typeof (entry as QueuedAttempt).questionId === 'string' &&
        typeof (entry as QueuedAttempt).response === 'string'
    );
  } catch {
    return [];
  }
}

function write(entries: QueuedAttempt[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or blocked: the local profile still has the attempt */
  }
}

export function queuedAttempts(): QueuedAttempt[] {
  return read();
}

export function queuedCount(): number {
  return read().length;
}

/** Adds one entry. The same event id is never queued twice. */
export function queueAttempt(entry: QueuedAttempt): number {
  const entries = read();
  if (entries.some((existing) => existing.eventId === entry.eventId)) return entries.length;
  write([...entries, entry]);
  return read().length;
}

export function removeQueued(eventId: string): number {
  write(read().filter((entry) => entry.eventId !== eventId));
  return read().length;
}

export function clearOutbox(): number {
  write([]);
  return 0;
}

/**
 * Replays the queue oldest-first against `send`. A send that succeeds, or is
 * rejected because the server does not know the question yet, is dropped; a
 * network failure leaves it for the next try and stops the run, so a dead
 * connection is not hammered once per entry.
 */
export async function flushOutbox(
  send: (entry: QueuedAttempt) => Promise<void>,
  isPermanent?: (error: unknown) => boolean
): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  for (const entry of read()) {
    try {
      await send(entry);
      sent += 1;
      removeQueued(entry.eventId);
    } catch (error) {
      if (isPermanent?.(error)) {
        removeQueued(entry.eventId);
        continue;
      }
      return { sent, remaining: read().length };
    }
  }
  return { sent, remaining: read().length };
}

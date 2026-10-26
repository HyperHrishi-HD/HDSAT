/**
 * The deferred half of the mail ceiling.
 *
 * Brevo's free plan allows 300 sends a day and the app stops asking at 280, so
 * there is a window in which a student legitimately wants a confirmation code
 * and the app cannot send one. Refusing outright is the wrong answer: the
 * account already works (light accounts), so the request is remembered here and
 * sent on the next app open after the budget resets.
 *
 * The day boundary is UTC, because `email_send_budget` counts
 * `date_trunc('day', NOW())` in Postgres, which is UTC on Supabase. Matching it
 * here is what stops the queue from retrying at local midnight and being
 * refused again for another day.
 *
 * Everything is local to the device. The address never leaves it until the send
 * actually happens, so the queue adds no new server-side record of who asked
 * for mail — the database still keeps only the hashed rate-limit rows.
 */

export type EmailKind = 'confirm' | 'reset';

export interface QueuedEmail {
  email: string;
  kind: EmailKind;
  /** When the request was first parked. */
  queuedAt: number;
  /** UTC day (YYYY-MM-DD) of the last attempt, or '' if none yet. */
  lastAttemptDay: string;
}

export const EMAIL_QUEUE_KEY = 'hdsat.email-queue.v1';
/** A request older than this belongs to a window that has expired anyway. */
export const EMAIL_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** More than a couple of parked addresses is not a queue, it is a bug. */
export const EMAIL_QUEUE_MAX = 5;
/** How many parked sends one app open may flush. */
export const EMAIL_QUEUE_PER_OPEN = 2;

/** The UTC calendar day a timestamp falls in, as YYYY-MM-DD. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function normalise(queue: unknown, now: number): QueuedEmail[] {
  if (!Array.isArray(queue)) return [];
  const out: QueuedEmail[] = [];
  for (const raw of queue) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<QueuedEmail>;
    const email = String(entry.email ?? '').trim();
    if (!email) continue;
    const kind: EmailKind = entry.kind === 'reset' ? 'reset' : 'confirm';
    const queuedAt = Number(entry.queuedAt ?? 0);
    if (!Number.isFinite(queuedAt) || now - queuedAt > EMAIL_QUEUE_TTL_MS) continue;
    out.push({
      email,
      kind,
      queuedAt,
      lastAttemptDay: String(entry.lastAttemptDay ?? ''),
    });
  }
  return out;
}

function read(): unknown {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(EMAIL_QUEUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(queue: QueuedEmail[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (queue.length === 0) localStorage.removeItem(EMAIL_QUEUE_KEY);
    else localStorage.setItem(EMAIL_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* private mode: the send simply waits for the button instead */
  }
}

export function loadEmailQueue(now: number = Date.now()): QueuedEmail[] {
  return normalise(read(), now);
}

/**
 * Park a request. Re-requesting the same address and kind replaces the entry
 * (so one address never holds two slots) and keeps the original queued time,
 * because the 24-hour code window started then.
 */
export function queueEmail(
  email: string,
  kind: EmailKind,
  now: number = Date.now()
): QueuedEmail[] {
  const address = email.trim();
  if (!address) return loadEmailQueue(now);
  const queue = loadEmailQueue(now);
  const existing = queue.find(
    (entry) => entry.kind === kind && entry.email.toLowerCase() === address.toLowerCase()
  );
  const next: QueuedEmail = existing
    ? { ...existing, email: address }
    : { email: address, kind, queuedAt: now, lastAttemptDay: '' };

  const without = queue.filter((entry) => entry !== existing);
  without.push(next);
  const trimmed = without
    .sort((a, b) => b.queuedAt - a.queuedAt)
    .slice(0, EMAIL_QUEUE_MAX)
    .sort((a, b) => a.queuedAt - b.queuedAt);
  write(trimmed);
  return trimmed;
}

export function removeQueuedEmail(
  email: string,
  kind: EmailKind,
  now: number = Date.now()
): QueuedEmail[] {
  const address = email.trim().toLowerCase();
  const next = loadEmailQueue(now).filter(
    (entry) => !(entry.kind === kind && entry.email.toLowerCase() === address)
  );
  write(next);
  return next;
}

/** Requests that may be attempted now: inside their window, not tried today. */
export function dueQueuedEmails(
  queue: QueuedEmail[],
  now: number = Date.now()
): QueuedEmail[] {
  const today = utcDay(now);
  return queue.filter(
    (entry) => now - entry.queuedAt <= EMAIL_QUEUE_TTL_MS && entry.lastAttemptDay !== today
  );
}

/** Record that today's attempt happened, so a failed send cannot loop. */
export function markQueuedAttempt(
  email: string,
  kind: EmailKind,
  now: number = Date.now()
): QueuedEmail[] {
  const address = email.trim().toLowerCase();
  const queue = loadEmailQueue(now).map((entry) =>
    entry.kind === kind && entry.email.toLowerCase() === address
      ? { ...entry, lastAttemptDay: utcDay(now) }
      : entry
  );
  write(queue);
  return queue;
}

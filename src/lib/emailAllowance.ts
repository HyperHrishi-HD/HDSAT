/**
 * One email per address per day, whichever kind it is.
 *
 * The confirmation code and the password-recovery link are different messages
 * with the same cost: one send from a 300/day provider allowance. Treating them
 * as two separate allowances let a student press "Resend", then "Email me a
 * recovery link", then "Forgot password", and receive three copies of the same
 * thing a few minutes later — which is both confusing and exactly how a free
 * mail plan disappears.
 *
 * This ledger is per address and per device, and it is checked *before* any
 * message is handed to the provider, so a slow delivery cannot tempt someone
 * into a second and third request. The database keeps the authoritative copy;
 * this one exists so the answer is instant and works offline.
 */

export const EMAIL_ALLOWANCE_KEY = 'hdsat.email-allowance.v1';
/** One message per address in any rolling 24 hours. */
export const EMAIL_ALLOWANCE_MS = 24 * 60 * 60 * 1000;

export type EmailKind = 'confirm' | 'reset';

type Ledger = Record<string, number>;

function read(): Ledger {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(EMAIL_ALLOWANCE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Ledger = {};
    for (const [address, value] of Object.entries(parsed as Record<string, unknown>)) {
      const at = Number(value);
      if (address && Number.isFinite(at) && at > 0) out[address] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function write(ledger: Ledger): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(EMAIL_ALLOWANCE_KEY, JSON.stringify(ledger));
  } catch {
    /* private mode: the database guard still applies on the next request */
  }
}

function key(email: string): string {
  return email.trim().toLowerCase();
}

/** When this address last received an email from this device, or 0. */
export function lastEmailSentAt(email: string, now: number = Date.now()): number {
  const at = read()[key(email)] ?? 0;
  if (!at) return 0;
  if (now - at > EMAIL_ALLOWANCE_MS) return 0;
  return at;
}

/** Milliseconds until this address may receive another email; 0 when it may. */
export function emailAllowanceRemaining(email: string, now: number = Date.now()): number {
  const at = lastEmailSentAt(email, now);
  if (!at) return 0;
  return Math.max(0, at + EMAIL_ALLOWANCE_MS - now);
}

/** Records an accepted send. Call only after the provider took the request. */
export function recordEmailSent(email: string, now: number = Date.now()): void {
  const address = key(email);
  if (!address) return;
  const ledger = read();
  ledger[address] = now;
  // Housekeeping: entries older than the window can never block anything.
  for (const [entry, at] of Object.entries(ledger)) {
    if (now - at > EMAIL_ALLOWANCE_MS) delete ledger[entry];
  }
  write(ledger);
}

/** The sentence a student sees when they ask twice. */
export function oneEmailPerDayMessage(email: string, remainingMs: number): string {
  const minutes = Math.max(1, Math.round(remainingMs / 60000));
  const wait =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? '' : 's'}`
      : `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'}`;
  return `One email per day goes to ${email}, and today's has already been sent. It can take a few minutes to arrive — check the inbox and the spam folder. Another can be sent in ${wait}.`;
}

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_RESEND_COOLDOWN_MS,
  canSendVerificationEmail,
  clearPendingAccount,
  recordVerificationSend,
} from './storage';

const ADDRESS = 'student@example.com';
const start = Date.parse('2026-11-01T09:00:00Z');

beforeEach(() => {
  localStorage.clear();
  clearPendingAccount();
});

describe('confirmation email allowance', () => {
  it('allows the first send', () => {
    expect(canSendVerificationEmail(ADDRESS, start)).toMatchObject({ allowed: true });
  });

  it('holds the address for the day the code is valid for', () => {
    recordVerificationSend(ADDRESS, 'Student', start);
    const tooSoon = canSendVerificationEmail(ADDRESS, start + 30_000);
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.reason).toBe('daily-cap');
    expect(tooSoon.remainingMs).toBe(EMAIL_RESEND_COOLDOWN_MS - 30_000);
    // Ten minutes later is still the same day.
    expect(canSendVerificationEmail(ADDRESS, start + 10 * 60_000).allowed).toBe(false);
    expect(canSendVerificationEmail(ADDRESS, start + EMAIL_RESEND_COOLDOWN_MS + 1).allowed).toBe(
      true
    );
  });

  it('never allows a second send inside the window', () => {
    recordVerificationSend(ADDRESS, 'Student', start);
    for (const offset of [1_000, 60_000, 3_600_000, 23 * 3_600_000]) {
      expect(canSendVerificationEmail(ADDRESS, start + offset).allowed).toBe(false);
    }
  });

  it('counts addresses separately', () => {
    recordVerificationSend(ADDRESS, 'Student', start);
    expect(canSendVerificationEmail('other@example.com', start + 1_000).allowed).toBe(true);
  });
});

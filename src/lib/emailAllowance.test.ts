// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_ALLOWANCE_MS,
  emailAllowanceRemaining,
  lastEmailSentAt,
  oneEmailPerDayMessage,
  recordEmailSent,
} from './emailAllowance';

const ADDRESS = 'student@example.com';
const start = Date.parse('2026-11-02T08:00:00Z');

beforeEach(() => {
  localStorage.clear();
});

describe('one email per address per day', () => {
  it('allows the first send and blocks the next for 24 hours', () => {
    expect(emailAllowanceRemaining(ADDRESS, start)).toBe(0);
    recordEmailSent(ADDRESS, start);
    expect(lastEmailSentAt(ADDRESS, start)).toBe(start);
    expect(emailAllowanceRemaining(ADDRESS, start + 60_000)).toBe(EMAIL_ALLOWANCE_MS - 60_000);
    expect(emailAllowanceRemaining(ADDRESS, start + EMAIL_ALLOWANCE_MS)).toBe(0);
  });

  it('shares one allowance between the code and the recovery link', () => {
    recordEmailSent(ADDRESS, start);
    // Whichever button asks, the address has spent today's message.
    expect(emailAllowanceRemaining(ADDRESS, start + 5_000)).toBeGreaterThan(0);
  });

  it('ignores case and surrounding space, but not other addresses', () => {
    recordEmailSent(ADDRESS, start);
    expect(emailAllowanceRemaining('  STUDENT@Example.com ', start + 1_000)).toBeGreaterThan(0);
    expect(emailAllowanceRemaining('other@example.com', start + 1_000)).toBe(0);
    expect(emailAllowanceRemaining('student2@example.com', start + 1_000)).toBe(0);
  });

  it('forgets entries that can no longer block anything', () => {
    recordEmailSent(ADDRESS, start);
    recordEmailSent('other@example.com', start + EMAIL_ALLOWANCE_MS + 5_000);
    const ledger = JSON.parse(localStorage.getItem('hdsat.email-allowance.v1') ?? '{}');
    expect(Object.keys(ledger)).toEqual(['other@example.com']);
  });

  it('words the refusal with the wait that remains', () => {
    expect(oneEmailPerDayMessage(ADDRESS, 20_000)).toContain('minute');
    const hours = oneEmailPerDayMessage(ADDRESS, 5 * 60 * 60 * 1000);
    expect(hours).toContain('5 hours');
    expect(hours).toContain('spam');
  });
});

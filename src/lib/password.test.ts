/**
 * The password overlay must show the same rules the database enforces. These
 * tests pin the copy helpers and assert the migration keeps the ledger private
 * and the two windows (1 hour / 1 day) intact.
 */
import { describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20261026000200_password_change_limits.sql?raw';
import {
  cooldownMessage,
  formatCooldown,
  remainingFor,
  secondsUntil,
  validateNewPassword,
} from './password';

describe('formatCooldown', () => {
  it('uses seconds, minutes and hours at the right boundaries', () => {
    expect(formatCooldown(0)).toBe('now');
    expect(formatCooldown(-5)).toBe('now');
    expect(formatCooldown(12)).toBe('12 s');
    expect(formatCooldown(60)).toBe('1 min');
    expect(formatCooldown(2_600)).toBe('44 min');
    expect(formatCooldown(3_600)).toBe('1 h');
    expect(formatCooldown(3_900)).toBe('1 h 5 min');
    expect(formatCooldown(86_400)).toBe('24 h');
  });
});

describe('new password validation', () => {
  it('requires a password of the documented length', () => {
    expect(validateNewPassword('', '')).toBe('Enter a new password.');
    expect(validateNewPassword('abc', 'abc')).toBe('Use at least 6 characters.');
    expect(validateNewPassword('abcdef', 'abcdef')).toBeNull();
  });

  it('requires both entries to match', () => {
    expect(validateNewPassword('abcdef', 'abcdeg')).toBe('The two passwords do not match.');
  });
});

describe('cooldown deadlines', () => {
  it('clamps a deadline that has passed', () => {
    expect(secondsUntil(null)).toBe(0);
    expect(secondsUntil('not-a-date')).toBe(0);
    expect(secondsUntil('2026-10-26T10:00:00.000Z', Date.parse('2026-10-26T10:30:00.000Z'))).toBe(0);
  });

  it('prefers the absolute deadline over the reported seconds', () => {
    const now = Date.parse('2026-10-26T10:00:00.000Z');
    expect(remainingFor({ nextAllowedAt: '2026-10-26T10:01:30.000Z', retryAfterSeconds: 90 }, now)).toBe(90);
    expect(remainingFor({ nextAllowedAt: null, retryAfterSeconds: 240 }, now)).toBe(240);
  });

  it('names the action that is blocked', () => {
    expect(cooldownMessage('password', 600)).toBe('You can change your password in 10 min.');
    expect(cooldownMessage('email', 3_600)).toBe('You can request another link in 1 h.');
  });
});

describe('database-enforced limits', () => {
  it('keeps one hour for a change and one day for a recovery link', () => {
    expect(migration).toContain("WHEN p_via = 'password' THEN INTERVAL '1 hour'");
    expect(migration).toContain("WHEN p_via = 'email' THEN INTERVAL '24 hours'");
  });

  it('keeps the ledger private', () => {
    expect(migration).toContain('ALTER TABLE public.password_change_log ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.password_change_log FROM PUBLIC, anon, authenticated'
    );
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it('lets only signed-in users call the four RPCs', () => {
    const grants = [
      'claim_password_action(TEXT)',
      'complete_password_action(UUID)',
      'cancel_password_action(UUID)',
      'password_action_status()',
    ];
    for (const fn of grants) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
      expect(migration).not.toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO anon;`);
    }
  });

  it('scopes every read and write to the caller', () => {
    expect(migration).toContain('v_user_id UUID := auth.uid();');
    expect(migration).toContain('AND user_id = v_user_id');
    expect(migration).toContain('WHERE user_id = v_user_id');
  });

  it('treats an abandoned attempt as no reservation', () => {
    expect(migration).toContain("INTERVAL '15 minutes'");
  });
});

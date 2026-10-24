/**
 * Password-change rules shared by the overlay, the recovery redirect handler and
 * the tests. The database owns the cooldowns (1 change/hour, 1 recovery link/day);
 * everything here is formatting and validation so both sides agree on the copy.
 */

export type PasswordPath = 'password' | 'email';

export interface PasswordCooldown {
  nextAllowedAt: string | null;
  retryAfterSeconds: number;
}

export interface PasswordActionClaim extends PasswordCooldown {
  allowed: boolean;
  actionId: string | null;
}

/** Matches Supabase's minimum and the signup form's hint. */
export const PASSWORD_MIN_LENGTH = 6;

/** Session flag set when a recovery link lands, read once by the Account page. */
export const PASSWORD_RECOVERY_FLAG = 'hdsat.password-recovery';

/** Device marker so a PKCE code can be recognised as a recovery link. */
export const PASSWORD_RESET_REQUESTED_KEY = 'hdsat.password-reset-requested';

export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password) return 'Enter a new password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

/** "12 s", "43 min", "1 h 5 min" — short enough for a hint line. */
export function formatCooldown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total <= 0) return 'now';
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.ceil(total / 60)} min`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.ceil((total % 3600) / 60);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** Seconds left on a server-provided deadline, clamped at zero. */
export function secondsUntil(iso: string | null, now: number = Date.now()): number {
  if (!iso) return 0;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** Remaining wait for one path, preferring the absolute deadline. */
export function remainingFor(cooldown: PasswordCooldown, now: number = Date.now()): number {
  if (cooldown.nextAllowedAt) return secondsUntil(cooldown.nextAllowedAt, now);
  return Math.max(0, cooldown.retryAfterSeconds);
}

export function cooldownMessage(path: PasswordPath, seconds: number): string {
  const action = path === 'password' ? 'change your password' : 'request another link';
  return `You can ${action} in ${formatCooldown(seconds)}.`;
}

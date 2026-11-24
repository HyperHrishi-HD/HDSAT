export const PRACTICE_LENGTH_MIN = 1;
export const PRACTICE_LENGTH_MAX = 50;

/**
 * Initial length for a retry-missed entry point.
 *
 * `available` is the already-filtered missed pool. The result is never above
 * the existing length control's maximum, and never above the pool that can
 * actually be drawn. A zero pool returns null so the caller leaves the normal
 * empty state alone rather than starting a 1-question session.
 */
export function retryMissedLength(missed: number, available: number): number | null {
  if (!Number.isFinite(missed) || !Number.isFinite(available)) return null;
  const pool = Math.max(0, Math.floor(available));
  const target = Math.max(0, Math.floor(missed));
  if (pool === 0 || target === 0) return null;
  return Math.max(
    PRACTICE_LENGTH_MIN,
    Math.min(PRACTICE_LENGTH_MAX, target, pool)
  );
}

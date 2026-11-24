/**
 * Interceptor accuracy is measured in successful pulses, not targets hit.
 *
 * One pulse can clear several targets (and a silver ship is worth two coins),
 * so targets hit can legitimately be greater than shots fired. Accuracy must
 * therefore divide the number of shots that hit at least one target by the
 * number of shots fired. This function is the single shared definition used by
 * the HUD, the run summary and tests; the UI may clamp for safety but the
 * underlying counters are already correct by construction.
 */
export function interceptorAccuracy(shotsFired: number, successfulShots: number): number | null {
  if (!Number.isFinite(shotsFired) || !Number.isFinite(successfulShots) || shotsFired <= 0) {
    return null;
  }
  const successes = Math.max(0, Math.min(Math.floor(successfulShots), Math.floor(shotsFired)));
  return Math.round((successes / Math.floor(shotsFired)) * 100);
}

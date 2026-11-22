import type { TestAttempt } from './types';

/**
 * The score range a student is currently playing at.
 *
 * One test is one sample, and treating it as a score is how students talk
 * themselves into a panic. This reads the last few completed simulations,
 * weights the newest ones more, and widens the range by how much those results
 * disagree with each other: three tests that all landed near 1300 give a narrow
 * band, a 1180 followed by a 1420 gives a wide one. The band is a description of
 * recent form, never a prediction, and it is clamped to the assessment's real
 * score scale so it can never print an impossible number.
 */

export interface ScoreBand {
  low: number;
  high: number;
  /** Completed simulations the band is built from. */
  samples: number;
  /** The most recent total, for the "last test" line. */
  latest: number;
}

const SCALES: Record<string, { low: number; high: number }> = {
  SAT: { low: 400, high: 1600 },
  'PSAT/NMSQT': { low: 320, high: 1520 },
  'PSAT 10': { low: 320, high: 1520 },
  'PSAT 8/9': { low: 240, high: 1440 },
};

const MAX_SAMPLES = 5;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function scoreBand(
  attempts: TestAttempt[],
  assessment: string,
  maxSamples: number = MAX_SAMPLES
): ScoreBand | null {
  const completed = attempts
    .filter(
      (attempt) =>
        attempt.status !== 'incomplete' &&
        typeof attempt.totalEstimate === 'number' &&
        Number.isFinite(attempt.totalEstimate)
    )
    .slice(0, Math.max(1, maxSamples));
  if (completed.length === 0) return null;

  const values = completed.map((attempt) => attempt.totalEstimate as number);
  const weights = values.map((_, index) => Math.pow(0.7, index)); // newest first
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const mean = values.reduce((sum, value, index) => sum + value * weights[index], 0) / weightSum;

  // Disagreement between runs is the honest source of width. Two tests that
  // differ by 200 points cannot produce a ±30 band.
  const spread =
    values.length > 1
      ? Math.sqrt(
          values.reduce((sum, value, index) => sum + weights[index] * Math.pow(value - mean, 2), 0) /
            weightSum
        )
      : 0;
  const halfWidth = Math.round(Math.max(35, spread * 1.15 + 20));

  const scale = SCALES[assessment] ?? SCALES.SAT;
  const low = clamp(Math.round((mean - halfWidth) / 10) * 10, scale.low, scale.high);
  const high = clamp(Math.round((mean + halfWidth) / 10) * 10, scale.low, scale.high);

  return {
    low: Math.min(low, high - 20),
    high: Math.max(high, low + 20),
    samples: values.length,
    latest: values[0],
  };
}

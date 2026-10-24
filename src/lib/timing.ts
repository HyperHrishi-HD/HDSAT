import type { Difficulty, LocalAttempt, Section } from './types';

/**
 * Pacing reference. The test blueprint gives 32 minutes for 27 Reading &
 * Writing items and 35 minutes for 22 Math items, so the official pace is about
 * 71 s and 95 s per item. Those are the fallbacks; once the student has enough
 * timed attempts of their own, their median is the honest comparison.
 */
export const NOMINAL_SECONDS: Record<Section, number> = {
  'Reading and Writing': 71,
  Math: 95,
};

const MIN_SAMPLES = 5;
const MAX_PLAUSIBLE_SECONDS = 20 * 60;

export interface TimingSample {
  section: Section;
  difficulty: Difficulty;
  seconds: number;
}

/** Timed attempts only; a paused or untimed run would skew the median. */
export function timingSamplesFromAttempts(attempts: LocalAttempt[]): TimingSample[] {
  const samples: TimingSample[] = [];
  for (const attempt of attempts) {
    const seconds = Math.round(attempt.timeSpentSeconds ?? 0);
    if (seconds < 3 || seconds > MAX_PLAUSIBLE_SECONDS) continue;
    if (!attempt.section || !attempt.difficulty) continue;
    samples.push({ section: attempt.section, difficulty: attempt.difficulty, seconds });
  }
  return samples;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function medianFor(
  samples: TimingSample[],
  match: (sample: TimingSample) => boolean
): number | null {
  const values = samples.filter(match).map((sample) => sample.seconds);
  return values.length >= MIN_SAMPLES ? median(values) : null;
}

/**
 * Typical time for an item of this section and difficulty: the student's own
 * median when there is enough evidence, then a section-wide median, then the
 * official pace.
 */
export function typicalSeconds(
  samples: TimingSample[],
  section: Section,
  difficulty: Difficulty
): number {
  return (
    medianFor(samples, (s) => s.section === section && s.difficulty === difficulty) ??
    medianFor(samples, (s) => s.section === section) ??
    NOMINAL_SECONDS[section]
  );
}

export function formatPace(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

/** "You 2:10 · typical 1:25", or null when there is nothing to compare. */
export function paceComparison(youSeconds: number, typical: number): string | null {
  const you = Math.round(youSeconds);
  if (!Number.isFinite(you) || you <= 0 || typical <= 0) return null;
  return `You ${formatPace(you)} · typical ${formatPace(typical)}`;
}

import type { Difficulty, Question, Section } from './types';

/**
 * Practice Rush tuning.
 *
 * Every rush run is identified by three settings (duration, section focus,
 * difficulty). Scores are kept per combination, so the record a student sees
 * always belongs to the exact setup they are about to play.
 */

export type RushDifficultyMode = 'Easy' | 'Medium' | 'Hard' | 'Mixed' | 'Increasing';
export type RushDuration = 60 | 180 | 300 | 'free';

export interface RushSetup {
  duration: RushDuration;
  section: Section | 'all';
  difficulty: RushDifficultyMode;
}

export const RUSH_DURATION_OPTIONS: { value: string; label: string; hint?: string }[] = [
  { value: '60', label: '1 Minute Blitz', hint: '60 seconds, one pressure burst.' },
  { value: '180', label: '3 Minute Standard', hint: 'The everyday rush length.' },
  { value: '300', label: '5 Minute Endurance', hint: '300 seconds of sustained pace.' },
  { value: 'free', label: 'Free · Stopwatch', hint: 'No timer. The clock counts up instead.' },
];

export const RUSH_DIFFICULTY_OPTIONS: { value: RushDifficultyMode; label: string; hint?: string }[] = [
  { value: 'Easy', label: 'Easy', hint: 'Foundational items only — build speed safely.' },
  { value: 'Medium', label: 'Medium', hint: 'Module-difficulty items only.' },
  { value: 'Hard', label: 'Hard', hint: 'Upper-module items only — the toughest set.' },
  { value: 'Mixed', label: 'Mixed', hint: 'Any difficulty, dealt at random.' },
  {
    value: 'Increasing',
    label: 'Increasing · Free',
    hint: 'Starts fully Easy and shifts toward Medium/Hard every minute.',
  },
];

export const RUSH_DIFFICULTY_MODES: RushDifficultyMode[] = ['Easy', 'Medium', 'Hard', 'Mixed', 'Increasing'];

export function isRushDuration(value: unknown): value is RushDuration {
  return value === 'free' || value === 60 || value === 180 || value === 300;
}

export function parseRushDuration(value: string): RushDuration {
  if (value === 'free') return 'free';
  const parsed = Number(value);
  return isRushDuration(parsed) ? parsed : 180;
}

/** Stable storage key for one combination of rush settings. */
export function rushSetupKey(setup: RushSetup): string {
  const duration = setup.duration === 'free' ? 'free' : String(setup.duration);
  return `${duration}|${setup.section}|${setup.difficulty}`;
}

export function rushSetupLabel(value: RushDuration): string {
  if (value === 'free') return 'Free';
  if (value === 60) return '1 min';
  if (value === 180) return '3 min';
  return '5 min';
}

/** Human label for a stored `rushSetupKey()` value. */
export function describeRushKey(key: string): string {
  const [durationRaw, sectionRaw, difficultyRaw] = key.split('|');
  const duration = parseRushDuration(durationRaw ?? '');
  const sectionLabel = !sectionRaw || sectionRaw === 'all' ? 'Mixed sections' : sectionRaw;
  return `${rushSetupLabel(duration)} · ${sectionLabel} · ${difficultyRaw || 'Mixed'}`;
}

export interface RushDifficultyMix {
  Easy: number;
  Medium: number;
  Hard: number;
}

/**
 * Increasing-difficulty curve, expressed as the share of questions served at
 * each point in the run. The first minute is all Easy; the Medium/Hard share
 * doubles and then roughly doubles again (10% → 22% → 35% → 45% → 50%), and
 * the run settles at the SAT module mix (~30/42/28) after twelve minutes.
 * Values between stages are interpolated per second, so the mix moves
 * continuously rather than jumping at minute boundaries.
 */
const INCREASING_STAGES: { atSeconds: number; mix: RushDifficultyMix }[] = [
  { atSeconds: 0, mix: { Easy: 1, Medium: 0, Hard: 0 } },
  { atSeconds: 60, mix: { Easy: 0.9, Medium: 0.1, Hard: 0 } },
  { atSeconds: 120, mix: { Easy: 0.78, Medium: 0.18, Hard: 0.04 } },
  { atSeconds: 180, mix: { Easy: 0.65, Medium: 0.26, Hard: 0.09 } },
  { atSeconds: 240, mix: { Easy: 0.55, Medium: 0.32, Hard: 0.13 } },
  { atSeconds: 300, mix: { Easy: 0.5, Medium: 0.35, Hard: 0.15 } },
  { atSeconds: 420, mix: { Easy: 0.42, Medium: 0.38, Hard: 0.2 } },
  { atSeconds: 540, mix: { Easy: 0.36, Medium: 0.4, Hard: 0.24 } },
  { atSeconds: 720, mix: { Easy: 0.3, Medium: 0.42, Hard: 0.28 } },
];

export function rushDifficultyMix(elapsedSeconds: number): RushDifficultyMix {
  const seconds = Math.max(0, elapsedSeconds);
  const first = INCREASING_STAGES[0];
  if (seconds <= first.atSeconds) return { ...first.mix };
  for (let i = 0; i < INCREASING_STAGES.length - 1; i += 1) {
    const a = INCREASING_STAGES[i];
    const b = INCREASING_STAGES[i + 1];
    if (seconds > b.atSeconds) continue;
    const span = b.atSeconds - a.atSeconds;
    const t = span <= 0 ? 1 : (seconds - a.atSeconds) / span;
    return {
      Easy: a.mix.Easy + (b.mix.Easy - a.mix.Easy) * t,
      Medium: a.mix.Medium + (b.mix.Medium - a.mix.Medium) * t,
      Hard: a.mix.Hard + (b.mix.Hard - a.mix.Hard) * t,
    };
  }
  return { ...INCREASING_STAGES[INCREASING_STAGES.length - 1].mix };
}

export type RushServed = Record<Difficulty, number>;

export function emptyRushServed(): RushServed {
  return { Easy: 0, Medium: 0, Hard: 0 };
}

/**
 * Picks the difficulty that is furthest behind the curve so far. A greedy
 * deficit scheduler keeps the real, served mix close to the target instead of
 * relying on luck, and it can never drift far above the curve's Hard ceiling.
 */
export function pickRushDifficulty(mix: RushDifficultyMix, served: RushServed): Difficulty {
  const order: Difficulty[] = ['Easy', 'Medium', 'Hard'];
  const total = served.Easy + served.Medium + served.Hard;
  let best: Difficulty = 'Easy';
  let bestDeficit = -Infinity;
  for (const difficulty of order) {
    const deficit = mix[difficulty] * (total + 1) - served[difficulty];
    if (deficit > bestDeficit + 1e-9) {
      bestDeficit = deficit;
      best = difficulty;
    }
  }
  return best;
}

/**
 * The next question for the current rush. Increasing mode picks by the live
 * curve; the fixed modes only ever draw their own difficulty; Mixed draws at
 * random. Questions already served are avoided until that slice is exhausted.
 */
export function chooseRushQuestion(
  pool: Question[],
  mode: RushDifficultyMode,
  elapsedSeconds: number,
  served: RushServed,
  usedIds: Set<string>,
  rand: () => number = Math.random
): Question | null {
  if (pool.length === 0) return null;
  const target: Difficulty | null =
    mode === 'Mixed' ? null : mode === 'Increasing' ? pickRushDifficulty(rushDifficultyMix(elapsedSeconds), served) : mode;
  const matchesTarget = (q: Question) => target === null || q.difficulty === target;
  const fresh = pool.filter((q) => matchesTarget(q) && !usedIds.has(q.id));
  const candidates = fresh.length > 0 ? fresh : pool.filter(matchesTarget);
  const fallback = candidates.length > 0 ? candidates : pool.filter((q) => !usedIds.has(q.id));
  const finalPool = fallback.length > 0 ? fallback : pool;
  const index = Math.min(finalPool.length - 1, Math.floor(rand() * finalPool.length));
  return finalPool[index] ?? null;
}

/** Base points for one correct answer, before the streak multiplier. */
export const RUSH_BASE_POINTS: Record<Difficulty, number> = { Easy: 10, Medium: 15, Hard: 20 };
export const RUSH_STREAK_STEP = 0.1;
export const RUSH_STREAK_CAP = 5;

/**
 * Points for a correct answer: 10 / 15 / 20 by difficulty, plus 10% per
 * consecutive correct answer, capped at +50%. Wrong answers score nothing, so
 * speed without accuracy cannot inflate a record.
 */
export function rushAnswerPoints(difficulty: Difficulty, streakAfterAnswer: number): number {
  const streak = Math.max(0, streakAfterAnswer - 1);
  const multiplier = 1 + Math.min(streak, RUSH_STREAK_CAP) * RUSH_STREAK_STEP;
  return Math.round(RUSH_BASE_POINTS[difficulty] * multiplier);
}

export interface RushSummary {
  score: number;
  correct: number;
  attempted: number;
  bestStreak: number;
  accuracy: number;
  elapsedSeconds: number;
}

export function rushSummary(args: {
  score: number;
  correct: number;
  attempted: number;
  bestStreak: number;
  elapsedSeconds: number;
}): RushSummary {
  return {
    ...args,
    accuracy: args.attempted > 0 ? args.correct / args.attempted : 0,
  };
}

/**
 * A run is only worth recording once there is something to compare: at least
 * three attempts, the same floor the activity-session RPC enforces.
 */
export const RUSH_MIN_ATTEMPTS_FOR_RECORD = 3;

export function describeRushMix(mix: RushDifficultyMix): string {
  return `Easy ${Math.round(mix.Easy * 100)}% · Medium ${Math.round(
    mix.Medium * 100
  )}% · Hard ${Math.round(mix.Hard * 100)}%`;
}

import type { Question, QuestionProgress } from './types';

/**
 * Practice scheduling.
 *
 * A student masters an item with two consecutive correct answers. Mastery is
 * only meaningful if the item comes back later, so practice never falls back to
 * "any previously attempted item" filler: after the unseen supply is used up,
 * only items whose review date has arrived can be drawn.
 *
 * Spacing by how well the item is known:
 *   miss            -> due immediately (a miss is not evidence of recall)
 *   correct, once   -> 1 day
 *   mastered x2     -> 7 days
 *   mastered x3     -> 14 days
 *   mastered x4+    -> 30 days
 */
const MASTERY_INTERVALS_DAYS = [7, 14, 30] as const;

export type ReviewReason = 'unseen' | 'incorrect' | 'correct' | 'mastered';

export interface ReviewState {
  reason: ReviewReason;
  /** Unseen items are always eligible, but they are not a review. */
  unseen: boolean;
  due: boolean;
  dueAt: number | null;
  intervalDays: number | null;
  /** Whole days past the due date; 0 while not overdue. */
  overdueDays: number;
}

export function reviewIntervalDays(progress: QuestionProgress): number {
  if (progress.status === 'incorrect') return 0;
  if (progress.status === 'mastered') {
    const extra = Math.max(0, Math.min(MASTERY_INTERVALS_DAYS.length - 1, progress.consecutiveCorrect - 2));
    return MASTERY_INTERVALS_DAYS[extra];
  }
  return 1;
}

export function reviewState(
  progress: QuestionProgress | undefined,
  now: Date = new Date()
): ReviewState {
  if (!progress || progress.attemptCount === 0) {
    return { reason: 'unseen', unseen: true, due: false, dueAt: null, intervalDays: null, overdueDays: 0 };
  }
  const intervalDays = reviewIntervalDays(progress);
  const last = new Date(progress.lastAttemptedAt).getTime();
  const base = Number.isFinite(last) ? last : now.getTime();
  const dueAt = base + intervalDays * 24 * 60 * 60 * 1000;
  const overdueMs = now.getTime() - dueAt;
  return {
    reason: progress.status,
    unseen: false,
    due: overdueMs >= 0,
    dueAt,
    intervalDays,
    overdueDays: overdueMs > 0 ? Math.floor(overdueMs / (24 * 60 * 60 * 1000)) : 0,
  };
}

/** True only for a previously attempted item whose review date has arrived. */
export function isReviewDue(
  progress: QuestionProgress | undefined,
  now: Date = new Date()
): boolean {
  const state = reviewState(progress, now);
  return !state.unseen && state.due;
}

const PRIORITY: Record<ReviewReason, number> = {
  incorrect: 0,
  correct: 1,
  mastered: 2,
  unseen: 3,
};

/**
 * Review order: misses first, then items answered correctly once, then mastered
 * items; inside a group the longest-waiting item comes first.
 */
export function compareReviewOrder(
  a: QuestionProgress | undefined,
  b: QuestionProgress | undefined
): number {
  const stateA = reviewState(a);
  const stateB = reviewState(b);
  if (PRIORITY[stateA.reason] !== PRIORITY[stateB.reason]) {
    return PRIORITY[stateA.reason] - PRIORITY[stateB.reason];
  }
  return (stateA.dueAt ?? 0) - (stateB.dueAt ?? 0);
}

export interface PoolReadiness {
  unseen: number;
  due: number;
  scheduled: number;
  /** Items a session can actually draw right now. */
  ready: number;
}

/**
 * Splits a filtered pool into what practice may use now and what must wait.
 * `allowScheduled` is for drills where the student picked the items themselves
 * (saved questions, incorrect-only), which are explicit intent rather than
 * automatic filler.
 */
export function poolReadiness(
  pool: Question[],
  progress: Record<string, QuestionProgress>,
  now: Date = new Date()
): PoolReadiness {
  let unseen = 0;
  let due = 0;
  let scheduled = 0;
  for (const question of pool) {
    const state = reviewState(progress[question.id], now);
    if (state.unseen) unseen += 1;
    else if (state.due) due += 1;
    else scheduled += 1;
  }
  return { unseen, due, scheduled, ready: unseen + due };
}

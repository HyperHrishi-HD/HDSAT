/**
 * SM-2 spaced repetition, matching the PL/pgSQL implementation in
 * supabase/migrations/20261014000100_init_hdsat_schema.sql (submit_flashcard_review)
 * so that guest and cloud schedules agree.
 */
export function scheduleReview(previous, quality, now = new Date()) {
    const clamped = Math.max(0, Math.min(5, Math.round(quality)));
    const reps = previous?.repetitions ?? 0;
    const interval = previous?.intervalDays ?? 0;
    let ease = previous?.easeFactor ?? 2.5;
    let nextReps;
    let nextInterval;
    let stage;
    if (clamped < 3) {
        nextReps = 0;
        nextInterval = 1;
        stage = 'learning';
    }
    else {
        if (reps === 0)
            nextInterval = 1;
        else if (reps === 1)
            nextInterval = 3;
        else
            nextInterval = Math.max(1, Math.round(interval * ease));
        nextReps = reps + 1;
        stage = nextInterval >= 14 ? 'mastered' : 'review';
    }
    ease = Math.max(1.3, ease + (0.1 - (5 - clamped) * (0.08 + (5 - clamped) * 0.02)));
    const due = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000);
    return {
        stage,
        repetitions: nextReps,
        intervalDays: nextInterval,
        easeFactor: Number(ease.toFixed(2)),
        nextDueAt: due.toISOString(),
    };
}
export function isDue(progress, now = new Date()) {
    if (!progress)
        return true;
    return new Date(progress.nextDueAt).getTime() <= now.getTime();
}

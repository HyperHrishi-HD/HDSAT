-- ============================================================================
-- BACKFILL HISTORICAL GAME STREAKS (2026-11-07)
-- ============================================================================
-- The previous cloud `refresh_streak_and_achievements` counted questions,
-- flashcards and Practice Rush, but not completed Arcade games. The forward
-- trigger added in 20261107000100 fixes future games; this migration repairs
-- the days that were already recorded with games_completed > 0.
--
-- It changes only streak flags and streak counters. It does not touch coins,
-- question data, attempts, or achievement rewards, and is safe to re-run.
-- ============================================================================

UPDATE public.daily_activity
SET qualified_for_streak = TRUE,
    updated_at = NOW()
WHERE games_completed > 0
  AND qualified_for_streak = FALSE;

WITH qualifying AS (
    SELECT user_id, activity_date
    FROM public.daily_activity
    WHERE qualified_for_streak
       OR games_completed > 0
       OR questions_completed >= 3
       OR flashcards_reviewed >= 5
       OR rushes_completed >= 1
),
islands AS (
    SELECT
        user_id,
        activity_date,
        activity_date - (row_number() OVER (
            PARTITION BY user_id ORDER BY activity_date
        ))::INTEGER AS run_group
    FROM qualifying
),
runs AS (
    SELECT
        user_id,
        MAX(activity_date) AS end_date,
        COUNT(*)::INTEGER AS run_length
    FROM islands
    GROUP BY user_id, run_group
),
latest AS (
    SELECT DISTINCT ON (user_id)
        user_id,
        end_date,
        run_length
    FROM runs
    ORDER BY user_id, end_date DESC
),
best AS (
    SELECT user_id, MAX(run_length)::INTEGER AS best_length
    FROM runs
    GROUP BY user_id
),
rollup AS (
    SELECT
        latest.user_id,
        latest.end_date,
        latest.run_length,
        best.best_length
    FROM latest
    JOIN best USING (user_id)
)
UPDATE public.user_stats AS stats
SET current_streak = rollup.run_length,
    best_streak = GREATEST(stats.best_streak, rollup.best_length),
    last_qualifying_date = GREATEST(
        COALESCE(stats.last_qualifying_date, rollup.end_date),
        rollup.end_date
    ),
    updated_at = NOW()
FROM rollup
WHERE stats.user_id = rollup.user_id;

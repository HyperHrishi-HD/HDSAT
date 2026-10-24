-- ============================================================================
-- REMOVE THE WEEKLY COACH EMAIL (2026-10-26)
-- ============================================================================
-- The owner retired the feature, so the preference columns, the send ledger and
-- both RPCs are dropped. Safe to re-run: every statement is IF EXISTS, and the
-- dropped objects are not referenced by any other table or function.
-- ============================================================================

DROP FUNCTION IF EXISTS public.weekly_coach_digest(DATE);
DROP FUNCTION IF EXISTS public.set_weekly_coach_preference(BOOLEAN);

DROP TABLE IF EXISTS public.weekly_coach_log;

ALTER TABLE public.profiles
    DROP COLUMN IF EXISTS weekly_coach_email,
    DROP COLUMN IF EXISTS weekly_coach_opted_in_at;

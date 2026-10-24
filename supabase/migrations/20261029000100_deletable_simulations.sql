-- ============================================================================
-- DELETABLE SIMULATIONS + PERMANENT SCORE LOG (2026-10-29)
-- ============================================================================
-- A student may delete a past simulation. The run and its per-item responses
-- go; the score does not. A trigger writes one compact row (date, track, three
-- estimates, two raw counts, duration) before the delete, so even a delete run
-- from the SQL editor leaves the same record as one from the app.
--
-- The log is read-only to its owner: RLS allows SELECT on your own rows and
-- nothing else. Only the SECURITY DEFINER trigger can insert, so a client
-- cannot invent a score. Deleting the account still cascades everything away.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.test_score_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The deleted attempt's id, kept for traceability. No foreign key on purpose:
  -- the whole point is that this row outlives the attempt.
  attempt_ref UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assessment TEXT NOT NULL,
  total_score INTEGER,
  rw_score INTEGER,
  math_score INTEGER,
  raw_correct INTEGER NOT NULL DEFAULT 0,
  raw_total INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_test_score_log_user
  ON public.test_score_log (user_id, created_at DESC);

ALTER TABLE public.test_score_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own score log" ON public.test_score_log;
CREATE POLICY "Users read own score log" ON public.test_score_log
  FOR SELECT USING (auth.uid() = user_id);

-- A student may delete their own runs. Responses cascade from test_attempts.
DROP POLICY IF EXISTS "Users delete own test attempts" ON public.test_attempts;
CREATE POLICY "Users delete own test attempts" ON public.test_attempts
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.log_deleted_test_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  estimates JSONB := COALESCE(OLD.estimated_score_range, '{}'::jsonb);
BEGIN
  -- Only a finished run has a score worth keeping. An abandoned attempt is
  -- ungraded by definition.
  IF OLD.status <> 'completed' THEN
    RETURN OLD;
  END IF;

  -- Account deletion cascades into test_attempts. By the time those rows go,
  -- the auth.users row is already gone, so writing a log entry would violate
  -- the foreign key and block the deletion entirely. The log is being removed
  -- with the account anyway, so there is nothing to keep.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.test_score_log (
    user_id, attempt_ref, created_at, assessment,
    total_score, rw_score, math_score,
    raw_correct, raw_total, duration_seconds
  ) VALUES (
    OLD.user_id,
    OLD.id,
    COALESCE(OLD.completed_at, now()),
    COALESCE(OLD.assessment, 'SAT'),
    NULLIF(estimates ->> 'total', '')::INTEGER,
    NULLIF(estimates ->> 'rw', '')::INTEGER,
    NULLIF(estimates ->> 'math', '')::INTEGER,
    COALESCE(OLD.raw_correct, 0),
    COALESCE(OLD.raw_total, 0),
    COALESCE(OLD.time_spent_seconds, 0)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS test_attempts_score_log ON public.test_attempts;
CREATE TRIGGER test_attempts_score_log
  AFTER DELETE ON public.test_attempts
  FOR EACH ROW EXECUTE FUNCTION public.log_deleted_test_score();

REVOKE ALL ON public.test_score_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.test_score_log TO authenticated;
GRANT INSERT ON public.test_score_log TO service_role;

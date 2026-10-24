-- ============================================================================
-- TEST-DATE GOAL (2026-10-26)
-- ============================================================================
-- The student picks the real test they are working towards (assessment already
-- lives in profiles.preferred_exam) and its date. The Dashboard turns it into
-- "Goal: 12 days to Oct 3" instead of a generic daily-question goal, which is
-- the only number that actually pressures a student to stay on schedule.
--
-- One nullable column, validated in the database so a bad client cannot store a
-- year-3000 date. Read through fetchSnapshot, written through the owner's own
-- update policy (the column is theirs, like preferred_exam).
-- ============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS target_test_date DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.profiles'::regclass
           AND conname = 'profiles_target_test_date_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_target_test_date_check
            CHECK (
                target_test_date IS NULL
                OR target_test_date BETWEEN DATE '2026-01-01' AND DATE '2035-12-31'
            );
    END IF;
END;
$$;

COMMENT ON COLUMN public.profiles.target_test_date IS
    'The real test date the student is working towards; drives the Dashboard goal. Nullable.';

NOTIFY pgrst, 'reload schema';

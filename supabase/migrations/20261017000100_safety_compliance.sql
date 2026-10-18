-- ============================================================================
-- HDSAT SAFETY, CONSENT AND DATA-RIGHTS MIGRATION
-- ============================================================================
-- Adds the compliance "failsafes" the product needs:
--   1. Consent + coarse age band recorded on every new profile (COPPA / minors)
--   2. Anonymous-friendly question reports for content-accuracy escalation
--   3. public.user_appeals — intake for safety, copyright, access and data
--      requests that works with or without an account
--   4. Self-serve account deletion RPC (right to erasure) with no service key
--
-- Idempotent: safe to re-run against an existing HDSAT project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONSENT METADATA ON PROFILES
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age_band TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

DO $$
BEGIN
    ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_age_band_check
        CHECK (age_band IS NULL OR age_band IN ('13-15', '16-17', '18+'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. QUESTION REPORTS: ANONYMOUS REPORTING + Triage COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.question_reports ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.question_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'received';

DROP POLICY IF EXISTS "Users insert own question reports" ON public.question_reports;
DROP POLICY IF EXISTS "Anyone can file a question report" ON public.question_reports;
CREATE POLICY "Anyone can file a question report" ON public.question_reports
    FOR INSERT TO anon, authenticated
    WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS question_reports_created_idx
    ON public.question_reports (created_at DESC);

GRANT SELECT, INSERT ON public.question_reports TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. APPEALS / SAFETY-REPORT INTAKE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_appeals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference TEXT NOT NULL
        DEFAULT ('HDSAT-' || UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8))),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    contact_email TEXT,
    category TEXT NOT NULL CHECK (
        category IN ('content_copyright', 'question_error', 'account_access', 'data_request', 'safety_report', 'other')
    ),
    subject TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'in_review', 'resolved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_appeals ENABLE ROW LEVEL SECURITY;

-- A notice can come from anyone (including a rights-holder without an account)
-- but a signed-in user may only attach their own user id.
DROP POLICY IF EXISTS "Anyone can file an appeal" ON public.user_appeals;
CREATE POLICY "Anyone can file an appeal" ON public.user_appeals
    FOR INSERT TO anon, authenticated
    WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own appeals" ON public.user_appeals;
CREATE POLICY "Users read own appeals" ON public.user_appeals
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_appeals_user_idx ON public.user_appeals (user_id);
CREATE INDEX IF NOT EXISTS user_appeals_created_idx ON public.user_appeals (created_at DESC);

GRANT SELECT, INSERT ON public.user_appeals TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. STORE CONSENT AT SIGNUP (works even before email confirmation)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
BEGIN
    INSERT INTO public.profiles (
        user_id,
        display_name,
        age_band,
        guardian_consent,
        terms_version,
        terms_accepted_at
    )
    VALUES (
        NEW.id,
        COALESCE(v_meta->>'display_name', split_part(COALESCE(NEW.email, 'student'), '@', 1), 'Student'),
        NULLIF(v_meta->>'age_band', ''),
        COALESCE((v_meta->>'guardian_consent')::BOOLEAN, FALSE),
        NULLIF(v_meta->>'terms_version', ''),
        CASE
            WHEN NULLIF(v_meta->>'terms_accepted_at', '') IS NULL THEN NULL
            ELSE (v_meta->>'terms_accepted_at')::TIMESTAMPTZ
        END
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_stats (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. SELF-SERVE ACCOUNT DELETION (RIGHT TO ERASURE)
-- ----------------------------------------------------------------------------
-- Runs as the migration owner so an ordinary student can erase their account
-- without any elevated key ever reaching the browser. Reports and appeals are
-- de-identified rather than deleted so the safety/legal audit trail survives.
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    UPDATE public.question_reports
       SET user_id = NULL, contact_email = NULL
     WHERE user_id = v_uid;

    UPDATE public.user_appeals
       SET user_id = NULL, contact_email = NULL, updated_at = NOW()
     WHERE user_id = v_uid;

    -- profiles, user_stats, attempts, progress, saved, tests, responses,
    -- flashcard progress, daily activity, coin ledger and achievements all
    -- reference auth.users with ON DELETE CASCADE.
    DELETE FROM auth.users WHERE id = v_uid;

    RETURN jsonb_build_object('deleted', TRUE, 'deleted_at', NOW());
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_consent_cols INT;
    v_appeals INT;
BEGIN
    SELECT COUNT(*) INTO v_consent_cols
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name IN ('age_band', 'guardian_consent', 'terms_version', 'terms_accepted_at');

    SELECT COUNT(*) INTO v_appeals
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'user_appeals';

    RAISE NOTICE 'safety_compliance: consent columns=% appeals table=%',
        v_consent_cols, v_appeals;
END;
$$;

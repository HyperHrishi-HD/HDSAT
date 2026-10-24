-- ============================================================================
-- LIGHT ACCOUNTS (2026-10-26)
-- ============================================================================
-- Email confirmation is no longer a gate. A student can sign in the moment the
-- account exists, and keeps a full working account. What changes is how much
-- the cloud keeps for them: an address that has not entered a verification code
-- is a "light account" and the two per-event ledgers are trimmed.
--
--   * question_attempts keeps its idempotency row but drops the free-text
--     response and the per-item timing (a BEFORE INSERT trigger, so the RPC
--     does not have to know about any of this).
--   * test_responses skips the row entirely; the test summary, score and
--     module state in test_attempts still save, so reports and resume work.
--
-- Verification is proven by Supabase's email OTP (magic-link template, whose
-- 6-digit token the app asks for), then recorded here once with
-- mark_email_verified(). Existing accounts that already confirmed their address
-- are backfilled, so nobody's limits tighten.
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.email_verified_at IS
    'Set once the student proved they own the address with an emailed code. Unverified accounts are light accounts: cloud keeps progress and scores, not per-answer detail.';

-- One-shot backfill, recorded so re-running this file can never promote an
-- account that verified later (or one that was only released by the switch
-- below). `applied_once` is operator bookkeeping: no client privileges, RLS on,
-- no policies.
CREATE TABLE IF NOT EXISTS public.applied_once (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.applied_once ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.applied_once FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.applied_once WHERE name = 'light_accounts_v1') THEN
        RETURN;
    END IF;

    -- Everyone who had genuinely confirmed before today keeps full history.
    UPDATE public.profiles p
       SET email_verified_at = u.email_confirmed_at
      FROM auth.users u
     WHERE u.id = p.user_id
       AND p.email_verified_at IS NULL
       AND u.email_confirmed_at IS NOT NULL;

    -- Accounts that were waiting on a confirmation link are released: the
    -- auth-level confirmation is what blocks a password grant, and sign-in now
    -- must not depend on the address being proven. They stay LIGHT here
    -- (email_verified_at is still null), because nothing proved the address.
    UPDATE auth.users
       SET email_confirmed_at = NOW(),
           updated_at = NOW()
     WHERE email_confirmed_at IS NULL;

    INSERT INTO public.applied_once (name) VALUES ('light_accounts_v1');
END;
$$;

-- ----------------------------------------------------------------------------
-- Is this account verified? Used by the storage triggers below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_email_verified(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT email_verified_at IS NOT NULL
           FROM public.profiles
          WHERE user_id = p_user),
        FALSE
    );
$$;

REVOKE ALL ON FUNCTION public.is_email_verified(UUID) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Record verification. Idempotent: the first success is the permanent answer,
-- and a later call cannot push the date forward.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_email_verified()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_at TIMESTAMPTZ;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    INSERT INTO public.profiles AS p (user_id, email_verified_at)
    VALUES (v_user, NOW())
    ON CONFLICT (user_id) DO UPDATE
        SET email_verified_at = COALESCE(p.email_verified_at, NOW()),
            updated_at = NOW()
    RETURNING p.email_verified_at INTO v_at;

    RETURN v_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_email_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_email_verified() TO authenticated;

-- ----------------------------------------------------------------------------
-- How much of today's mail budget is used. Brevo's free plan allows 300 sends
-- a day; the app stops asking for a new one at 280 so a full inbox cannot turn
-- a verification request into a provider error. Signing in never needs mail.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_send_budget()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH used AS (
        SELECT COALESCE(SUM(send_count), 0)::INTEGER AS n
          FROM public.email_request_log
         WHERE last_sent_at >= date_trunc('day', NOW())
    )
    SELECT jsonb_build_object(
        'used', n,
        'limit', 280,
        'remaining', GREATEST(0, 280 - n),
        'allowed', n < 280
    )
    FROM used;
$$;

REVOKE ALL ON FUNCTION public.email_send_budget() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_send_budget() TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- Storage caps for light accounts
-- ----------------------------------------------------------------------------

-- Keep the idempotency row, drop the payload. The RPC's ON CONFLICT dedupe is
-- what stops a retried request from counting twice, so the row has to exist;
-- it simply stops carrying the student's text and timing.
CREATE OR REPLACE FUNCTION public.compact_light_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_email_verified(NEW.user_id) THEN
        NEW.response := '';
        NEW.time_spent_seconds := 0;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS question_attempts_compact_light ON public.question_attempts;
CREATE TRIGGER question_attempts_compact_light
    BEFORE INSERT ON public.question_attempts
    FOR EACH ROW EXECUTE FUNCTION public.compact_light_attempt();

-- Per-item test responses are the largest thing a single test writes. A light
-- account keeps the attempt row (score, routes, module state) and loses the
-- item-by-item copy. Returning NULL from a BEFORE trigger skips the row.
CREATE OR REPLACE FUNCTION public.skip_light_test_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_email_verified(NEW.user_id) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS test_responses_light_guard ON public.test_responses;
CREATE TRIGGER test_responses_light_guard
    BEFORE INSERT ON public.test_responses
    FOR EACH ROW EXECUTE FUNCTION public.skip_light_test_response();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSWORD CHANGE LIMITS (2026-10-26)
-- ============================================================================
-- Two credential paths, each with its own database-enforced cooldown:
--   password -> change with the current password: 1 per hour
--   email    -> recovery link request:            1 per day
--
-- The browser asks for permission (claim_password_action) before it touches
-- Supabase Auth, then reports the outcome (complete/cancel). The ledger is the
-- authority: a client timer can be cleared, but the RPC recomputes the wait from
-- stored rows every time. Pending rows older than 15 minutes are treated as
-- abandoned so a reload mid-flow cannot lock an account out.
--
-- No direct table access: RLS is on with no policies and every privilege is
-- revoked from anon/authenticated. Only the SECURITY DEFINER functions below
-- may read or write the ledger, and each one scopes itself to auth.uid().
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.password_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    via TEXT NOT NULL CHECK (via IN ('password', 'email')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

COMMENT ON TABLE public.password_change_log IS
    'Password-change and recovery-link attempts. Enforces 1 change/hour and 1 link/day.';

CREATE INDEX IF NOT EXISTS idx_password_change_log_user
    ON public.password_change_log(user_id, via, created_at DESC);

ALTER TABLE public.password_change_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_change_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.password_change_log TO service_role;

-- ----------------------------------------------------------------------------
-- Internal helpers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.password_action_interval(p_via TEXT)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_via = 'password' THEN INTERVAL '1 hour'
        WHEN p_via = 'email' THEN INTERVAL '24 hours'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.password_action_next_allowed(p_user_id UUID, p_via TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT MAX(l.created_at) + public.password_action_interval(p_via)
      FROM public.password_change_log l
     WHERE l.user_id = p_user_id
       AND l.via = p_via
       AND (
             l.status = 'used'
             OR (l.status = 'pending' AND l.created_at >= NOW() - INTERVAL '15 minutes')
           );
$$;

REVOKE ALL ON FUNCTION public.password_action_interval(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.password_action_next_allowed(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- claim: reserve one action, or report the wait that remains
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_password_action(p_via TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_interval INTERVAL := public.password_action_interval(p_via);
    v_next TIMESTAMPTZ;
    v_retry INTEGER;
    v_action_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF v_interval IS NULL THEN
        RAISE EXCEPTION 'Unknown password action %', p_via;
    END IF;

    -- An attempt that was abandoned (tab closed, network died) must not block a
    -- student for the whole window.
    DELETE FROM public.password_change_log
     WHERE user_id = v_user_id
       AND status = 'pending'
       AND created_at < NOW() - INTERVAL '15 minutes';

    v_next := public.password_action_next_allowed(v_user_id, p_via);

    IF v_next IS NOT NULL AND v_next > NOW() THEN
        v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_next - NOW())))::INT);
        RETURN jsonb_build_object(
            'allowed', false,
            'action_id', NULL,
            'next_allowed_at', v_next,
            'retry_after_seconds', v_retry
        );
    END IF;

    INSERT INTO public.password_change_log (user_id, via)
    VALUES (v_user_id, p_via)
    RETURNING id INTO v_action_id;

    RETURN jsonb_build_object(
        'allowed', true,
        'action_id', v_action_id,
        'next_allowed_at', NOW() + v_interval,
        'retry_after_seconds', 0
    );
END;
$$;

COMMENT ON FUNCTION public.claim_password_action(TEXT) IS
    'Reserves one password action for the caller. Refuses inside the cooldown window.';

-- ----------------------------------------------------------------------------
-- complete / cancel: the outcome of a claimed action
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_password_action(p_action_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.password_change_log
       SET status = 'used', used_at = NOW()
     WHERE id = p_action_id
       AND user_id = v_user_id
       AND status = 'pending';

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.complete_password_action(UUID) IS
    'Marks a claimed action as done, starting its cooldown. Only the owner can.';

CREATE OR REPLACE FUNCTION public.cancel_password_action(p_action_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    DELETE FROM public.password_change_log
     WHERE id = p_action_id
       AND user_id = v_user_id
       AND status = 'pending';

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.cancel_password_action(UUID) IS
    'Releases a failed attempt so a rejected password does not start a cooldown.';

-- ----------------------------------------------------------------------------
-- status: what the account page shows before anyone clicks anything
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.password_action_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_password_next TIMESTAMPTZ;
    v_email_next TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_password_next := public.password_action_next_allowed(v_user_id, 'password');
    v_email_next := public.password_action_next_allowed(v_user_id, 'email');

    RETURN jsonb_build_object(
        'password', jsonb_build_object(
            'next_allowed_at', v_password_next,
            'retry_after_seconds', CASE
                WHEN v_password_next IS NULL OR v_password_next <= NOW() THEN 0
                ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_password_next - NOW())))::INT)
            END
        ),
        'email', jsonb_build_object(
            'next_allowed_at', v_email_next,
            'retry_after_seconds', CASE
                WHEN v_email_next IS NULL OR v_email_next <= NOW() THEN 0
                ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_email_next - NOW())))::INT)
            END
        )
    );
END;
$$;

COMMENT ON FUNCTION public.password_action_status() IS
    'Remaining wait for each password path, so the account page never offers a blocked action.';

-- ----------------------------------------------------------------------------
-- Privileges: the caller-facing RPCs only, never the helpers or the table
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_password_action(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_password_action(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_password_action(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_password_action(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_password_action(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_password_action(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.password_action_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.password_action_status() TO authenticated;

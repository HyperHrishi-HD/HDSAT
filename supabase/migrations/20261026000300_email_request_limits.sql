-- ============================================================================
-- EMAIL REQUEST LIMITS (2026-10-26)
-- ============================================================================
-- One recovery link per address per day, enforced before Supabase Auth is
-- asked to send anything. This is deliberately keyed by EMAIL, not by user id,
-- because the most common case is someone who is signed out and cannot
-- authenticate — `password_change_log` cannot cover them.
--
--   kind = 'reset'    recovery link (forgot password)
--   kind = 'confirm'  resend of the signup confirmation code
--
-- Storage stays tiny: one row per address and kind, upserted in place, with a
-- 30-day sweep. Every attempt is recorded whether or not an account exists, so
-- the response cannot be used to discover which addresses are registered.
--
-- This is a best-effort guard, not the last line of defence: the publishable
-- key is public, so a script can still call Supabase Auth directly. The real
-- ceiling is the mail provider's daily quota (Brevo, 300/day).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_request_log (
    email_hash TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('reset', 'confirm')),
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    send_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (email_hash, kind)
);

COMMENT ON TABLE public.email_request_log IS
    'Daily guard for outgoing recovery/confirmation emails. Addresses are stored only as SHA-256 hashes.';

ALTER TABLE public.email_request_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_request_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_request_log TO service_role;

CREATE OR REPLACE FUNCTION public.email_hash(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.email_hash(TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- When may this address send another email of this kind?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_request_next_allowed(p_email TEXT, p_kind TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT last_sent_at + INTERVAL '24 hours'
      FROM public.email_request_log
     WHERE email_hash = public.email_hash(p_email)
       AND kind = p_kind;
$$;

REVOKE ALL ON FUNCTION public.email_request_next_allowed(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_request_next_allowed(TEXT, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- Record a send. Call only AFTER the mail provider accepted the request, so a
-- failed send never locks an address out for a day.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_email_request(p_email TEXT, p_kind TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hash TEXT := public.email_hash(p_email);
    v_next TIMESTAMPTZ;
BEGIN
    IF p_kind NOT IN ('reset', 'confirm') THEN
        RAISE EXCEPTION 'Unknown email request kind';
    END IF;
    IF v_hash IS NULL OR btrim(coalesce(p_email, '')) = '' THEN
        RAISE EXCEPTION 'Email required';
    END IF;

    -- Housekeeping: one row per address per kind, and old rows fall away.
    DELETE FROM public.email_request_log WHERE last_sent_at < NOW() - INTERVAL '30 days';

    INSERT INTO public.email_request_log (email_hash, kind)
    VALUES (v_hash, p_kind)
    ON CONFLICT (email_hash, kind) DO UPDATE
        SET last_sent_at = NOW(),
            send_count = public.email_request_log.send_count + 1
    RETURNING last_sent_at + INTERVAL '24 hours' INTO v_next;

    RETURN jsonb_build_object('next_allowed_at', v_next);
END;
$$;

REVOKE ALL ON FUNCTION public.record_email_request(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_email_request(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

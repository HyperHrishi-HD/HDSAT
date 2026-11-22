-- ============================================================================
-- ONE EMAIL PER ADDRESS PER DAY (2026-10-31)
-- ============================================================================
-- The first version of this guard allowed one confirmation and one recovery
-- link per address per day, independently. A short 90-second cooldown replaced
-- it, which was worse: mail can take minutes to arrive, so "it has not come
-- yet" turned into three sends of the same message from the same student.
--
-- The rule now is the simple one a student can predict:
--
--   * one message per address in any rolling 24 hours, code or link,
--   * the 24 hours is the same window the emailed code and link stay valid in,
--   * the row is written only after the provider accepted the request, so a
--     failed send never locks an address out,
--   * a new window starts once the old one lapsed.
--
-- The app applies the same rule locally (src/lib/emailAllowance.ts), so a stale
-- function here can never re-open the door to repeated sends.
--
-- Note on the key: the table is keyed by (email_hash, kind) because both rows
-- are useful for the daily budget count. "Next allowed" deliberately looks at
-- the newest row of EITHER kind, which is what makes the allowance shared.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.email_request_next_allowed(p_email TEXT, p_kind TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT MAX(last_sent_at) + INTERVAL '24 hours'
      FROM public.email_request_log
     WHERE email_hash = public.email_hash(p_email);
$$;

REVOKE ALL ON FUNCTION public.email_request_next_allowed(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_request_next_allowed(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_email_request(p_email TEXT, p_kind TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hash TEXT := public.email_hash(p_email);
    v_last TIMESTAMPTZ;
    v_next TIMESTAMPTZ;
BEGIN
    IF p_kind NOT IN ('reset', 'confirm') THEN
        RAISE EXCEPTION 'Unknown email request kind';
    END IF;
    IF v_hash IS NULL OR btrim(coalesce(p_email, '')) = '' THEN
        RAISE EXCEPTION 'Email required';
    END IF;

    -- Housekeeping: rows older than the sweep window cannot block anything.
    DELETE FROM public.email_request_log WHERE last_sent_at < NOW() - INTERVAL '30 days';

    -- The most recent message to this address, of either kind.
    SELECT MAX(last_sent_at) INTO v_last
      FROM public.email_request_log
     WHERE email_hash = v_hash;

    IF v_last IS NOT NULL AND v_last > NOW() - INTERVAL '24 hours' THEN
        -- Already spent today. Report the wait rather than writing a second row.
        RETURN jsonb_build_object(
            'next_allowed_at', v_last + INTERVAL '24 hours',
            'send_count', 0,
            'refused', true
        );
    END IF;

    INSERT INTO public.email_request_log (email_hash, kind, last_sent_at, send_count)
    VALUES (v_hash, p_kind, NOW(), 1)
    ON CONFLICT (email_hash, kind) DO UPDATE
        SET last_sent_at = NOW(),
            send_count = 1;

    v_next := NOW() + INTERVAL '24 hours';

    RETURN jsonb_build_object('next_allowed_at', v_next, 'send_count', 1, 'refused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_email_request(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_email_request(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

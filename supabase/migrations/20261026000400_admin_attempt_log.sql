-- ============================================================================
-- ADMIN SIGN-IN ATTEMPT LOG (2026-10-26)
-- ============================================================================
-- Wrong-passcode attempts are recorded where the operator can see and delete
-- them. Two rules keep the table small and useful:
--
--   1. One row per device, not one row per try. The device is the browser's
--      user agent plus the client IP, both read from the request headers that
--      PostgREST forwards (verified: cf-connecting-ip / x-forwarded-for and
--      user-agent are present). Nothing is supplied by the browser, so the
--      address cannot be spoofed by the client.
--   2. One counter per device: the first attempt inserts, later attempts only
--      bump `attempts` and `last_seen_at`.
--
-- The table is capped at 100 devices; the oldest row is dropped on insert.
-- Either row source can delete rows, individually or all at once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
    id BIGSERIAL PRIMARY KEY,
    device_key TEXT NOT NULL UNIQUE,
    ip TEXT NOT NULL,
    device TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.admin_login_attempts IS
    'Wrong operator passcodes, one row per device (IP + user agent).';

ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_login_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_login_attempts TO service_role;

-- ----------------------------------------------------------------------------
-- UNLOCK (same signature as before, now writes the attempt log on failure)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_unlock(TEXT, UUID, BIGINT);

CREATE OR REPLACE FUNCTION public.admin_unlock(
    p_passcode TEXT,
    p_challenge_id UUID,
    p_nonce BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_gate public.admin_gate%ROWTYPE;
    v_challenge public.admin_pow_challenges%ROWTYPE;
    v_digest TEXT;
    v_token TEXT;
    v_token_hash TEXT;
    v_expires TIMESTAMPTZ := NOW() + INTERVAL '8 hours';
    v_headers JSONB;
    v_ip TEXT;
    v_device TEXT;
    v_key TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in before opening the operator console';
    END IF;

    IF p_challenge_id IS NULL OR p_nonce IS NULL OR p_nonce < 0 THEN
        RETURN jsonb_build_object('ok', FALSE, 'message', 'Complete the human check first.');
    END IF;

    SELECT * INTO v_challenge
    FROM public.admin_pow_challenges
    WHERE id = p_challenge_id
    FOR UPDATE;

    IF NOT FOUND OR v_challenge.used_at IS NOT NULL OR v_challenge.expires_at < NOW() THEN
        RETURN jsonb_build_object('ok', FALSE, 'message', 'The human check expired. Try again.');
    END IF;

    -- Single use: burn it before any passcode comparison.
    UPDATE public.admin_pow_challenges SET used_at = NOW() WHERE id = v_challenge.id;

    v_digest := encode(digest(v_challenge.salt || p_nonce::TEXT, 'sha256'), 'hex');
    IF left(v_digest, v_challenge.difficulty) <> repeat('0', v_challenge.difficulty) THEN
        RETURN jsonb_build_object('ok', FALSE, 'message', 'The human check did not pass. Try again.');
    END IF;

    SELECT * INTO v_gate FROM public.admin_gate WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator passcode has not been set up yet';
    END IF;

    IF v_gate.locked_until IS NOT NULL AND v_gate.locked_until > NOW() THEN
        RETURN jsonb_build_object(
            'ok', FALSE,
            'locked_seconds', ceil(extract(epoch FROM (v_gate.locked_until - NOW())))::INTEGER,
            'message', 'Too many wrong attempts. Try again in a few minutes.'
        );
    END IF;

    IF crypt(coalesce(p_passcode, ''), v_gate.passcode_hash) <> v_gate.passcode_hash THEN
        UPDATE public.admin_gate
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE
                    WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
                    ELSE locked_until
                END,
                updated_at = NOW()
            WHERE id = 1
            RETURNING * INTO v_gate;

        -- One row per device: IP and user agent come from the request headers.
        v_headers := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
        v_ip := coalesce(
            nullif(btrim(split_part(coalesce(v_headers->>'cf-connecting-ip', ''), ',', 1)), ''),
            nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), ''),
            'unknown'
        );
        v_device := left(coalesce(nullif(btrim(v_headers->>'user-agent'), ''), 'unknown'), 200);
        v_key := encode(digest(v_ip || '|' || v_device, 'sha256'), 'hex');

        INSERT INTO public.admin_login_attempts (device_key, ip, device)
        VALUES (v_key, v_ip, v_device)
        ON CONFLICT (device_key) DO UPDATE
            SET attempts = public.admin_login_attempts.attempts + 1,
                last_seen_at = NOW(),
                ip = EXCLUDED.ip,
                device = EXCLUDED.device;

        -- Bounded: keep the 100 most recent devices only.
        DELETE FROM public.admin_login_attempts
         WHERE id NOT IN (
             SELECT id FROM public.admin_login_attempts
             ORDER BY last_seen_at DESC
             LIMIT 100
         );

        INSERT INTO public.admin_access_log (event)
        VALUES (CASE WHEN v_gate.locked_until IS NOT NULL AND v_gate.locked_until > NOW()
                     THEN 'locked' ELSE 'unlock_fail' END);

        RETURN jsonb_build_object(
            'ok', FALSE,
            'attempts_left', GREATEST(0, 5 - v_gate.failed_attempts),
            'message', 'Wrong passcode.'
        );
    END IF;

    UPDATE public.admin_gate
        SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
        WHERE id = 1;

    DELETE FROM public.admin_unlock_tokens WHERE expires_at < NOW();

    v_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
    INSERT INTO public.admin_unlock_tokens (token_hash, expires_at)
    VALUES (v_token_hash, v_expires);

    INSERT INTO public.admin_access_log (event) VALUES ('unlock_ok');

    RETURN jsonb_build_object('ok', TRUE, 'token', v_token, 'expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlock(TEXT, UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlock(TEXT, UUID, BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- LIST / DELETE (console only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_login_attempts(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_items JSONB;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    SELECT coalesce(jsonb_agg(row ORDER BY row->>'last_seen_at' DESC), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT jsonb_build_object(
                   'id', id,
                   'ip', ip,
                   'device', device,
                   'attempts', attempts,
                   'first_seen_at', first_seen_at,
                   'last_seen_at', last_seen_at
               ) AS row
          FROM public.admin_login_attempts
         ORDER BY last_seen_at DESC
         LIMIT 100
      ) rows;

    RETURN jsonb_build_object('items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_login_attempts(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_login_attempts(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_login_attempt(p_token TEXT, p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);
    DELETE FROM public.admin_login_attempts WHERE id = p_id;
    RETURN jsonb_build_object('deleted', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_login_attempt(TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_login_attempt(TEXT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_login_attempts(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);
    -- `WHERE id IS NOT NULL` is not decoration: Supabase runs with
    -- safeupdate on, and a bare DELETE is refused with error 21000.
    DELETE FROM public.admin_login_attempts WHERE id IS NOT NULL;
    RETURN jsonb_build_object('cleared', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_login_attempts(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_login_attempts(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

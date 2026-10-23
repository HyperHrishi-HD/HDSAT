-- ============================================================================
-- HDSAT — self-hosted human check on the operator gate
-- ============================================================================
-- The console no longer uses an arithmetic captcha or a third-party widget.
-- `admin_human_check()` issues a random salt and a difficulty; the browser must
-- find a nonce whose SHA-256(salt || nonce) starts with that many zero nibbles.
-- Verification happens inside `admin_unlock`, the challenge is single-use and
-- expires after ten minutes, and a solved challenge is burned whatever the
-- passcode outcome is.
--
-- Difficulty 4 (about 65k hashes) keeps the check near 0.3s on a phone while
-- still making scripted guessing cost real CPU. The passcode lockout remains
-- the primary defence.
-- ============================================================================

-- Earlier iterations (reCAPTCHA) are removed if they were applied.
DROP FUNCTION IF EXISTS public.admin_recaptcha_config();
DROP FUNCTION IF EXISTS public.set_admin_recaptcha(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_unlock(TEXT, TEXT);
DROP TABLE IF EXISTS public.admin_settings;

CREATE TABLE IF NOT EXISTS public.admin_pow_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salt TEXT NOT NULL,
    difficulty SMALLINT NOT NULL DEFAULT 4 CHECK (difficulty BETWEEN 3 AND 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
    used_at TIMESTAMPTZ
);

ALTER TABLE public.admin_pow_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_pow_challenges FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. ISSUE A CHALLENGE (signed-in users only; the console is still locked)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_human_check()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id UUID;
    v_salt TEXT;
    v_difficulty SMALLINT := 4;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in before opening the operator console';
    END IF;

    -- Housekeeping: a bounded table.
    DELETE FROM public.admin_pow_challenges WHERE expires_at < NOW() - INTERVAL '1 hour';

    INSERT INTO public.admin_pow_challenges (salt, difficulty)
    VALUES (encode(gen_random_bytes(16), 'hex'), v_difficulty)
    RETURNING id, salt, difficulty INTO v_id, v_salt, v_difficulty;

    RETURN jsonb_build_object(
        'id', v_id,
        'salt', v_salt,
        'difficulty', v_difficulty
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_human_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_human_check() TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. UNLOCK: session + solved challenge + passcode
-- ----------------------------------------------------------------------------
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

NOTIFY pgrst, 'reload schema';

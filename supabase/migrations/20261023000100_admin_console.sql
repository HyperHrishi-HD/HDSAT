-- ============================================================================
-- HDSAT OPERATOR CONSOLE MIGRATION
-- ============================================================================
-- The console is protected by a passcode that is stored ONLY as a bcrypt hash,
-- never in the repository and never in plaintext in the database. Access needs
-- three things together:
--   1. a signed-in Supabase session (any account, so the console is not tied to
--      one person's email),
--   2. a single-use server-issued captcha challenge answered correctly,
--   3. the operator passcode.
-- A correct unlock issues a random 32-byte token (stored hashed) that every
-- admin RPC requires and that expires after 8 hours. Five wrong passcodes lock
-- the gate for 15 minutes and are logged.
--
-- Set the passcode once from the SQL editor or with the service key:
--   SELECT public.set_admin_passcode('choose-a-long-passphrase');
-- It is never echoed back, and no function returns it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. PASSCODE GATE STATE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_gate (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    passcode_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_captcha (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
    used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.admin_unlock_tokens (
    token_hash TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_access_log (
    id BIGSERIAL PRIMARY KEY,
    event TEXT NOT NULL CHECK (event IN ('unlock_ok', 'unlock_fail', 'locked', 'locked_out')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nothing here is client-readable. Every read goes through a function.
ALTER TABLE public.admin_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_captcha ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_unlock_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_gate FROM anon, authenticated;
REVOKE ALL ON public.admin_captcha FROM anon, authenticated;
REVOKE ALL ON public.admin_unlock_tokens FROM anon, authenticated;
REVOKE ALL ON public.admin_access_log FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. SET THE PASSCODE (operator only: SQL editor or service_role key)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_admin_passcode(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
        RAISE EXCEPTION 'Only the SQL editor or a service key may set the operator passcode';
    END IF;
    IF length(coalesce(p_code, '')) < 4 THEN
        RAISE EXCEPTION 'The operator passcode must be at least 4 characters';
    END IF;

    INSERT INTO public.admin_gate (id, passcode_hash, failed_attempts, locked_until, updated_at)
    VALUES (1, crypt(p_code, gen_salt('bf', 12)), 0, NULL, NOW())
    ON CONFLICT (id) DO UPDATE
        SET passcode_hash = crypt(p_code, gen_salt('bf', 12)),
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = NOW();

    -- A passcode change invalidates every outstanding console session.
    -- `WHERE TRUE` keeps Supabase's pg-safeupdate guard happy.
    DELETE FROM public.admin_unlock_tokens WHERE TRUE;
    RETURN jsonb_build_object('updated', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_passcode(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_passcode(TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. CAPTCHA CHALLENGE (single use, hashed answer, five-minute lifetime)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_captcha_challenge()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_a INTEGER := 2 + floor(random() * 18)::INTEGER;
    v_b INTEGER := 2 + floor(random() * 18)::INTEGER;
    v_question TEXT;
    v_answer TEXT;
    v_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_gate WHERE id = 1) THEN
        RAISE EXCEPTION 'The operator passcode has not been set up yet';
    END IF;

    IF random() < 0.5 THEN
        v_question := v_a || ' + ' || v_b;
        v_answer := (v_a + v_b)::TEXT;
    ELSE
        IF v_b > v_a THEN
            v_question := v_b || ' - ' || v_a;
            v_answer := (v_b - v_a)::TEXT;
        ELSE
            v_question := v_a || ' - ' || v_b;
            v_answer := (v_a - v_b)::TEXT;
        END IF;
    END IF;

    -- Housekeeping: keep the table small.
    DELETE FROM public.admin_captcha WHERE expires_at < NOW() - INTERVAL '1 hour';

    INSERT INTO public.admin_captcha (question, answer_hash)
    VALUES (v_question, encode(digest(v_answer, 'sha256'), 'hex'))
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'question', 'What is ' || v_question || '?');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_captcha_challenge() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. UNLOCK: session + captcha + bcrypt passcode -> hashed token
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_unlock(
    p_passcode TEXT,
    p_captcha_id UUID,
    p_captcha_answer TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_gate public.admin_gate%ROWTYPE;
    v_captcha public.admin_captcha%ROWTYPE;
    v_answer_hash TEXT;
    v_token TEXT;
    v_token_hash TEXT;
    v_expires TIMESTAMPTZ := NOW() + INTERVAL '8 hours';
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in before opening the operator console';
    END IF;

    SELECT * INTO v_gate FROM public.admin_gate WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator passcode has not been set up yet';
    END IF;

    IF v_gate.locked_until IS NOT NULL AND v_gate.locked_until > NOW() THEN
        RETURN jsonb_build_object(
            'ok', FALSE,
            'locked_seconds', ceil(extract(epoch FROM (v_gate.locked_until - NOW())))::INTEGER,
            'message', 'Too many wrong attempts. The console is locked for a few minutes.'
        );
    END IF;

    SELECT * INTO v_captcha FROM public.admin_captcha WHERE id = p_captcha_id;
    IF NOT FOUND OR v_captcha.used_at IS NOT NULL OR v_captcha.expires_at < NOW() THEN
        RETURN jsonb_build_object('ok', FALSE, 'message', 'That captcha expired. Request a new one.');
    END IF;

    -- Single use: burn the challenge whatever the outcome.
    UPDATE public.admin_captcha SET used_at = NOW() WHERE id = v_captcha.id;

    v_answer_hash := encode(digest(trim(coalesce(p_captcha_answer, '')), 'sha256'), 'hex');
    IF v_answer_hash <> v_captcha.answer_hash THEN
        INSERT INTO public.admin_access_log (event) VALUES ('unlock_fail');
        RETURN jsonb_build_object('ok', FALSE, 'message', 'That captcha answer is not right.');
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

GRANT EXECUTE ON FUNCTION public.admin_unlock(TEXT, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_session_valid(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF auth.uid() IS NULL OR coalesce(p_token, '') = '' THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.admin_unlock_tokens
        WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
          AND expires_at > NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_session_valid(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_lock(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    DELETE FROM public.admin_unlock_tokens
    WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
    RETURN jsonb_build_object('locked', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_lock(TEXT) TO authenticated;

-- Internal guard for every admin routine below.
CREATE OR REPLACE FUNCTION public.assert_admin_unlocked(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in before using the operator console';
    END IF;
    IF coalesce(p_token, '') = '' THEN
        RAISE EXCEPTION 'Unlock the operator console first';
    END IF;
    UPDATE public.admin_unlock_tokens
        SET last_seen_at = NOW()
        WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
          AND expires_at > NOW();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Your console session expired. Unlock again.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_unlocked(TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. REPORT TRIAGE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_reports(
    p_token TEXT,
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_items JSONB;
    v_total INTEGER;
    v_open INTEGER;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    SELECT COUNT(*) INTO v_total
    FROM public.question_reports r
    WHERE (p_status IS NULL OR r.status = p_status)
      AND (p_reason IS NULL OR r.reason = p_reason);

    SELECT COUNT(*) INTO v_open
    FROM public.question_reports r
    WHERE r.status IN ('received', 'in_review');

    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::JSONB)
    INTO v_items
    FROM (
        SELECT jsonb_build_object(
            'id', r.id,
            'question_id', r.question_id,
            'reason', r.reason,
            'details', r.details,
            'contact_email', r.contact_email,
            'status', r.status,
            'created_at', r.created_at,
            'reporter_name', p.display_name
        ) AS row
        FROM public.question_reports r
        LEFT JOIN public.profiles p ON p.user_id = r.user_id
        WHERE (p_status IS NULL OR r.status = p_status)
          AND (p_reason IS NULL OR r.reason = p_reason)
        ORDER BY r.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ) sub;

    RETURN jsonb_build_object('total', v_total, 'open', v_open, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_reports(TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_report_status(p_token TEXT, p_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);
    IF p_status NOT IN ('received', 'in_review', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Unsupported report status %', p_status;
    END IF;
    UPDATE public.question_reports SET status = p_status WHERE id = p_id;
    RETURN jsonb_build_object('updated', FOUND, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_report_status(TEXT, UUID, TEXT) TO authenticated;

-- Batch delete. At least one filter must be given so a stray call cannot empty
-- the table: pass p_ids, or p_user_id (every report from one spammer), or a
-- status together with p_older_than_days for routine cleanup.
CREATE OR REPLACE FUNCTION public.admin_batch_delete_reports(
    p_token TEXT,
    p_ids UUID[] DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_older_than_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER := 0;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    IF p_ids IS NULL AND p_user_id IS NULL
       AND (p_status IS NULL OR p_older_than_days IS NULL) THEN
        RAISE EXCEPTION 'Refusing to delete every report: give ids, a user, or a status with an age';
    END IF;

    DELETE FROM public.question_reports r
    WHERE (p_ids IS NOT NULL AND r.id = ANY (p_ids))
       OR (p_ids IS NULL
           AND p_user_id IS NOT NULL
           AND r.user_id = p_user_id
           AND (p_status IS NULL OR r.status = p_status)
           AND (p_older_than_days IS NULL
                OR r.created_at < NOW() - (p_older_than_days || ' days')::INTERVAL))
       OR (p_ids IS NULL AND p_user_id IS NULL
           AND p_status IS NOT NULL
           AND p_older_than_days IS NOT NULL
           AND r.status = p_status
           AND r.created_at < NOW() - (p_older_than_days || ' days')::INTERVAL);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_batch_delete_reports(TEXT, UUID[], UUID, TEXT, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. APPEAL TRIAGE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_appeals(
    p_token TEXT,
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_items JSONB;
    v_total INTEGER;
    v_open INTEGER;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    SELECT COUNT(*) INTO v_total
    FROM public.user_appeals a
    WHERE (p_status IS NULL OR a.status = p_status);

    SELECT COUNT(*) INTO v_open
    FROM public.user_appeals a
    WHERE a.status IN ('received', 'in_review');

    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::JSONB)
    INTO v_items
    FROM (
        SELECT jsonb_build_object(
            'id', a.id,
            'reference', a.reference,
            'category', a.category,
            'subject', a.subject,
            'details', a.details,
            'contact_email', a.contact_email,
            'status', a.status,
            'created_at', a.created_at,
            'reporter_name', p.display_name
        ) AS row
        FROM public.user_appeals a
        LEFT JOIN public.profiles p ON p.user_id = a.user_id
        WHERE (p_status IS NULL OR a.status = p_status)
        ORDER BY a.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ) sub;

    RETURN jsonb_build_object('total', v_total, 'open', v_open, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_appeals(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_appeal_status(p_token TEXT, p_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);
    IF p_status NOT IN ('received', 'in_review', 'resolved', 'rejected') THEN
        RAISE EXCEPTION 'Unsupported appeal status %', p_status;
    END IF;
    UPDATE public.user_appeals
        SET status = p_status, updated_at = NOW()
        WHERE id = p_id;
    RETURN jsonb_build_object('updated', FOUND, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_appeal_status(TEXT, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_batch_delete_appeals(
    p_token TEXT,
    p_ids UUID[] DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_older_than_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER := 0;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    IF p_ids IS NULL AND p_user_id IS NULL
       AND (p_status IS NULL OR p_older_than_days IS NULL) THEN
        RAISE EXCEPTION 'Refusing to delete every appeal: give ids, a user, or a status with an age';
    END IF;

    DELETE FROM public.user_appeals a
    WHERE (p_ids IS NOT NULL AND a.id = ANY (p_ids))
       OR (p_ids IS NULL
           AND p_user_id IS NOT NULL
           AND a.user_id = p_user_id
           AND (p_status IS NULL OR a.status = p_status)
           AND (p_older_than_days IS NULL
                OR a.created_at < NOW() - (p_older_than_days || ' days')::INTERVAL))
       OR (p_ids IS NULL AND p_user_id IS NULL
           AND p_status IS NOT NULL
           AND p_older_than_days IS NOT NULL
           AND a.status = p_status
           AND a.created_at < NOW() - (p_older_than_days || ' days')::INTERVAL);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_batch_delete_appeals(TEXT, UUID[], UUID, TEXT, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. REPLIES BECOME ONE-TIME DASHBOARD NOTIFICATIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reply_to_report(
    p_token TEXT,
    p_report_id UUID,
    p_title TEXT,
    p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_delivered BOOLEAN := FALSE;
    v_notification_id UUID;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    IF length(trim(COALESCE(p_body, ''))) = 0 THEN
        RAISE EXCEPTION 'A reply needs a message';
    END IF;

    SELECT user_id INTO v_user_id FROM public.question_reports WHERE id = p_report_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such report';
    END IF;

    UPDATE public.question_reports SET status = 'in_review' WHERE id = p_report_id;

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.user_notifications (user_id, kind, title, body, reference)
        VALUES (
            v_user_id,
            'admin_reply',
            COALESCE(NULLIF(trim(p_title), ''), 'Reply to your question report'),
            left(trim(p_body), 4000),
            p_report_id::TEXT
        )
        RETURNING id INTO v_notification_id;
        v_delivered := TRUE;
    END IF;

    RETURN jsonb_build_object('delivered', v_delivered, 'notification_id', v_notification_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reply_to_report(TEXT, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reply_to_appeal(
    p_token TEXT,
    p_appeal_id UUID,
    p_title TEXT,
    p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_reference TEXT;
    v_delivered BOOLEAN := FALSE;
    v_notification_id UUID;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    IF length(trim(COALESCE(p_body, ''))) = 0 THEN
        RAISE EXCEPTION 'A reply needs a message';
    END IF;

    SELECT user_id, reference INTO v_user_id, v_reference
    FROM public.user_appeals WHERE id = p_appeal_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such appeal';
    END IF;

    UPDATE public.user_appeals SET status = 'in_review', updated_at = NOW() WHERE id = p_appeal_id;

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.user_notifications (user_id, kind, title, body, reference)
        VALUES (
            v_user_id,
            'admin_reply',
            COALESCE(NULLIF(trim(p_title), ''), 'Reply to your appeal'),
            left(trim(p_body), 4000),
            v_reference
        )
        RETURNING id INTO v_notification_id;
        v_delivered := TRUE;
    END IF;

    RETURN jsonb_build_object('delivered', v_delivered, 'notification_id', v_notification_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reply_to_appeal(TEXT, UUID, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. STUDENT ROSTER (aggregate only, no progress contents)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_students(
    p_token TEXT,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_items JSONB;
    v_total INTEGER;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    SELECT COUNT(*) INTO v_total FROM public.profiles;

    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::JSONB)
    INTO v_items
    FROM (
        SELECT jsonb_build_object(
            'user_id', p.user_id,
            'display_name', p.display_name,
            'confirmed', (p.terms_accepted_at IS NOT NULL),
            'age_band', p.age_band,
            'created_at', p.created_at,
            'hd_coins', COALESCE(s.hd_coins, 0),
            'current_streak', COALESCE(s.current_streak, 0),
            'total_attempts', COALESCE(s.total_attempts, 0),
            'report_count', (
                SELECT COUNT(*) FROM public.question_reports r WHERE r.user_id = p.user_id
            )
        ) AS row
        FROM public.profiles p
        LEFT JOIN public.user_stats s ON s.user_id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ) sub;

    RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_students(TEXT, INTEGER, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. STUDENT NOTIFICATIONS (one card per operator reply)
-- ----------------------------------------------------------------------------
-- Written only by the SECURITY DEFINER reply functions above; a student can read
-- and dismiss their own rows and nothing else.
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'admin_reply',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
    ON public.user_notifications (user_id, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notifications FROM anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;

DROP POLICY IF EXISTS user_notifications_read_own ON public.user_notifications;
CREATE POLICY user_notifications_read_own ON public.user_notifications
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Dismissing a card marks every unseen row read, so a reply is shown once.
CREATE OR REPLACE FUNCTION public.mark_my_notifications_seen()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN 0;
    END IF;
    UPDATE public.user_notifications
        SET seen_at = NOW()
        WHERE user_id = auth.uid() AND seen_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_my_notifications_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_notifications_seen() TO authenticated;

-- ----------------------------------------------------------------------------
-- Hardening: `CREATE FUNCTION` grants EXECUTE to PUBLIC by default, which would
-- let an anonymous visitor reach these endpoints (they would still need the
-- passcode + captcha, but they should not be callable at all). Revoke the
-- implicit grant from PUBLIC/anon and keep it only for authenticated sessions.
-- `assert_admin_unlocked` is an internal helper and must not be callable
-- directly by any client role.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (
              p.proname LIKE 'admin\_%'
              OR p.proname IN ('set_admin_passcode', 'assert_admin_unlocked')
          )
          AND EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              JOIN pg_roles ro ON ro.oid = a.grantee
              WHERE ro.rolname = 'anon'
          )
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.signature);
    END LOOP;
END;
$$;

-- Make PostgREST pick up the new tables/functions immediately.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NEXT STEPS (run as the operator, never committed):
--   SELECT public.set_admin_passcode('...');
-- ============================================================================

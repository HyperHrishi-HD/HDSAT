-- ============================================================================
-- HDSAT OPERATOR CONSOLE MIGRATION
-- ============================================================================
-- Wires the /admin review console to real data without ever shipping a service
-- key to the browser:
--   1. profiles.is_admin — the only flag that unlocks triage, guarded so a
--      signed-in student cannot promote themselves.
--   2. public.user_notifications — one row per operator reply, read by the
--      student's Dashboard exactly once.
--   3. SECURITY DEFINER admin RPCs: list, filter, resolve, batch-delete and
--      reply for question reports and appeals, plus a student roster.
--
-- Idempotent: safe to re-run. Applying this migration does NOT grant anyone
-- admin access; run the UPDATE at the bottom with your own user id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADMIN FLAG
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.guard_is_admin_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'is_admin is operator-managed and cannot be changed from a signed-in client';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_is_admin ON public.profiles;
CREATE TRIGGER profiles_guard_is_admin
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_is_admin_flag();

-- ----------------------------------------------------------------------------
-- 2. USER NOTIFICATIONS (operator replies land here)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'admin_reply'
        CHECK (kind IN ('admin_reply', 'system')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_notifications_user_idx
    ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unseen_idx
    ON public.user_notifications (user_id) WHERE seen_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.user_notifications;
CREATE POLICY "Users read own notifications" ON public.user_notifications
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users mark own notifications seen" ON public.user_notifications;
CREATE POLICY "Users mark own notifications seen" ON public.user_notifications
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- A student may only ever write the seen_at column; the body is operator text.
REVOKE ALL ON public.user_notifications FROM anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT UPDATE (seen_at) ON public.user_notifications TO authenticated;

-- Marks every unseen notification read for the caller. Used by the Dashboard.
CREATE OR REPLACE FUNCTION public.mark_my_notifications_seen()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_count INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    UPDATE public.user_notifications
        SET seen_at = NOW()
        WHERE user_id = v_user_id AND seen_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_my_notifications_seen() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. ADMIN GUARDS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT p.is_admin FROM public.profiles p WHERE p.user_id = auth.uid()),
        FALSE
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Every admin routine starts with this so a missing RPC grant can never become
-- a data leak. The response shape is stable so the console can render it.
CREATE OR REPLACE FUNCTION public.assert_is_admin()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Operator access required';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. REPORT TRIAGE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_reports(
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
    PERFORM public.assert_is_admin();

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
            'reporter_name', p.display_name,
            'reporter_email', u.email
        ) AS row
        FROM public.question_reports r
        LEFT JOIN public.profiles p ON p.user_id = r.user_id
        LEFT JOIN auth.users u ON u.id = r.user_id
        WHERE (p_status IS NULL OR r.status = p_status)
          AND (p_reason IS NULL OR r.reason = p_reason)
        ORDER BY r.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ) sub;

    RETURN jsonb_build_object('total', v_total, 'open', v_open, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_reports(TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_report_status(p_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_is_admin();
    IF p_status NOT IN ('received', 'in_review', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Unsupported report status %', p_status;
    END IF;
    UPDATE public.question_reports SET status = p_status WHERE id = p_id;
    RETURN jsonb_build_object('updated', FOUND, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_report_status(UUID, TEXT) TO authenticated;

-- Batch delete. At least one filter must be given so a stray call cannot empty
-- the table: pass p_ids, or p_user_id (every report from one spammer), or a
-- status with p_older_than_days for routine cleanup.
CREATE OR REPLACE FUNCTION public.admin_batch_delete_reports(
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
    PERFORM public.assert_is_admin();

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

GRANT EXECUTE ON FUNCTION public.admin_batch_delete_reports(UUID[], UUID, TEXT, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. APPEAL TRIAGE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_appeals(
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
    PERFORM public.assert_is_admin();

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
            'reporter_name', p.display_name,
            'reporter_email', u.email
        ) AS row
        FROM public.user_appeals a
        LEFT JOIN public.profiles p ON p.user_id = a.user_id
        LEFT JOIN auth.users u ON u.id = a.user_id
        WHERE (p_status IS NULL OR a.status = p_status)
        ORDER BY a.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ) sub;

    RETURN jsonb_build_object('total', v_total, 'open', v_open, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_appeals(TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_appeal_status(p_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_is_admin();
    IF p_status NOT IN ('received', 'in_review', 'resolved', 'rejected') THEN
        RAISE EXCEPTION 'Unsupported appeal status %', p_status;
    END IF;
    UPDATE public.user_appeals
        SET status = p_status, updated_at = NOW()
        WHERE id = p_id;
    RETURN jsonb_build_object('updated', FOUND, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_appeal_status(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_batch_delete_appeals(
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
    PERFORM public.assert_is_admin();

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

GRANT EXECUTE ON FUNCTION public.admin_batch_delete_appeals(UUID[], UUID, TEXT, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. REPLIES BECOME ONE-TIME DASHBOARD NOTIFICATIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reply_to_report(
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
    PERFORM public.assert_is_admin();

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

    RETURN jsonb_build_object(
        'delivered', v_delivered,
        'notification_id', v_notification_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reply_to_report(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reply_to_appeal(
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
    PERFORM public.assert_is_admin();

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

    RETURN jsonb_build_object(
        'delivered', v_delivered,
        'notification_id', v_notification_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reply_to_appeal(UUID, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. STUDENT ROSTER (aggregate only, no progress contents)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_students(
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
    PERFORM public.assert_is_admin();

    SELECT COUNT(*) INTO v_total FROM public.profiles;

    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::JSONB)
    INTO v_items
    FROM (
        SELECT jsonb_build_object(
            'user_id', p.user_id,
            'display_name', p.display_name,
            'email', u.email,
            'confirmed', (u.email_confirmed_at IS NOT NULL),
            'is_admin', p.is_admin,
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
        LEFT JOIN auth.users u ON u.id = p.user_id
        LEFT JOIN public.user_stats s ON s.user_id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ) sub;

    RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_students(INTEGER, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. GRANT YOURSELF OPERATOR ACCESS
-- ----------------------------------------------------------------------------
-- After applying this file, run once in the Supabase SQL editor with your own
-- account email (the SQL editor has no JWT, so the guard allows it):
--
--   UPDATE public.profiles
--      SET is_admin = TRUE
--    WHERE user_id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
--
-- To revoke: set it back to FALSE the same way.

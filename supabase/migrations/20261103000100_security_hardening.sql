-- ============================================================================
-- SECURITY HARDENING (2026-11-03)
-- ============================================================================
-- The browser holds the publishable key, so "the client would not send that" is
-- not a control. `tools/security_audit.py` reads the live catalog the way an
-- attacker would and found three places where a row policy was doing work a
-- column privilege should have been doing:
--
--   1. profiles: UPDATE was granted on the whole row, so a student could PATCH
--      their own `email_verified_at` (which lifts every light-account cap) or
--      write `unlocked_cosmetics` without paying. Only the preferences the
--      Account page really edits are writable now; the row policy stays,
--      because it is what scopes the update to the caller.
--   2. user_question_progress: UPDATE was granted on the whole row, so mastery,
--      correct counts and streak history could be rewritten from devtools. The
--      only writer is `submit_question_attempt`, which is SECURITY DEFINER and
--      therefore unaffected by this policy.
--   3. complete_activity_session trusted the browser's "I got 12 of 12", so a
--      mini-game or session reward could be claimed for answers the server never
--      graded. The graded modes are now bounded by the attempts actually graded
--      for that account in the same window. Mini-games are exempt: their coins
--      come from play, not from a graded attempt ledger.
--
-- Re-run `python tools/security_audit.py` after applying: it must report no
-- failures.
-- ============================================================================

-- ---- 1. profiles: preferences yes, verification no --------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- The client never creates its own profiles row: every path that needs one goes
-- through a SECURITY DEFINER function that inserts it first. Dropping the insert
-- policy removes the only way to arrive with `email_verified_at` already set.
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, preferred_exam, target_test_date, updated_at)
    ON TABLE public.profiles TO authenticated;

-- ---- 2. question progress: server-written only ----------------------------
DROP POLICY IF EXISTS "Users update own question flag" ON public.user_question_progress;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_question_progress
    FROM anon, authenticated;

-- ---- 3. session rewards bounded by graded attempts ------------------------
CREATE OR REPLACE FUNCTION public.complete_activity_session(
    p_activity_type TEXT,
    p_session_id TEXT,
    p_questions_count INTEGER,
    p_correct_count INTEGER,
    p_time_spent_seconds INTEGER,
    p_local_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_reward INTEGER := 0;
    v_daily_cat_count INTEGER := 0;
    v_reason TEXT;
    v_accuracy NUMERIC;
    v_correct INTEGER;
    v_questions INTEGER;
    v_recorded_correct INTEGER := 0;
    v_stats RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_questions := GREATEST(COALESCE(p_questions_count, 0), 0);
    v_correct := LEAST(GREATEST(COALESCE(p_correct_count, 0), 0), v_questions);

    -- A session summary is a claim, not evidence. For the modes whose answers
    -- are graded and stored one at a time, the claim cannot exceed what the
    -- server actually graded for this account in the same window. The window
    -- reaches back a day so a run that spans local midnight, or a sync that
    -- landed late, is not punished; the clamp only ever lowers a count.
    IF p_activity_type IN ('practice_rush', 'timed_session', 'full_simulation') THEN
        SELECT COUNT(*) FILTER (WHERE is_correct) INTO v_recorded_correct
          FROM public.question_attempts
         WHERE user_id = v_user_id
           AND created_at >= (p_local_date::TIMESTAMPTZ - INTERVAL '1 day');
        IF v_recorded_correct < v_correct THEN
            v_correct := v_recorded_correct;
        END IF;
    END IF;

    -- A vault room can be a single rune, so mini-games accept one item. Every
    -- other mode still needs three before it counts as a session.
    IF p_activity_type = 'mini_game' THEN
        IF v_questions < 1 THEN
            RAISE EXCEPTION 'Session requires at least one completed item';
        END IF;
    ELSIF v_questions < 3 THEN
        RAISE EXCEPTION 'Session requires at least 3 completed items for completion reward';
    END IF;

    INSERT INTO public.user_stats (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (v_user_id, p_local_date) ON CONFLICT (user_id, activity_date) DO NOTHING;

    -- Count how many rewards in this category today to enforce anti-farming daily caps
    SELECT COUNT(*) INTO v_daily_cat_count
    FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND category = p_activity_type
      AND created_at >= p_local_date::TIMESTAMPTZ;

    IF p_activity_type = 'practice_rush' THEN
        UPDATE public.user_stats SET completed_rushes = completed_rushes + 1 WHERE user_id = v_user_id;
        UPDATE public.daily_activity SET rushes_completed = rushes_completed + 1 WHERE user_id = v_user_id AND activity_date = p_local_date;
        IF v_daily_cat_count < 4 THEN
            v_reward := 5;
            v_reason := 'Completed Practice Rush (' || v_correct || '/' || v_questions || ' correct)';
        END IF;
    ELSIF p_activity_type = 'timed_session' THEN
        IF v_daily_cat_count < 3 THEN
            v_reward := LEAST(15, GREATEST(5, ROUND(v_questions * 0.6)::INTEGER));
            v_reason := 'Completed timed practice session (' || v_questions || ' questions)';
        END IF;
    ELSIF p_activity_type = 'full_simulation' THEN
        UPDATE public.user_stats SET completed_simulations = completed_simulations + 1 WHERE user_id = v_user_id;
        IF v_daily_cat_count < 2 THEN
            v_reward := 25;
            v_reason := 'Completed adaptive practice simulation (' || v_correct || '/' || v_questions || ')';
        END IF;
    ELSIF p_activity_type = 'mini_game' THEN
        UPDATE public.daily_activity SET games_completed = games_completed + 1 WHERE user_id = v_user_id AND activity_date = p_local_date;
        IF v_daily_cat_count < 5 THEN
            v_accuracy := v_correct::NUMERIC / GREATEST(v_questions, 1);
            v_reward := 5
                + v_correct * 3
                + CASE
                    WHEN v_questions >= 20 THEN 8
                    WHEN v_questions >= 10 THEN 6
                    WHEN v_questions >= 6 THEN 3
                    ELSE 0
                  END
                + CASE
                    WHEN v_accuracy >= 0.95 THEN 6
                    WHEN v_accuracy >= 0.80 THEN 4
                    WHEN v_accuracy >= 0.60 THEN 2
                    ELSE 0
                  END;
            IF v_questions <= 2 THEN
                v_reward := LEAST(v_reward, 12);
            ELSE
                v_reward := LEAST(v_reward, 100);
            END IF;
            v_reason := 'Completed SAT skill mini-game (' || v_correct || '/' || v_questions || ')';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported activity type %', p_activity_type;
    END IF;

    IF v_reward > 0 THEN
        INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
        VALUES (v_user_id, p_activity_type || ':' || p_session_id, v_reward, p_activity_type, v_reason)
        ON CONFLICT (user_id, idempotency_key) DO NOTHING;

        IF FOUND THEN
            UPDATE public.user_stats SET hd_coins = hd_coins + v_reward WHERE user_id = v_user_id;
            UPDATE public.daily_activity SET coins_earned_today = coins_earned_today + v_reward WHERE user_id = v_user_id AND activity_date = p_local_date;
        ELSE
            v_reward := 0;
        END IF;
    END IF;

    PERFORM public.refresh_streak_and_achievements(v_user_id, p_local_date);
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;

    RETURN jsonb_build_object(
        'coins_awarded', v_reward,
        'hd_coins', v_stats.hd_coins,
        'current_streak', v_stats.current_streak,
        'best_streak', v_stats.best_streak,
        'completed_rushes', v_stats.completed_rushes,
        'completed_simulations', v_stats.completed_simulations
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_activity_session(TEXT, TEXT, INTEGER, INTEGER, INTEGER, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_activity_session(TEXT, TEXT, INTEGER, INTEGER, INTEGER, DATE) TO authenticated;

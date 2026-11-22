-- ============================================================================
-- COIN FAIRNESS HARDENING (2026-11-13)
-- ============================================================================
-- Three gaps remained after the exact-event migration:
--   1. A client could call award_arcade_coins with many fresh ids, so the
--      ten-coin per-event cap did not cap the day.
--   2. A completed session could be replayed to increment the session counters
--      and re-enter the reward path.
--   3. The cloud full-simulation reward was still a flat 25 HDCoins, while the
--      guest path scales it by coverage and accuracy.
--
-- This migration keeps the existing economy and adds only the missing bounds.
-- It is safe to run after 20261110000100_arcade_event_cap.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activity_sessions (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, session_id)
);

ALTER TABLE public.activity_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activity_sessions FROM PUBLIC;

-- Replaces the exact-event function with a daily ceiling. The row lock makes
-- concurrent awards serialize for the same user, so two simultaneous calls
-- cannot both spend the last coin under the cap.
CREATE OR REPLACE FUNCTION public.award_arcade_coins(
    p_amount INTEGER,
    p_session_id TEXT,
    p_local_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_stats RECORD;
    v_amount INTEGER := GREATEST(0, LEAST(COALESCE(p_amount, 0), 10));
    v_inserted BOOLEAN := FALSE;
    v_key TEXT;
    v_awarded_today INTEGER := 0;
    v_cap_date DATE := LEAST(COALESCE(p_local_date, CURRENT_DATE), CURRENT_DATE);
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF v_amount = 0 THEN
        SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;
        RETURN jsonb_build_object('coins_awarded', 0, 'hd_coins', COALESCE(v_stats.hd_coins, 0));
    END IF;

    IF p_session_id IS NULL OR length(btrim(p_session_id)) < 8 OR length(btrim(p_session_id)) > 200 THEN
        RAISE EXCEPTION 'An arcade coin event needs a bounded session id';
    END IF;

    v_key := 'arcade:' || btrim(p_session_id);

    INSERT INTO public.user_stats (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (v_user_id, p_local_date)
        ON CONFLICT (user_id, activity_date) DO NOTHING;

    -- Serialize the daily total for this account before reading it.
    PERFORM 1 FROM public.user_stats WHERE user_id = v_user_id FOR UPDATE;

    SELECT COALESCE(SUM(amount), 0) INTO v_awarded_today
    FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND category = 'mini_game'
      AND reason = 'Arcade event'
      AND created_at >= v_cap_date::TIMESTAMPTZ;

    v_amount := LEAST(v_amount, GREATEST(0, 120 - v_awarded_today));
    IF v_amount = 0 THEN
        SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;
        RETURN jsonb_build_object('coins_awarded', 0, 'hd_coins', COALESCE(v_stats.hd_coins, 0));
    END IF;

    INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
    VALUES (v_user_id, v_key, v_amount, 'mini_game', 'Arcade event')
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
    v_inserted := FOUND;

    IF v_inserted THEN
        UPDATE public.user_stats
        SET hd_coins = hd_coins + v_amount, updated_at = NOW()
        WHERE user_id = v_user_id;

        UPDATE public.daily_activity
        SET coins_earned_today = coins_earned_today + v_amount, updated_at = NOW()
        WHERE user_id = v_user_id AND activity_date = p_local_date;
    END IF;

    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;
    RETURN jsonb_build_object(
        'coins_awarded', CASE WHEN v_inserted THEN v_amount ELSE 0 END,
        'hd_coins', COALESCE(v_stats.hd_coins, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.award_arcade_coins(INTEGER, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_arcade_coins(INTEGER, TEXT, DATE) TO authenticated;

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
    v_correct INTEGER;
    v_questions INTEGER;
    v_stats RECORD;
    v_cap_date DATE := LEAST(COALESCE(p_local_date, CURRENT_DATE), CURRENT_DATE);
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_session_id IS NULL OR length(btrim(p_session_id)) < 8 OR length(btrim(p_session_id)) > 200 THEN
        RAISE EXCEPTION 'A completed session needs a bounded session id';
    END IF;

    v_questions := GREATEST(COALESCE(p_questions_count, 0), 0);
    v_correct := LEAST(GREATEST(COALESCE(p_correct_count, 0), 0), v_questions);

    IF p_activity_type = 'mini_game' THEN
        IF v_questions < 1 THEN
            RAISE EXCEPTION 'Session requires at least one completed item';
        END IF;
    ELSIF v_questions < 3 THEN
        RAISE EXCEPTION 'Session requires at least 3 completed items for completion reward';
    END IF;

    INSERT INTO public.user_stats (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (v_user_id, p_local_date)
        ON CONFLICT (user_id, activity_date) DO NOTHING;

    -- Serialize the daily category count and the reward write for this account.
    PERFORM 1 FROM public.user_stats WHERE user_id = v_user_id FOR UPDATE;

    -- The session id is the idempotency key for counters as well as coins. A
    -- replay returns the current balances without touching the streak, the
    -- activity chart or the reward caps.
    INSERT INTO public.activity_sessions (user_id, session_id, activity_type)
    VALUES (v_user_id, btrim(p_session_id), p_activity_type)
    ON CONFLICT (user_id, session_id) DO NOTHING;

    IF NOT FOUND THEN
        SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;
        RETURN jsonb_build_object(
            'coins_awarded', 0,
            'hd_coins', v_stats.hd_coins,
            'current_streak', v_stats.current_streak,
            'best_streak', v_stats.best_streak,
            'completed_rushes', v_stats.completed_rushes,
            'completed_simulations', v_stats.completed_simulations,
            'duplicate', true
        );
    END IF;

    SELECT COUNT(*) INTO v_daily_cat_count
    FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND category = p_activity_type
      AND created_at >= v_cap_date::TIMESTAMPTZ;

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
            -- Match the guest path: coverage of a 90-question benchmark times
            -- accuracy. Three answers can no longer collect the full 25.
            v_reward := LEAST(
                25,
                ROUND(
                    25
                    * (LEAST(v_questions, 90)::NUMERIC / 90)
                    * (v_correct::NUMERIC / v_questions)
                )::INTEGER
            );
            v_reason := 'Completed adaptive practice simulation (' || v_correct || '/' || v_questions || ')';
        END IF;
    ELSIF p_activity_type = 'mini_game' THEN
        UPDATE public.daily_activity
        SET games_completed = games_completed + 1
        WHERE user_id = v_user_id AND activity_date = p_local_date;
        v_reward := 0;
        v_reason := NULL;
    ELSE
        RAISE EXCEPTION 'Unsupported activity type %', p_activity_type;
    END IF;

    IF v_reward > 0 THEN
        INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
        VALUES (v_user_id, p_activity_type || ':' || btrim(p_session_id), v_reward, p_activity_type, v_reason)
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
        'completed_simulations', v_stats.completed_simulations,
        'duplicate', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_activity_session(TEXT, TEXT, INTEGER, INTEGER, INTEGER, DATE) TO authenticated;

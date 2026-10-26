-- ============================================================================
-- SESSION REWARDS, SCALED (2026-11-02)
-- ============================================================================
-- Mini-games paid a flat 4 HDCoins, which is less than four practice answers
-- and reads as an insult next to an eight-card Table Talk sitting or a vault
-- room with a crate puzzle in it. The reward now runs from a 5-coin floor to a
-- 100-coin ceiling and is earned from three things the player controls:
--
--   * correct answers   (+3 each)
--   * the size of the run (+3 at six items, +6 at ten, +8 at twenty)
--   * accuracy          (+2 at 60%, +4 at 80%, +6 at 95%+)
--
-- A one- or two-item run (a single vault room) is capped at 12 so the easiest
-- possible session cannot pay like a full one. The daily cap of five rewarded
-- mini-game sessions is unchanged, and the reward still goes through the
-- idempotency key so re-sending a session can never pay twice.
--
-- The client mirrors this formula exactly in `sessionCoinReward`
-- (src/lib/storage.ts); the two must be changed together.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_activity_session(
    p_activity_type TEXT, -- 'practice_rush' | 'timed_session' | 'full_simulation' | 'mini_game'
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
    v_stats RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_questions := GREATEST(COALESCE(p_questions_count, 0), 0);
    v_correct := LEAST(GREATEST(COALESCE(p_correct_count, 0), 0), v_questions);

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

GRANT EXECUTE ON FUNCTION public.complete_activity_session(TEXT, TEXT, INTEGER, INTEGER, INTEGER, DATE) TO authenticated;

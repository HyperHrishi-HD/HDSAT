-- ============================================================================
-- EXACT ARCADE COINS + GAME STREAK QUALIFICATION (2026-11-07)
-- ============================================================================
-- The arcade now pays for events, not for a random end-of-run lottery:
--   Coordinate Interceptor  1 / asteroid, 2 / ship, 3 / first-try question
--   Table Talk              1 / first-try correct reply
--   Rune Vault              1–5 / pickup, 3 / first-try correct gate
--   Skill mini-games        1 / first-try correct answer
--
-- A wrong first attempt pays zero for that item. The client supplies one
-- stable idempotency key per event, so retries and the offline outbox cannot
-- double-credit a pickup or an answer.
--
-- `complete_activity_session` is replaced in the same migration so the old
-- 5–100 coin random mini-game payout cannot coexist with the new event coins.
-- It still records the completed game, which is what qualifies a streak day.
-- ============================================================================

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
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF v_amount = 0 THEN
        SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;
        RETURN jsonb_build_object('coins_awarded', 0, 'hd_coins', COALESCE(v_stats.hd_coins, 0));
    END IF;

    IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
        RAISE EXCEPTION 'An arcade coin event needs a session id';
    END IF;

    INSERT INTO public.user_stats (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (v_user_id, p_local_date)
        ON CONFLICT (user_id, activity_date) DO NOTHING;

    INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
    VALUES (
        v_user_id,
        'arcade:' || btrim(p_session_id),
        v_amount,
        'mini_game',
        'Arcade event'
    )
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

-- Compatibility for any installed shell that still calls the old RPC. It now
-- routes through the exact ledger instead of its own separate implementation.
CREATE OR REPLACE FUNCTION public.award_vault_coins(
    p_amount INTEGER,
    p_session_id TEXT,
    p_local_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.award_arcade_coins(
        GREATEST(0, LEAST(COALESCE(p_amount, 0), 5)),
        'vault_coin:' || COALESCE(p_session_id, ''),
        p_local_date
    );
END;
$$;

REVOKE ALL ON FUNCTION public.award_vault_coins(INTEGER, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_vault_coins(INTEGER, TEXT, DATE) TO authenticated;

-- A completed game now qualifies the day exactly like three questions or five
-- flashcards. This trigger runs when `complete_activity_session` increments
-- games_completed, before refresh_streak_and_achievements is called. It mirrors
-- that function's date/strea k rules and is idempotent per activity date.
CREATE OR REPLACE FUNCTION public.qualify_streak_for_completed_game()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stats RECORD;
    v_new_streak INTEGER;
BEGIN
    IF NEW.games_completed < 1 OR NEW.qualified_for_streak THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.user_stats (user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = NEW.user_id FOR UPDATE;

    IF v_stats.last_qualifying_date = NEW.activity_date THEN
        UPDATE public.daily_activity
        SET qualified_for_streak = TRUE, updated_at = NOW()
        WHERE user_id = NEW.user_id AND activity_date = NEW.activity_date;
        RETURN NEW;
    END IF;

    IF v_stats.last_qualifying_date IS NULL THEN
        v_new_streak := 1;
    ELSIF v_stats.last_qualifying_date = (NEW.activity_date - INTERVAL '1 day')::DATE THEN
        v_new_streak := v_stats.current_streak + 1;
    ELSIF NEW.activity_date > v_stats.last_qualifying_date THEN
        v_new_streak := 1;
    ELSE
        v_new_streak := v_stats.current_streak;
    END IF;

    UPDATE public.daily_activity
    SET qualified_for_streak = TRUE, updated_at = NOW()
    WHERE user_id = NEW.user_id AND activity_date = NEW.activity_date;

    UPDATE public.user_stats
    SET current_streak = v_new_streak,
        best_streak = GREATEST(best_streak, v_new_streak),
        last_qualifying_date = GREATEST(COALESCE(last_qualifying_date, NEW.activity_date), NEW.activity_date),
        updated_at = NOW()
    WHERE user_id = NEW.user_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qualify_streak_after_game ON public.daily_activity;
CREATE TRIGGER qualify_streak_after_game
    AFTER UPDATE OF games_completed ON public.daily_activity
    FOR EACH ROW
    EXECUTE FUNCTION public.qualify_streak_for_completed_game();

-- Replace the old random payout. Game completion still increments the daily
-- counter (and therefore the trigger above), but pays no session coins.
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
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
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

-- ============================================================================
-- COIN BAND AND ACHIEVEMENT LADDER (2026-11-04)
-- ============================================================================
-- Two changes that have to land together, because both move HDCoin balances:
--
--   1. Session rewards. Arcade play (Practice Rush and the mini-games) now pays
--      a single random roll from 5 to 50 HDCoins, weighted towards the low end,
--      instead of a reward that grew with the size of the run. A full test pays
--      up to 25, scaled by how much of the test was answered and how much of it
--      was right, so answering three questions and quitting pays a coin or two
--      rather than the whole reward.
--
--   2. The achievement ladder. Thirty-one ordered achievements, ending in the
--      long-haul ones (1,000 questions, a 100-day streak, 10,000 lifetime
--      coins). Each pays its bonus exactly once.
--
-- The client mirrors both halves: `gameCoinReward` / `sessionCoinReward` in
-- src/lib/storage.ts and `ACHIEVEMENTS` in src/lib/catalog.ts. Change the
-- three together or a signed-in student and a guest see different numbers.
-- ============================================================================

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
    v_recorded_correct INTEGER := 0;
    v_coverage NUMERIC;
    v_accuracy NUMERIC;
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
        -- A run is at least three answers with at least one of them right; that
        -- is what stops an instant reset from collecting a game payout.
        IF v_daily_cat_count < 4 AND v_correct >= 1 THEN
            v_reward := LEAST(50, GREATEST(5, 5 + ROUND(POWER(random(), 2.6) * 45)::INTEGER));
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
            -- 90 answered questions is a full test; anything shorter is worth
            -- the fraction that was actually sat, times the fraction that was
            -- right. A three-question run can no longer collect 25 coins.
            v_coverage := LEAST(1, v_questions::NUMERIC / 90);
            v_accuracy := v_correct::NUMERIC / GREATEST(v_questions, 1);
            v_reward := LEAST(25, GREATEST(0, ROUND(25 * v_coverage * v_accuracy)::INTEGER));
            v_reason := 'Completed adaptive practice simulation (' || v_correct || '/' || v_questions || ')';
        END IF;
    ELSIF p_activity_type = 'mini_game' THEN
        UPDATE public.daily_activity SET games_completed = games_completed + 1 WHERE user_id = v_user_id AND activity_date = p_local_date;
        IF v_daily_cat_count < 5 AND v_correct >= 1 THEN
            v_reward := LEAST(50, GREATEST(5, 5 + ROUND(POWER(random(), 2.6) * 45)::INTEGER));
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

-- ---- 2. the achievement ladder --------------------------------------------
-- Every grant is idempotent: `grant_achievement_with_reward` inserts with
-- ON CONFLICT DO NOTHING, so re-running this function never pays twice.
CREATE OR REPLACE FUNCTION public.refresh_streak_and_achievements(
    p_user_id UUID,
    p_local_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_daily RECORD;
    v_stats RECORD;
    v_qualifies BOOLEAN := FALSE;
    v_new_streak INTEGER;
    v_new_best INTEGER;
    v_mastered_count INTEGER := 0;
    v_rush_correct INTEGER := 0;
    v_lifetime INTEGER := 0;
    v_flawless_module BOOLEAN := FALSE;
BEGIN
    INSERT INTO public.user_stats (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (p_user_id, p_local_date) ON CONFLICT (user_id, activity_date) DO NOTHING;

    SELECT * INTO v_daily FROM public.daily_activity WHERE user_id = p_user_id AND activity_date = p_local_date;
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = p_user_id FOR UPDATE;

    IF v_daily.questions_completed >= 3 OR v_daily.flashcards_reviewed >= 5 OR v_daily.rushes_completed >= 1 THEN
        v_qualifies := TRUE;
    END IF;

    IF v_qualifies AND NOT v_daily.qualified_for_streak THEN
        UPDATE public.daily_activity
        SET qualified_for_streak = TRUE, updated_at = NOW()
        WHERE user_id = p_user_id AND activity_date = p_local_date;

        IF v_stats.last_qualifying_date IS NULL THEN
            v_new_streak := 1;
        ELSIF v_stats.last_qualifying_date = p_local_date THEN
            v_new_streak := v_stats.current_streak;
        ELSIF v_stats.last_qualifying_date = (p_local_date - INTERVAL '1 day')::DATE THEN
            v_new_streak := v_stats.current_streak + 1;
        ELSIF p_local_date > v_stats.last_qualifying_date THEN
            v_new_streak := 1;
        ELSE
            v_new_streak := v_stats.current_streak;
        END IF;

        v_new_best := GREATEST(v_stats.best_streak, v_new_streak);

        UPDATE public.user_stats
        SET current_streak = v_new_streak,
            best_streak = v_new_best,
            last_qualifying_date = GREATEST(COALESCE(v_stats.last_qualifying_date, p_local_date), p_local_date),
            updated_at = NOW()
        WHERE user_id = p_user_id;

        INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
        VALUES (
            p_user_id,
            'daily_milestone:' || p_local_date::TEXT,
            5,
            'daily_milestone',
            'Completed daily study milestone on ' || p_local_date::TEXT
        )
        ON CONFLICT (user_id, idempotency_key) DO NOTHING;

        IF FOUND THEN
            UPDATE public.user_stats SET hd_coins = hd_coins + 5 WHERE user_id = p_user_id;
            UPDATE public.daily_activity SET coins_earned_today = coins_earned_today + 5 WHERE user_id = p_user_id AND activity_date = p_local_date;
        END IF;
    END IF;

    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = p_user_id;

    SELECT COUNT(*) INTO v_mastered_count
    FROM public.user_question_progress
    WHERE user_id = p_user_id AND status = 'mastered';

    SELECT COUNT(*) INTO v_rush_correct
    FROM public.question_attempts
    WHERE user_id = p_user_id AND mode = 'rush' AND is_correct = TRUE;

    -- A flawless module: any completed test whose stored module results include
    -- one with every item right. The client also awards this badge from the run
    -- in memory; this is the same rule applied to what the server keeps.
    SELECT EXISTS (
        SELECT 1
          FROM public.test_attempts t
          CROSS JOIN LATERAL jsonb_array_elements(t.modules) AS m
         WHERE t.user_id = p_user_id
           AND t.status = 'completed'
           AND COALESCE((m->>'total')::INTEGER, 0) > 0
           AND COALESCE((m->>'correct')::INTEGER, -1) = COALESCE((m->>'total')::INTEGER, 0)
    ) INTO v_flawless_module;

    -- Every coin ever earned; purchases never lower it.
    v_lifetime := GREATEST(v_stats.lifetime_coins, v_stats.hd_coins);

    IF v_stats.total_attempts >= 1 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'first-steps', 'First Steps', 'Complete your first practice question.', 5, p_local_date);
    END IF;
    IF v_stats.total_attempts >= 10 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'ten-questions', 'Warmed Up', 'Answer 10 questions.', 10, p_local_date);
    END IF;
    IF v_stats.total_attempts >= 50 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'fifty-questions', 'Grinder', 'Answer 50 questions.', 25, p_local_date);
    END IF;
    IF v_stats.best_streak >= 3 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'streak-3', 'Three Day Streak', 'Practise on three consecutive days.', 10, p_local_date);
    END IF;
    IF v_stats.best_streak >= 7 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'streak-7', 'Week Streak', 'Practise on seven consecutive days.', 25, p_local_date);
    END IF;
    IF v_stats.flashcards_reviewed >= 10 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'flashcard-10', 'Card Shark', 'Review 10 flashcards.', 10, p_local_date);
    END IF;
    IF v_stats.flashcards_reviewed >= 50 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'flashcard-50', 'Deck Master', 'Review 50 flashcards.', 25, p_local_date);
    END IF;
    IF v_stats.completed_simulations >= 1 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'first-test', 'Test Pilot', 'Complete a full adaptive practice test.', 25, p_local_date);
    END IF;
    IF v_rush_correct >= 10 OR v_stats.completed_rushes >= 1 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'rush-10', 'Rush Hour', 'Answer 10 Practice Rush questions correctly.', 20, p_local_date);
    END IF;
    IF v_mastered_count >= 5 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'mastery-5', 'Mastery', 'Master 5 questions with two consecutive correct answers.', 40, p_local_date);
    END IF;
    IF v_flawless_module THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'perfect-module', 'Flawless Module', 'Score 100% on any test module.', 30, p_local_date);
    END IF;

    -- Refresh stats in case coins crossed a balance threshold from the rewards
    -- granted above, so a single session can climb a rung it just funded.
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = p_user_id;
    v_lifetime := GREATEST(v_stats.lifetime_coins, v_stats.hd_coins);

    IF v_stats.total_attempts >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'hundred-questions', 'Century', 'Answer 100 questions.', 50, p_local_date);
    END IF;
    IF v_stats.correct_attempts >= 50 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'accurate-50', 'Sharpshooter', 'Answer 50 questions correctly.', 40, p_local_date);
    END IF;
    IF v_stats.unique_questions_attempted >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'distinct-100', 'Wide Net', 'Answer 100 different questions.', 60, p_local_date);
    END IF;
    IF v_stats.best_streak >= 14 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'streak-14', 'Fortnight', 'Practise on fourteen consecutive days.', 60, p_local_date);
    END IF;
    IF v_stats.completed_simulations >= 5 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'tests-5', 'Simulator', 'Complete 5 full adaptive practice tests.', 80, p_local_date);
    END IF;
    IF v_stats.flashcards_reviewed >= 200 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'flashcards-200', 'Card Archive', 'Review 200 flashcards.', 80, p_local_date);
    END IF;
    IF v_mastered_count >= 25 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'mastery-25', 'Deep Mastery', 'Master 25 questions.', 100, p_local_date);
    END IF;
    IF v_rush_correct >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'rush-100', 'Rush Veteran', 'Answer 100 Practice Rush questions correctly.', 100, p_local_date);
    END IF;
    IF v_stats.hd_coins >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'coin-100', 'Coin Collector', 'Hold 100 HDCoins at once.', 15, p_local_date);
    END IF;
    IF v_stats.hd_coins >= 1000 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'coin-1000', 'Vault Keeper', 'Hold 1,000 HDCoins at once.', 100, p_local_date);
    END IF;
    IF v_lifetime >= 2500 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'lifetime-2500', 'Earned It', 'Earn 2,500 HDCoins across your lifetime.', 150, p_local_date);
    END IF;
    IF v_stats.correct_attempts >= 500 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'accurate-500', 'Dead Eye', 'Answer 500 questions correctly.', 150, p_local_date);
    END IF;
    IF v_stats.total_attempts >= 500 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'five-hundred-questions', 'Marathon', 'Answer 500 questions.', 200, p_local_date);
    END IF;
    IF v_stats.unique_questions_attempted >= 500 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'distinct-500', 'Cartographer', 'Answer 500 different questions.', 200, p_local_date);
    END IF;
    IF v_mastered_count >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'mastery-100', 'Scholar', 'Master 100 questions.', 250, p_local_date);
    END IF;
    IF v_stats.completed_simulations >= 15 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'tests-15', 'Trial Runner', 'Complete 15 full adaptive practice tests.', 250, p_local_date);
    END IF;
    IF v_stats.best_streak >= 30 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'streak-30', 'Month of Study', 'Practise on thirty consecutive days.', 250, p_local_date);
    END IF;
    IF v_stats.total_attempts >= 1000 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'thousand-questions', 'Thousand Club', 'Answer 1,000 questions.', 300, p_local_date);
    END IF;
    IF v_stats.best_streak >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'streak-100', 'Unbroken', 'Practise on one hundred consecutive days.', 400, p_local_date);
    END IF;
    IF v_lifetime >= 10000 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'lifetime-10000', 'Fortune', 'Earn 10,000 HDCoins across your lifetime.', 500, p_local_date);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_streak_and_achievements(UUID, DATE) FROM PUBLIC;

-- ============================================================================
-- COSMETIC PRICE LADDER & UNIFIED ACHIEVEMENTS WITH HDCOIN PAYOUTS (2026-10-22)
-- ============================================================================
-- The store reads as a ladder:
--   20 → 50 → 100 → 150 → 200 → 300 → 400 → 600 → 1000 → 1800 → 3500 HDCoins.
-- The client catalogue (src/lib/catalog.ts) and this server-side table must
-- stay identical — the client cannot supply a price, so a mismatch would
-- quietly charge the wrong amount.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purchase_cosmetic_item(
    p_item_id TEXT,
    p_item_type TEXT, -- 'accent_theme' | 'avatar_badge'
    p_local_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_price INTEGER;
    v_label TEXT;
    v_stats RECORD;
    v_profile RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_item_type NOT IN ('accent_theme', 'avatar_badge') THEN
        RAISE EXCEPTION 'Unknown cosmetic type %', p_item_type;
    END IF;

    -- Server-side catalog authority (client cannot supply arbitrary price)
    CASE p_item_id
        WHEN 'oxford-navy' THEN v_price := 20; v_label := 'Oxford Navy Accent Theme';
        WHEN 'forest-sage' THEN v_price := 50; v_label := 'Forest Sage Accent Theme';
        WHEN 'warm-amber' THEN v_price := 100; v_label := 'Warm Amber Accent Theme';
        WHEN 'plum-ink' THEN v_price := 150; v_label := 'Plum Ink Accent Theme';
        WHEN 'badge-navigator' THEN v_price := 200; v_label := 'Adaptive Navigator Profile Emblem';
        WHEN 'badge-grapher' THEN v_price := 300; v_label := 'Desmos Tactician Profile Emblem';
        WHEN 'badge-centurion' THEN v_price := 400; v_label := 'Centurion Scholar Profile Emblem';
        WHEN 'slate-mono' THEN v_price := 600; v_label := 'Slate Mono Accent Theme';
        WHEN 'teal-current' THEN v_price := 1000; v_label := 'Teal Current Accent Theme';
        WHEN 'rose-quartz' THEN v_price := 1800; v_label := 'Rose Quartz Accent Theme';
        WHEN 'royal-obsidian' THEN v_price := 3500; v_label := 'Royal Obsidian Accent Theme';
        ELSE RAISE EXCEPTION 'Unknown cosmetic item %', p_item_id;
    END CASE;

    SELECT * INTO v_profile FROM public.profiles WHERE user_id = v_user_id FOR UPDATE;
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id FOR UPDATE;

    IF p_item_id = ANY(v_profile.unlocked_cosmetics) THEN
        RETURN jsonb_build_object(
            'already_unlocked', true,
            'hd_coins', v_stats.hd_coins,
            'unlocked_cosmetics', v_profile.unlocked_cosmetics
        );
    END IF;

    IF v_stats.hd_coins < v_price THEN
        RAISE EXCEPTION 'Insufficient HDCoins balance (have %, need %)', v_stats.hd_coins, v_price;
    END IF;

    INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
    VALUES (v_user_id, 'purchase:' || p_item_id, -v_price, 'cosmetic_purchase', 'Unlocked ' || v_label)
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;

    IF FOUND THEN
        UPDATE public.user_stats
        SET hd_coins = hd_coins - v_price, updated_at = NOW()
        WHERE user_id = v_user_id
        RETURNING * INTO v_stats;

        UPDATE public.profiles
        SET unlocked_cosmetics = array_append(unlocked_cosmetics, p_item_id),
            accent_theme = CASE WHEN p_item_type = 'accent_theme' THEN p_item_id ELSE accent_theme END,
            avatar_badge = CASE WHEN p_item_type = 'avatar_badge' THEN p_item_id ELSE avatar_badge END,
            updated_at = NOW()
        WHERE user_id = v_user_id
        RETURNING * INTO v_profile;
    END IF;

    RETURN jsonb_build_object(
        'already_unlocked', false,
        'price_paid', v_price,
        'hd_coins', v_stats.hd_coins,
        'unlocked_cosmetics', v_profile.unlocked_cosmetics,
        'accent_theme', v_profile.accent_theme,
        'avatar_badge', v_profile.avatar_badge
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_cosmetic_item(TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- UNIFIED ACHIEVEMENTS + ONE-TIME HDCOIN REWARDS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grant_achievement_with_reward(
    p_user_id UUID,
    p_achievement_id TEXT,
    p_title TEXT,
    p_description TEXT,
    p_reward INTEGER,
    p_local_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
    VALUES (p_user_id, p_achievement_id, p_title, p_description)
    ON CONFLICT (user_id, achievement_id) DO NOTHING;

    IF FOUND AND p_reward > 0 THEN
        INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
        VALUES (
            p_user_id,
            'ach_reward:' || p_achievement_id,
            p_reward,
            'achievement_reward',
            'Unlocked achievement: ' || p_title
        )
        ON CONFLICT (user_id, idempotency_key) DO NOTHING;

        IF FOUND THEN
            UPDATE public.user_stats
            SET hd_coins = hd_coins + p_reward, updated_at = NOW()
            WHERE user_id = p_user_id;

            UPDATE public.daily_activity
            SET coins_earned_today = coins_earned_today + p_reward, updated_at = NOW()
            WHERE user_id = p_user_id AND activity_date = p_local_date;
        END IF;
    END IF;
END;
$$;

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
        PERFORM public.grant_achievement_with_reward(p_user_id, 'rush-10', 'Rush Hour', 'Score 10 correct answers across Practice Rush sessions.', 20, p_local_date);
    END IF;
    IF v_mastered_count >= 5 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'mastery-5', 'Mastery', 'Master 5 questions with two consecutive correct answers.', 40, p_local_date);
    END IF;

    -- Refresh stats in case coins crossed 100 from rewards above
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = p_user_id;
    IF v_stats.hd_coins >= 100 THEN
        PERFORM public.grant_achievement_with_reward(p_user_id, 'coin-100', 'Coin Collector', 'Hold 100 HDCoins at once.', 15, p_local_date);
    END IF;
END;
$$;

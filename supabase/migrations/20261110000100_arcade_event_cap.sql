-- ============================================================================
-- ARCADE EVENT CAP (2026-11-10)
-- ============================================================================
-- The exact arcade ledger pays one event at a time. A legitimate event can be
-- at most a five-target interceptor shot (two coins for a ship), a multi-coin
-- vault pickup, or a 3-coin first-try answer, so ten coins is the ceiling.
-- The old function accepted up to 1000 from the client, which turned a single
-- forged event into a jackpot. The idempotency key is also bounded so a client
-- cannot use an oversized string to bypass normal ledger handling.
--
-- This is intentionally a separate migration: installations that already ran
-- 20261107000100 need this replacement, while fresh installations get both in
-- chronological order.
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
    v_key TEXT;
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

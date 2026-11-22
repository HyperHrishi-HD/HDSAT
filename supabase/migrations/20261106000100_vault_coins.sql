-- ============================================================================
-- RUNE VAULT COINS (2026-11-06)
-- ============================================================================
-- Floating coins are picked up one at a time. Each pickup has a stable session
-- id, so a retried request cannot pay twice, and the balance, lifetime total and
-- daily coin ledger all move together through the same ledger the rest of the
-- app uses.

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
DECLARE
    v_user_id UUID := auth.uid();
    v_stats RECORD;
    v_amount INTEGER := GREATEST(0, LEAST(COALESCE(p_amount, 0), 5));
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
        RAISE EXCEPTION 'A coin pickup needs a session id';
    END IF;

    INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
    VALUES (
        v_user_id,
        'vault_coin:' || btrim(p_session_id),
        v_amount,
        'mini_game',
        'Rune Vault coin pickup'
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

REVOKE ALL ON FUNCTION public.award_vault_coins(INTEGER, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_vault_coins(INTEGER, TEXT, DATE) TO authenticated;

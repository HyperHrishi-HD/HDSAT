-- ============================================================================
-- COSMETIC PRICE LADDER (2026-10-20)
-- ============================================================================
-- The store now reads as a ladder: 20 → 50 → 100 → 150 → 200 → 300 → 400
-- HDCoins, themes first and emblems after. The client catalogue
-- (src/lib/catalog.ts) and this server-side table must stay identical —
-- the client cannot supply a price, so a mismatch would quietly charge the
-- wrong amount.
--
-- This replaces the original function from 20261014000100_init_hdsat_schema.sql
-- (which also carried a stray `' plum-ink'` branch with a leading space).
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

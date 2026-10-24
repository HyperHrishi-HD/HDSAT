-- ============================================================================
-- ECONOMY SPLIT: THEMES ARE BOUGHT, EMBLEMS ARE EARNED (2026-10-25)
-- ============================================================================
-- The store sells accent themes only. Profile emblems are proof of an
-- achievement, so the purchase RPC refuses badge slots outright instead of
-- trusting the client to hide the buttons. Students who already bought a legacy
-- emblem keep it in unlocked_cosmetics and can still wear it; nothing is
-- refunded or removed.
--
-- Theme prices must stay identical to src/lib/catalog.ts (STORE_ITEMS):
--   20 -> 50 -> 100 -> 150 -> 600 -> 1000 -> 1800 -> 3500 HDCoins.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purchase_cosmetic_item(
    p_item_id TEXT,
    p_item_type TEXT,
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
    v_legacy_emblems TEXT[] := ARRAY['badge-navigator', 'badge-grapher', 'badge-centurion'];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_item_type IS DISTINCT FROM 'accent_theme' THEN
        RAISE EXCEPTION 'Emblems are earned through achievements and cannot be purchased';
    END IF;

    IF p_item_id = ANY(v_legacy_emblems) THEN
        RAISE EXCEPTION 'Emblems are earned through achievements and cannot be purchased';
    END IF;

    -- Server-side catalog authority (client cannot supply arbitrary price)
    CASE p_item_id
        WHEN 'oxford-navy' THEN v_price := 20; v_label := 'Oxford Navy Accent Theme';
        WHEN 'forest-sage' THEN v_price := 50; v_label := 'Forest Sage Accent Theme';
        WHEN 'warm-amber' THEN v_price := 100; v_label := 'Warm Amber Accent Theme';
        WHEN 'plum-ink' THEN v_price := 150; v_label := 'Plum Ink Accent Theme';
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
            accent_theme = p_item_id,
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

-- No data migration: items already in unlocked_cosmetics stay owned and
-- wearable, and the client resolves both achievement emblems and the three
-- legacy badge ids when rendering the equipped glyph.

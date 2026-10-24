-- ============================================================================
-- LIFETIME HDCOINS + LEADERBOARD (2026-10-27)
-- ============================================================================
-- Two small additions, both read-only from the browser's point of view.
--
-- 1. `user_stats.lifetime_coins` counts every HDCoin ever *earned*, while
--    `hd_coins` is the spendable balance. It is maintained by a trigger on the
--    coin ledger, so no award path has to remember to update it, and the
--    backfill below recomputes it from the ledger that already exists.
--
-- 2. `get_leaderboard()` returns the top players by balance with the minimum
--    information needed to render a small board: a display name and three
--    numbers. It never returns an email, a user id or anything a student has
--    answered. Names that look like an address are replaced with "Student",
--    so an account that never chose a name cannot leak its login.
-- ============================================================================

ALTER TABLE public.user_stats
    ADD COLUMN IF NOT EXISTS lifetime_coins INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.track_lifetime_coins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.amount > 0 THEN
        UPDATE public.user_stats
           SET lifetime_coins = lifetime_coins + NEW.amount
         WHERE user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coin_transactions_lifetime ON public.coin_transactions;
CREATE TRIGGER coin_transactions_lifetime
    AFTER INSERT ON public.coin_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.track_lifetime_coins();

-- The ledger is authoritative; recompute once so existing students keep the
-- coins they already earned. Idempotent: re-running sets the same totals.
UPDATE public.user_stats s
   SET lifetime_coins = COALESCE(t.total, 0)
  FROM (
        SELECT user_id, SUM(amount)::INTEGER AS total
          FROM public.coin_transactions
         WHERE amount > 0
         GROUP BY user_id
       ) t
 WHERE s.user_id = t.user_id;

-- Zero out anyone the join missed but who still carries a stale value.
UPDATE public.user_stats s
   SET lifetime_coins = 0
 WHERE NOT EXISTS (
        SELECT 1 FROM public.coin_transactions c
         WHERE c.user_id = s.user_id AND c.amount > 0
       )
   AND s.lifetime_coins <> 0;

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit INTEGER DEFAULT 5)
RETURNS TABLE (
    rank INTEGER,
    display_name TEXT,
    hd_coins INTEGER,
    best_streak INTEGER,
    total_attempts INTEGER,
    is_me BOOLEAN,
    my_rank INTEGER,
    total_players INTEGER,
    outside_top BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    WITH limited AS (
        SELECT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 25) AS n
    ),
    players AS (
        SELECT
            p.user_id,
            CASE
                WHEN p.display_name ~ '[@<>&]' OR length(btrim(p.display_name)) = 0
                    THEN 'Student'
                ELSE left(btrim(p.display_name), 24)
            END AS display_name,
            s.hd_coins,
            s.best_streak,
            s.total_attempts,
            p.created_at
          FROM public.user_stats s
          JOIN public.profiles p ON p.user_id = s.user_id
         WHERE s.total_attempts > 0 OR s.hd_coins > 0
    ),
    ranked AS (
        SELECT
            players.*,
            ROW_NUMBER() OVER (
                ORDER BY hd_coins DESC, best_streak DESC, total_attempts DESC, created_at ASC
            )::INTEGER AS rank,
            COUNT(*) OVER ()::INTEGER AS total_players
          FROM players
    ),
    mine AS (
        SELECT rank FROM ranked WHERE user_id = auth.uid()
    )
    SELECT
        ranked.rank,
        ranked.display_name,
        ranked.hd_coins,
        ranked.best_streak,
        ranked.total_attempts,
        (ranked.user_id = auth.uid()) AS is_me,
        (SELECT rank FROM mine) AS my_rank,
        ranked.total_players,
        FALSE AS outside_top
      FROM ranked, limited
     WHERE ranked.rank <= limited.n
    UNION ALL
    SELECT
        ranked.rank,
        ranked.display_name,
        ranked.hd_coins,
        ranked.best_streak,
        ranked.total_attempts,
        TRUE AS is_me,
        (SELECT rank FROM mine) AS my_rank,
        ranked.total_players,
        TRUE AS outside_top
      FROM ranked, limited
     WHERE ranked.user_id = auth.uid() AND ranked.rank > limited.n
     ORDER BY rank;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_leaderboard(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(INTEGER) TO authenticated;

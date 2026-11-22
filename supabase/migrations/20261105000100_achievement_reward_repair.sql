-- ============================================================================
-- ACHIEVEMENT REWARDS: EARNED ALWAYS MEANS PAID (2026-11-05)
-- ============================================================================
-- Root cause of "badge is earned, the +25 never arrived":
--
--   grant_achievement_with_reward() inserted the user_achievements row first and
--   only paid `IF FOUND`, i.e. only when that insert was new. A badge that
--   already existed — through a legacy id (first_simulation) or an earlier
--   version of the ladder — could never pay, because the achievement insert
--   conflicted and the reward block was skipped. The client normalises legacy
--   ids to the canonical ones, so the badge showed as earned while the balance
--   never moved.
--
-- Two changes, both idempotent:
--
--   1. The reward insert is no longer conditional on the achievement insert.
--      It always attempts `ach_reward:<id>` and the unique key makes a repeat a
--      no-op. Calling this function for an old badge now heals it exactly once.
--   2. A one-time backfill pays every earned badge that has no reward row yet,
--      mapping the legacy ids the same way the client does (src/lib/catalog.ts).
--
-- The ledger trigger (20261028000100) keeps lifetime_coins in step, so only the
-- spendable balance is written here.
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

    -- Unconditional on purpose: an existing badge may have been granted before
    -- rewards existed. The idempotency key is the guard, not the insert result.
    IF p_reward > 0 THEN
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

-- ---- one-time repair -------------------------------------------------------
-- Amounts must match src/lib/catalog.ts and the ladder migration. The client
-- test (src/lib/catalog.test.ts) checks the grant calls against the catalogue.
WITH ladder(id, reward) AS (
    VALUES
        ('first-steps', 5),
        ('ten-questions', 10),
        ('fifty-questions', 25),
        ('perfect-module', 30),
        ('streak-3', 10),
        ('streak-7', 25),
        ('flashcard-10', 10),
        ('flashcard-50', 25),
        ('first-test', 25),
        ('rush-10', 20),
        ('coin-100', 15),
        ('mastery-5', 40),
        ('hundred-questions', 50),
        ('accurate-50', 40),
        ('distinct-100', 60),
        ('streak-14', 60),
        ('tests-5', 80),
        ('flashcards-200', 80),
        ('mastery-25', 100),
        ('rush-100', 100),
        ('coin-1000', 100),
        ('lifetime-2500', 150),
        ('accurate-500', 150),
        ('five-hundred-questions', 200),
        ('distinct-500', 200),
        ('mastery-100', 250),
        ('tests-15', 250),
        ('streak-30', 250),
        ('thousand-questions', 300),
        ('streak-100', 400),
        ('lifetime-10000', 500)
),
canonical AS (
    SELECT
        ua.user_id,
        CASE ua.achievement_id
            WHEN 'first_question' THEN 'first-steps'
            WHEN 'unique_25' THEN 'ten-questions'
            WHEN 'unique_50' THEN 'fifty-questions'
            WHEN 'unique_100' THEN 'distinct-100'
            WHEN 'first_rush' THEN 'rush-10'
            WHEN 'first_simulation' THEN 'first-test'
            WHEN 'flashcard_10' THEN 'flashcard-10'
            WHEN 'streak_7' THEN 'streak-7'
            ELSE ua.achievement_id
        END AS achievement_id
      FROM public.user_achievements ua
),
missing AS (
    SELECT DISTINCT c.user_id, l.id, l.reward
      FROM canonical c
      JOIN ladder l ON l.id = c.achievement_id
     WHERE NOT EXISTS (
            SELECT 1
              FROM public.coin_transactions t
             WHERE t.user_id = c.user_id
               AND t.idempotency_key = 'ach_reward:' || l.id
           )
),
inserted AS (
    INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
    SELECT user_id, 'ach_reward:' || id, reward, 'achievement_reward',
           'Repaired achievement reward: ' || id
      FROM missing
    ON CONFLICT (user_id, idempotency_key) DO NOTHING
    RETURNING user_id, amount
)
UPDATE public.user_stats s
   SET hd_coins = s.hd_coins + repaired.total,
       updated_at = NOW()
  FROM (
        SELECT user_id, SUM(amount)::INTEGER AS total
          FROM inserted
         GROUP BY user_id
       ) repaired
 WHERE s.user_id = repaired.user_id;

NOTIFY pgrst, 'reload schema';

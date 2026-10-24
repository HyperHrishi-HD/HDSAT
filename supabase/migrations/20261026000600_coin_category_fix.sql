-- ============================================================================
-- COIN CATEGORY: achievement rewards (2026-10-26)
-- ============================================================================
-- `grant_achievement_with_reward` (20261020000100_cosmetic_price_ladder.sql)
-- writes category 'achievement_reward', but the original CHECK on
-- coin_transactions never listed it. Accounts that already owned their
-- achievements never inserted a row, so the bug stayed hidden; a brand-new
-- student hit a check violation inside submit_question_attempt on the very
-- first answer that unlocked something, which rolled the whole attempt back.
--
-- Fix the constraint, and keep the list in one place from now on.
-- ============================================================================

ALTER TABLE public.coin_transactions
    DROP CONSTRAINT IF EXISTS coin_transactions_category_check;

ALTER TABLE public.coin_transactions
    ADD CONSTRAINT coin_transactions_category_check CHECK (category IN (
        'question_complete',
        'question_correct_new',
        'practice_rush',
        'timed_session',
        'flashcard_review',
        'daily_milestone',
        'full_simulation',
        'mini_game',
        'cosmetic_purchase',
        'guest_sync',
        'achievement_reward'
    ));

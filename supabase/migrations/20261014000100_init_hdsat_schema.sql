-- HDSAT Initial Database Schema, Security Policies, and Trusted RPC Functions
-- Project: HDSAT (qijfmwjcaminecxmbtcf)

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. DATASET SOURCES (Provenance & License Audit Table)
CREATE TABLE IF NOT EXISTS public.dataset_sources (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    license TEXT NOT NULL,
    license_url TEXT,
    provenance_summary TEXT NOT NULL,
    is_released_practice_set BOOLEAN NOT NULL DEFAULT FALSE,
    is_official_college_board BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    record_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. QUESTIONS (Publicly readable metadata; answer key kept in question_keys)
CREATE TABLE IF NOT EXISTS public.questions (
    id TEXT PRIMARY KEY,
    external_id TEXT UNIQUE,
    assessments TEXT[] NOT NULL DEFAULT ARRAY['SAT']::TEXT[],
    section TEXT NOT NULL CHECK (section IN ('Reading and Writing', 'Math')),
    domain TEXT NOT NULL,
    skill TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    format TEXT NOT NULL CHECK (format IN ('multiple_choice', 'spr')),
    stimulus TEXT,
    prompt TEXT NOT NULL,
    choices JSONB, -- Array of { "id": "A", "text": "..." } for MC, null for SPR
    figure_metadata JSONB, -- Optional SVG/table/chart structured data
    source_id TEXT NOT NULL REFERENCES public.dataset_sources(source_id) ON DELETE RESTRICT,
    source_name TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    is_released_practice_set BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'reported', 'archived')),
    validation_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_section ON public.questions(section);
CREATE INDEX IF NOT EXISTS idx_questions_domain ON public.questions(domain);
CREATE INDEX IF NOT EXISTS idx_questions_skill ON public.questions(skill);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON public.questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_source_id ON public.questions(source_id);
CREATE INDEX IF NOT EXISTS idx_questions_assessments ON public.questions USING GIN(assessments);

-- 3. QUESTION KEYS (Separated answer keys & explanations; protected by RLS, accessed via RPCs or controlled views)
CREATE TABLE IF NOT EXISTS public.question_keys (
    question_id TEXT PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
    correct_answer TEXT NOT NULL,
    acceptable_answers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    explanation TEXT NOT NULL,
    distractor_rationales JSONB,
    scoring_metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. QUESTION REPORTS (User reports of broken or questionable items)
CREATE TABLE IF NOT EXISTS public.question_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    question_id TEXT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. USER PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT 'Student',
    preferred_exam TEXT NOT NULL DEFAULT 'SAT' CHECK (preferred_exam IN ('SAT', 'PSAT/NMSQT', 'PSAT 10', 'PSAT 8/9')),
    theme_preference TEXT NOT NULL DEFAULT 'light' CHECK (theme_preference IN ('light', 'slate', 'sepia', 'midnight')),
    accent_theme TEXT NOT NULL DEFAULT 'classic-blue',
    avatar_badge TEXT NOT NULL DEFAULT 'scholar',
    compact_dashboard BOOLEAN NOT NULL DEFAULT FALSE,
    unlocked_cosmetics TEXT[] NOT NULL DEFAULT ARRAY['classic-blue', 'scholar']::TEXT[],
    timezone TEXT NOT NULL DEFAULT 'UTC',
    sound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. USER STATS (Derived/atomic aggregate ledger per user)
CREATE TABLE IF NOT EXISTS public.user_stats (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    hd_coins INTEGER NOT NULL DEFAULT 0 CHECK (hd_coins >= 0),
    current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
    best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
    last_qualifying_date DATE,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    correct_attempts INTEGER NOT NULL DEFAULT 0,
    unique_questions_attempted INTEGER NOT NULL DEFAULT 0,
    completed_rushes INTEGER NOT NULL DEFAULT 0,
    completed_simulations INTEGER NOT NULL DEFAULT 0,
    flashcards_reviewed INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. QUESTION ATTEMPTS
CREATE TABLE IF NOT EXISTS public.question_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_event_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('question_bank', 'practice', 'exam', 'rush', 'game')),
    difficulty TEXT NOT NULL,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
    session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_question_attempts_user_created ON public.question_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_attempts_user_question ON public.question_attempts(user_id, question_id);

-- 8. USER QUESTION PROGRESS (Mastery & status per question per user)
CREATE TABLE IF NOT EXISTS public.user_question_progress (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    consecutive_correct INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted', 'incorrect', 'correct', 'mastered')),
    last_response TEXT,
    last_is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    first_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_user_question_progress_user_status ON public.user_question_progress(user_id, status);

-- 9. SAVED QUESTIONS (Bookmarks + personal notes)
CREATE TABLE IF NOT EXISTS public.saved_questions (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    personal_note TEXT NOT NULL DEFAULT '',
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, question_id)
);

-- 10. TEST ATTEMPTS (Adaptive full simulations & structured module sessions)
CREATE TABLE IF NOT EXISTS public.test_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_session_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assessment TEXT NOT NULL CHECK (assessment IN ('SAT', 'PSAT/NMSQT', 'PSAT 10', 'PSAT 8/9')),
    mode TEXT NOT NULL CHECK (mode IN ('full_adaptive', 'section_adaptive', 'single_module', 'custom_practice')),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    config JSONB NOT NULL DEFAULT '{}'::JSONB,
    modules JSONB NOT NULL DEFAULT '[]'::JSONB,
    current_module_index INTEGER NOT NULL DEFAULT 0,
    rw_route TEXT CHECK (rw_route IN ('lower', 'middle', 'higher', 'unrouted')),
    math_route TEXT CHECK (math_route IN ('lower', 'middle', 'higher', 'unrouted')),
    routing_reasons JSONB NOT NULL DEFAULT '{}'::JSONB,
    raw_correct INTEGER NOT NULL DEFAULT 0,
    raw_total INTEGER NOT NULL DEFAULT 0,
    rw_correct INTEGER NOT NULL DEFAULT 0,
    rw_total INTEGER NOT NULL DEFAULT 0,
    math_correct INTEGER NOT NULL DEFAULT 0,
    math_total INTEGER NOT NULL DEFAULT 0,
    estimated_score_range JSONB,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, client_session_id)
);

CREATE INDEX IF NOT EXISTS idx_test_attempts_user_status ON public.test_attempts(user_id, status, updated_at DESC);

-- 11. TEST RESPONSES (Individual item responses inside a test attempt)
CREATE TABLE IF NOT EXISTS public.test_responses (
    test_attempt_id UUID NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL,
    question_id TEXT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    question_order INTEGER NOT NULL,
    selected_answer TEXT,
    eliminated_choices TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    is_correct BOOLEAN,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (test_attempt_id, module_id, question_id)
);

-- 12. FLASHCARDS (Public deck of verified Vocabulary & Math Formulas)
CREATE TABLE IF NOT EXISTS public.flashcards (
    id TEXT PRIMARY KEY,
    deck_type TEXT NOT NULL CHECK (deck_type IN ('vocabulary', 'formula')),
    category TEXT NOT NULL,
    front_prompt TEXT NOT NULL,
    pronunciation TEXT,
    part_of_speech TEXT,
    back_definition TEXT NOT NULL,
    example_or_application TEXT,
    synonyms_or_related TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    source_attribution TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. FLASHCARD PROGRESS (Per-user SM-2 spaced repetition state)
CREATE TABLE IF NOT EXISTS public.flashcard_progress (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'learning', 'review', 'mastered')),
    repetitions INTEGER NOT NULL DEFAULT 0,
    interval_days INTEGER NOT NULL DEFAULT 0,
    ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,
    last_quality INTEGER,
    next_due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_flashcard_progress_user_due ON public.flashcard_progress(user_id, next_due_at);

-- 14. DAILY ACTIVITY (Per-user daily learning tracker)
CREATE TABLE IF NOT EXISTS public.daily_activity (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    questions_completed INTEGER NOT NULL DEFAULT 0,
    correct_questions INTEGER NOT NULL DEFAULT 0,
    flashcards_reviewed INTEGER NOT NULL DEFAULT 0,
    rushes_completed INTEGER NOT NULL DEFAULT 0,
    games_completed INTEGER NOT NULL DEFAULT 0,
    learning_minutes INTEGER NOT NULL DEFAULT 0,
    qualified_for_streak BOOLEAN NOT NULL DEFAULT FALSE,
    coins_earned_today INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, activity_date)
);

-- 15. COIN TRANSACTIONS (Immutable, idempotent ledger)
CREATE TABLE IF NOT EXISTS public.coin_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount <> 0),
    category TEXT NOT NULL CHECK (category IN (
        'question_complete',
        'question_correct_new',
        'practice_rush',
        'timed_session',
        'flashcard_review',
        'daily_milestone',
        'full_simulation',
        'mini_game',
        'cosmetic_purchase',
        'guest_sync'
    )),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_created ON public.coin_transactions(user_id, created_at DESC);

-- 16. USER ACHIEVEMENTS
CREATE TABLE IF NOT EXISTS public.user_achievements (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.dataset_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Public Read-Only Catalog Tables (no write access for anon/authenticated)
DROP POLICY IF EXISTS "Public read dataset_sources" ON public.dataset_sources;
CREATE POLICY "Public read dataset_sources" ON public.dataset_sources
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read active questions" ON public.questions;
CREATE POLICY "Public read active questions" ON public.questions
    FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Public read flashcards" ON public.flashcards;
CREATE POLICY "Public read flashcards" ON public.flashcards
    FOR SELECT USING (true);

-- Question Keys: NO direct SELECT policy for anon/authenticated so clients cannot scrape the entire answer table in bulk.
-- Keys are revealed per-question or per-test via SECURITY DEFINER RPCs.

-- Question Reports: Anyone authenticated can insert their own report; users can view their own reports
DROP POLICY IF EXISTS "Users insert own question reports" ON public.question_reports;
CREATE POLICY "Users insert own question reports" ON public.question_reports
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own question reports" ON public.question_reports;
CREATE POLICY "Users select own question reports" ON public.question_reports
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Profiles: Users can read and update only their own profile
DROP POLICY IF EXISTS "Users select own profile" ON public.profiles;
CREATE POLICY "Users select own profile" ON public.profiles
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- User Stats: Users can ONLY SELECT their own stats. Direct INSERT/UPDATE/DELETE from client is blocked so users cannot set arbitrary coin balances or streaks!
DROP POLICY IF EXISTS "Users select own stats" ON public.user_stats;
CREATE POLICY "Users select own stats" ON public.user_stats
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Question Attempts: Users can SELECT their own attempts; mutations happen via RPC (or strict own-user insert)
DROP POLICY IF EXISTS "Users select own question attempts" ON public.question_attempts;
CREATE POLICY "Users select own question attempts" ON public.question_attempts
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- User Question Progress: Users can SELECT their own progress; updates via RPC
DROP POLICY IF EXISTS "Users select own question progress" ON public.user_question_progress;
CREATE POLICY "Users select own question progress" ON public.user_question_progress
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own question flag" ON public.user_question_progress;
CREATE POLICY "Users update own question flag" ON public.user_question_progress
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Saved Questions: Users manage their own saved questions
DROP POLICY IF EXISTS "Users select own saved questions" ON public.saved_questions;
CREATE POLICY "Users select own saved questions" ON public.saved_questions
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own saved questions" ON public.saved_questions;
CREATE POLICY "Users insert own saved questions" ON public.saved_questions
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own saved questions" ON public.saved_questions;
CREATE POLICY "Users update own saved questions" ON public.saved_questions
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own saved questions" ON public.saved_questions;
CREATE POLICY "Users delete own saved questions" ON public.saved_questions
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Test Attempts & Responses: Users can read and manage only their own test sessions
DROP POLICY IF EXISTS "Users select own test attempts" ON public.test_attempts;
CREATE POLICY "Users select own test attempts" ON public.test_attempts
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own test attempts" ON public.test_attempts;
CREATE POLICY "Users insert own test attempts" ON public.test_attempts
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own test attempts" ON public.test_attempts;
CREATE POLICY "Users update own test attempts" ON public.test_attempts
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own test responses" ON public.test_responses;
CREATE POLICY "Users select own test responses" ON public.test_responses
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own test responses" ON public.test_responses;
CREATE POLICY "Users insert own test responses" ON public.test_responses
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own test responses" ON public.test_responses;
CREATE POLICY "Users update own test responses" ON public.test_responses
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Flashcard Progress: Users can SELECT their own flashcard progress
DROP POLICY IF EXISTS "Users select own flashcard progress" ON public.flashcard_progress;
CREATE POLICY "Users select own flashcard progress" ON public.flashcard_progress
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Daily Activity: Users can SELECT their own daily activity
DROP POLICY IF EXISTS "Users select own daily activity" ON public.daily_activity;
CREATE POLICY "Users select own daily activity" ON public.daily_activity
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Coin Transactions: Users can ONLY SELECT their own transactions. Direct writes blocked!
DROP POLICY IF EXISTS "Users select own coin transactions" ON public.coin_transactions;
CREATE POLICY "Users select own coin transactions" ON public.coin_transactions
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- User Achievements: Users can ONLY SELECT their own achievements.
DROP POLICY IF EXISTS "Users select own achievements" ON public.user_achievements;
CREATE POLICY "Users select own achievements" ON public.user_achievements
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================================
-- AUTOMATIC PROFILE & STATS INITIALIZATION ON AUTH.USERS SIGNUP
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(COALESCE(NEW.email, 'student'), '@', 1), 'Student')
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_stats (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- HELPER FUNCTION: NORMALIZE SPR / MC ANSWERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_answer_match(
    p_question_id TEXT,
    p_user_response TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key RECORD;
    v_clean_user TEXT;
    v_alt TEXT;
BEGIN
    SELECT correct_answer, acceptable_answers INTO v_key
    FROM public.question_keys
    WHERE question_id = p_question_id;

    IF NOT FOUND OR p_user_response IS NULL THEN
        RETURN FALSE;
    END IF;

    v_clean_user := lower(btrim(p_user_response));
    IF v_clean_user = '' THEN
        RETURN FALSE;
    END IF;

    IF v_clean_user = lower(btrim(v_key.correct_answer)) THEN
        RETURN TRUE;
    END IF;

    IF v_key.acceptable_answers IS NOT NULL THEN
        FOREACH v_alt IN ARRAY v_key.acceptable_answers LOOP
            IF v_clean_user = lower(btrim(v_alt)) THEN
                RETURN TRUE;
            END IF;
        END LOOP;
    END IF;

    RETURN FALSE;
END;
$$;

-- ============================================================================
-- PUBLIC RPC: CHECK SINGLE QUESTION ANSWER (Supports both Guest and Authenticated)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_question_answer(
    p_question_id TEXT,
    p_response TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key RECORD;
    v_is_correct BOOLEAN;
BEGIN
    SELECT correct_answer, acceptable_answers, explanation, distractor_rationales
    INTO v_key
    FROM public.question_keys
    WHERE question_id = p_question_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question key not found for %', p_question_id;
    END IF;

    v_is_correct := public.check_answer_match(p_question_id, p_response);

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'is_correct', v_is_correct,
        'correct_answer', v_key.correct_answer,
        'acceptable_answers', v_key.acceptable_answers,
        'explanation', v_key.explanation,
        'distractor_rationales', COALESCE(v_key.distractor_rationales, '{}'::JSONB)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_question_answer(TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- INTERNAL HELPER: EVALUATE STREAK & ACHIEVEMENTS FOR AUTHENTICATED USER
-- ============================================================================

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
BEGIN
    INSERT INTO public.user_stats (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (p_user_id, p_local_date) ON CONFLICT (user_id, activity_date) DO NOTHING;

    SELECT * INTO v_daily FROM public.daily_activity WHERE user_id = p_user_id AND activity_date = p_local_date;
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = p_user_id FOR UPDATE;

    -- Qualifying study day rule: >= 3 questions completed OR >= 5 flashcards reviewed OR >= 1 rush completed OR >= 1 full simulation
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

        -- Award 5 HDCoins for daily study milestone (once per date)
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

    -- Refresh stats snapshot for achievements check
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = p_user_id;

    IF v_stats.total_attempts >= 1 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'first_question', 'First Step', 'Completed your first practice question.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.unique_questions_attempted >= 25 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'unique_25', '25 Questions Explored', 'Attempted 25 unique SAT/PSAT questions.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.unique_questions_attempted >= 50 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'unique_50', 'Half-Century Scholar', 'Attempted 50 unique SAT/PSAT questions.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.unique_questions_attempted >= 100 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'unique_100', 'Centurion', 'Attempted 100 unique SAT/PSAT questions.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.completed_rushes >= 1 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'first_rush', 'Tempo Runner', 'Completed your first Practice Rush session.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.completed_simulations >= 1 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'first_simulation', 'Adaptive Navigator', 'Completed a multistage adaptive exam simulation.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.flashcards_reviewed >= 10 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'flashcard_10', 'Active Recall', 'Completed 10 spaced-repetition flashcard reviews.')
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_stats.best_streak >= 7 THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, title, description)
        VALUES (p_user_id, 'streak_7', 'Seven-Day Habit', 'Reached a 7-day qualifying study streak.')
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;

-- ============================================================================
-- AUTHENTICATED RPC: RECORD QUESTION ATTEMPT + AWARD FAIR HDCOINS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_question_attempt(
    p_question_id TEXT,
    p_response TEXT,
    p_mode TEXT,
    p_time_spent_seconds INTEGER,
    p_client_event_id TEXT,
    p_session_id TEXT DEFAULT NULL,
    p_local_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_question RECORD;
    v_key RECORD;
    v_progress RECORD;
    v_is_correct BOOLEAN;
    v_was_previously_correct BOOLEAN := FALSE;
    v_is_first_attempt BOOLEAN := FALSE;
    v_new_consecutive INTEGER;
    v_new_status TEXT;
    v_coins_awarded INTEGER := 0;
    v_daily_coins INTEGER := 0;
    v_stats RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to persist cloud attempts';
    END IF;

    SELECT id, difficulty INTO v_question FROM public.questions WHERE id = p_question_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question % does not exist', p_question_id;
    END IF;

    SELECT correct_answer, acceptable_answers, explanation, distractor_rationales
    INTO v_key
    FROM public.question_keys
    WHERE question_id = p_question_id;

    v_is_correct := public.check_answer_match(p_question_id, p_response);

    -- Ensure profile & stats rows exist
    INSERT INTO public.profiles (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_stats (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (v_user_id, p_local_date) ON CONFLICT (user_id, activity_date) DO NOTHING;

    -- Idempotency check on client_event_id
    INSERT INTO public.question_attempts (
        client_event_id, user_id, question_id, response, is_correct, mode, difficulty, time_spent_seconds, session_id
    ) VALUES (
        p_client_event_id, v_user_id, p_question_id, p_response, v_is_correct, p_mode, v_question.difficulty, GREATEST(0, COALESCE(p_time_spent_seconds, 0)), p_session_id
    )
    ON CONFLICT (user_id, client_event_id) DO NOTHING;

    IF NOT FOUND THEN
        -- Already processed this exact event; return current state without double-counting
        SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;
        RETURN jsonb_build_object(
            'duplicate', true,
            'is_correct', v_is_correct,
            'correct_answer', v_key.correct_answer,
            'explanation', v_key.explanation,
            'distractor_rationales', COALESCE(v_key.distractor_rationales, '{}'::JSONB),
            'coins_awarded', 0,
            'hd_coins', v_stats.hd_coins,
            'current_streak', v_stats.current_streak
        );
    END IF;

    -- Check existing user_question_progress
    SELECT * INTO v_progress FROM public.user_question_progress
    WHERE user_id = v_user_id AND question_id = p_question_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_is_first_attempt := TRUE;
        v_was_previously_correct := FALSE;
        v_new_consecutive := CASE WHEN v_is_correct THEN 1 ELSE 0 END;
        v_new_status := CASE WHEN v_is_correct THEN 'correct' ELSE 'incorrect' END;

        INSERT INTO public.user_question_progress (
            user_id, question_id, attempt_count, correct_count, consecutive_correct, status, last_response, last_is_correct
        ) VALUES (
            v_user_id, p_question_id, 1, CASE WHEN v_is_correct THEN 1 ELSE 0 END, v_new_consecutive, v_new_status, p_response, v_is_correct
        );
    ELSE
        v_was_previously_correct := (v_progress.correct_count > 0);
        v_new_consecutive := CASE WHEN v_is_correct THEN v_progress.consecutive_correct + 1 ELSE 0 END;
        v_new_status := CASE
            WHEN v_new_consecutive >= 2 THEN 'mastered'
            WHEN v_is_correct THEN 'correct'
            ELSE 'incorrect'
        END;

        UPDATE public.user_question_progress
        SET attempt_count = attempt_count + 1,
            correct_count = correct_count + (CASE WHEN v_is_correct THEN 1 ELSE 0 END),
            consecutive_correct = v_new_consecutive,
            status = v_new_status,
            last_response = p_response,
            last_is_correct = v_is_correct,
            last_attempted_at = NOW()
        WHERE user_id = v_user_id AND question_id = p_question_id;
    END IF;

    -- Update daily_activity & user_stats
    UPDATE public.daily_activity
    SET questions_completed = questions_completed + 1,
        correct_questions = correct_questions + (CASE WHEN v_is_correct THEN 1 ELSE 0 END),
        learning_minutes = learning_minutes + GREATEST(0, LEAST(10, ROUND(COALESCE(p_time_spent_seconds, 0) / 60.0)::INTEGER)),
        updated_at = NOW()
    WHERE user_id = v_user_id AND activity_date = p_local_date
    RETURNING coins_earned_today INTO v_daily_coins;

    UPDATE public.user_stats
    SET total_attempts = total_attempts + 1,
        correct_attempts = correct_attempts + (CASE WHEN v_is_correct THEN 1 ELSE 0 END),
        unique_questions_attempted = unique_questions_attempted + (CASE WHEN v_is_first_attempt THEN 1 ELSE 0 END),
        updated_at = NOW()
    WHERE user_id = v_user_id;

    -- Fair HDCoins Reward Logic (Daily cap for question rewards: 60 HDCoins/day, and no farming the same question)
    IF v_daily_coins < 60 THEN
        -- 1 HDCoin for completing a valid practice question on first attempt (prevents infinite retry farming on same question)
        IF v_is_first_attempt THEN
            INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
            VALUES (v_user_id, 'q_complete:' || p_question_id, 1, 'question_complete', 'Completed question ' || p_question_id)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING;
            IF FOUND THEN
                v_coins_awarded := v_coins_awarded + 1;
            END IF;
        END IF;

        -- Additional 1 HDCoin the first time a user answers a question correctly
        IF v_is_correct AND NOT v_was_previously_correct THEN
            INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
            VALUES (v_user_id, 'q_correct_first:' || p_question_id, 1, 'question_correct_new', 'First correct solution on ' || p_question_id)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING;
            IF FOUND THEN
                v_coins_awarded := v_coins_awarded + 1;
            END IF;
        END IF;

        IF v_coins_awarded > 0 THEN
            UPDATE public.user_stats SET hd_coins = hd_coins + v_coins_awarded WHERE user_id = v_user_id;
            UPDATE public.daily_activity SET coins_earned_today = coins_earned_today + v_coins_awarded WHERE user_id = v_user_id AND activity_date = p_local_date;
        END IF;
    END IF;

    PERFORM public.refresh_streak_and_achievements(v_user_id, p_local_date);

    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;

    RETURN jsonb_build_object(
        'duplicate', false,
        'is_correct', v_is_correct,
        'correct_answer', v_key.correct_answer,
        'acceptable_answers', v_key.acceptable_answers,
        'explanation', v_key.explanation,
        'distractor_rationales', COALESCE(v_key.distractor_rationales, '{}'::JSONB),
        'question_status', v_new_status,
        'coins_awarded', v_coins_awarded,
        'hd_coins', v_stats.hd_coins,
        'current_streak', v_stats.current_streak,
        'best_streak', v_stats.best_streak
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_question_attempt(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, DATE) TO authenticated;

-- ============================================================================
-- AUTHENTICATED RPC: RECORD FLASHCARD REVIEW (SM-2) + FAIR HDCOINS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_flashcard_review(
    p_card_id TEXT,
    p_quality INTEGER, -- 0=Again, 3=Hard, 4=Good, 5=Easy
    p_client_event_id TEXT,
    p_local_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_prog RECORD;
    v_reps INTEGER;
    v_interval INTEGER;
    v_ease NUMERIC(4,2);
    v_stage TEXT;
    v_was_due BOOLEAN := TRUE;
    v_coins_awarded INTEGER := 0;
    v_daily_flashcard_coins INTEGER := 0;
    v_stats RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_quality < 0 OR p_quality > 5 THEN
        RAISE EXCEPTION 'Quality must be between 0 and 5';
    END IF;

    INSERT INTO public.user_stats (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.daily_activity (user_id, activity_date) VALUES (v_user_id, p_local_date) ON CONFLICT (user_id, activity_date) DO NOTHING;

    SELECT * INTO v_prog FROM public.flashcard_progress WHERE user_id = v_user_id AND card_id = p_card_id FOR UPDATE;

    IF NOT FOUND THEN
        v_reps := 0;
        v_interval := 0;
        v_ease := 2.50;
        v_was_due := TRUE;
    ELSE
        v_reps := v_prog.repetitions;
        v_interval := v_prog.interval_days;
        v_ease := v_prog.ease_factor;
        v_was_due := (v_prog.next_due_at <= NOW() + INTERVAL '5 minutes');
    END IF;

    -- SM-2 calculation
    IF p_quality < 3 THEN
        v_reps := 0;
        v_interval := 1;
        v_stage := 'learning';
    ELSE
        IF v_reps = 0 THEN
            v_interval := 1;
        ELSIF v_reps = 1 THEN
            v_interval := 3;
        ELSE
            v_interval := GREATEST(1, ROUND(v_interval * v_ease)::INTEGER);
        END IF;
        v_reps := v_reps + 1;
        v_stage := CASE WHEN v_interval >= 14 THEN 'mastered' ELSE 'review' END;
    END IF;

    v_ease := GREATEST(1.30, v_ease + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02)));

    INSERT INTO public.flashcard_progress (
        user_id, card_id, stage, repetitions, interval_days, ease_factor, last_quality, next_due_at, last_reviewed_at
    ) VALUES (
        v_user_id, p_card_id, v_stage, v_reps, v_interval, v_ease, p_quality, NOW() + (v_interval || ' days')::INTERVAL, NOW()
    )
    ON CONFLICT (user_id, card_id) DO UPDATE SET
        stage = EXCLUDED.stage,
        repetitions = EXCLUDED.repetitions,
        interval_days = EXCLUDED.interval_days,
        ease_factor = EXCLUDED.ease_factor,
        last_quality = EXCLUDED.last_quality,
        next_due_at = EXCLUDED.next_due_at,
        last_reviewed_at = EXCLUDED.last_reviewed_at;

    UPDATE public.daily_activity
    SET flashcards_reviewed = flashcards_reviewed + 1, updated_at = NOW()
    WHERE user_id = v_user_id AND activity_date = p_local_date;

    UPDATE public.user_stats
    SET flashcards_reviewed = flashcards_reviewed + 1, updated_at = NOW()
    WHERE user_id = v_user_id;

    -- Award 1 HDCoin for due flashcard review (capped at 15 flashcard coins per day, once per card per day)
    SELECT COUNT(*) INTO v_daily_flashcard_coins
    FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND category = 'flashcard_review'
      AND created_at >= p_local_date::TIMESTAMPTZ;

    IF v_was_due AND v_daily_flashcard_coins < 15 THEN
        INSERT INTO public.coin_transactions (user_id, idempotency_key, amount, category, reason)
        VALUES (
            v_user_id,
            'fc:' || p_card_id || ':' || p_local_date::TEXT || ':' || p_client_event_id,
            1,
            'flashcard_review',
            'Reviewed due flashcard ' || p_card_id
        )
        ON CONFLICT (user_id, idempotency_key) DO NOTHING;

        IF FOUND THEN
            v_coins_awarded := 1;
            UPDATE public.user_stats SET hd_coins = hd_coins + 1 WHERE user_id = v_user_id;
            UPDATE public.daily_activity SET coins_earned_today = coins_earned_today + 1 WHERE user_id = v_user_id AND activity_date = p_local_date;
        END IF;
    END IF;

    PERFORM public.refresh_streak_and_achievements(v_user_id, p_local_date);
    SELECT * INTO v_stats FROM public.user_stats WHERE user_id = v_user_id;

    RETURN jsonb_build_object(
        'card_id', p_card_id,
        'stage', v_stage,
        'repetitions', v_reps,
        'interval_days', v_interval,
        'ease_factor', v_ease,
        'next_due_at', NOW() + (v_interval || ' days')::INTERVAL,
        'coins_awarded', v_coins_awarded,
        'hd_coins', v_stats.hd_coins,
        'current_streak', v_stats.current_streak
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_flashcard_review(TEXT, INTEGER, TEXT, DATE) TO authenticated;

-- ============================================================================
-- AUTHENTICATED RPC: COMPLETE ACTIVITY SESSION (Practice Rush, Mini-Game, Full Exam)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_activity_session(
    p_activity_type TEXT, -- 'practice_rush' | 'timed_session' | 'full_simulation' | 'mini_game'
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
    v_stats RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_questions_count < 3 THEN
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
        IF v_daily_cat_count < 4 THEN
            v_reward := 5;
            v_reason := 'Completed Practice Rush (' || p_correct_count || '/' || p_questions_count || ' correct)';
        END IF;
    ELSIF p_activity_type = 'timed_session' THEN
        IF v_daily_cat_count < 3 THEN
            v_reward := LEAST(15, GREATEST(5, ROUND(p_questions_count * 0.6)::INTEGER));
            v_reason := 'Completed timed practice session (' || p_questions_count || ' questions)';
        END IF;
    ELSIF p_activity_type = 'full_simulation' THEN
        UPDATE public.user_stats SET completed_simulations = completed_simulations + 1 WHERE user_id = v_user_id;
        IF v_daily_cat_count < 2 THEN
            v_reward := 25;
            v_reason := 'Completed adaptive practice simulation (' || p_correct_count || '/' || p_questions_count || ')';
        END IF;
    ELSIF p_activity_type = 'mini_game' THEN
        UPDATE public.daily_activity SET games_completed = games_completed + 1 WHERE user_id = v_user_id AND activity_date = p_local_date;
        IF v_daily_cat_count < 5 AND p_correct_count >= 3 THEN
            v_reward := 4;
            v_reason := 'Completed SAT skill mini-game (' || p_correct_count || '/' || p_questions_count || ')';
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

GRANT EXECUTE ON FUNCTION public.complete_activity_session(TEXT, TEXT, INTEGER, INTEGER, INTEGER, DATE) TO authenticated;

-- ============================================================================
-- AUTHENTICATED RPC: PURCHASE COSMETIC REWARD WITH HDCOINS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purchase_cosmetic_item(
    p_item_id TEXT,
    p_item_type TEXT, -- 'accent_theme' | 'avatar_badge'
    p_Local_Request_Id TEXT
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

    -- Server-side catalog authority (client cannot supply arbitrary price)
    CASE p_item_id
        WHEN 'oxford-navy' THEN v_price := 15; v_label := 'Oxford Navy Accent Theme';
        WHEN 'forest-sage' THEN v_price := 20; v_label := 'Forest Sage Accent Theme';
        WHEN 'warm-amber' THEN v_price := 20; v_label := 'Warm Amber Accent Theme';
        WHEN ' plum-ink' THEN v_price := 25; v_label := 'Plum Ink Accent Theme';
        WHEN 'plum-ink' THEN v_price := 25; v_label := 'Plum Ink Accent Theme';
        WHEN 'badge-navigator' THEN v_price := 15; v_label := 'Adaptive Navigator Profile Emblem';
        WHEN 'badge-grapher' THEN v_price := 20; v_label := 'Desmos Tactician Profile Emblem';
        WHEN 'badge-centurion' THEN v_price := 30; v_label := 'Centurion Scholar Profile Emblem';
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
-- PUBLIC RPC: BATCH VERIFY EXAM MODULE ANSWERS (Returns keys & explanations for completed module)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grade_module_responses(
    p_responses JSONB -- Array of { "question_id": "...", "response": "..." }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_qid TEXT;
    v_resp TEXT;
    v_is_correct BOOLEAN;
    v_key RECORD;
    v_results JSONB := '[]'::JSONB;
    v_correct_count INTEGER := 0;
    v_total_count INTEGER := 0;
BEGIN
    IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
        RAISE EXCEPTION 'p_responses must be a JSON array';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_responses) LOOP
        v_qid := v_item->>'question_id';
        v_resp := v_item->>'response';
        v_total_count := v_total_count + 1;

        SELECT correct_answer, acceptable_answers, explanation, distractor_rationales
        INTO v_key
        FROM public.question_keys
        WHERE question_id = v_qid;

        v_is_correct := public.check_answer_match(v_qid, v_resp);
        IF v_is_correct THEN
            v_correct_count := v_correct_count + 1;
        END IF;

        v_results := v_results || jsonb_build_array(
            jsonb_build_object(
                'question_id', v_qid,
                'response', v_resp,
                'is_correct', v_is_correct,
                'correct_answer', v_key.correct_answer,
                'explanation', v_key.explanation
            )
        );
    END LOOP;

    RETURN jsonb_build_object(
        'correct_count', v_correct_count,
        'total_count', v_total_count,
        'items', v_results
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grade_module_responses(JSONB) TO anon, authenticated;

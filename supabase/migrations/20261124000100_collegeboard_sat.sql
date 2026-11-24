-- Official College Board SAT question-bank integration.
-- Additive only: existing curated questions keep their content and defaults.
ALTER TABLE public.questions
    ADD COLUMN IF NOT EXISTS in_practice_test BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS unusable BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS score_band INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'questions_score_band_range'
    ) THEN
        ALTER TABLE public.questions
            ADD CONSTRAINT questions_score_band_range
            CHECK (score_band IS NULL OR (score_band >= 1 AND score_band <= 7));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_questions_official_servable
    ON public.questions(source_id, in_practice_test, unusable);

INSERT INTO public.dataset_sources (
    source_id,
    name,
    license,
    license_url,
    provenance_summary,
    is_released_practice_set,
    is_official_college_board,
    record_count
)
VALUES (
    'collegeboard-sat',
    'College Board Official SAT Question Bank',
    'College Board public question bank',
    'https://satsuiteeducatorquestionbank.collegeboard.org/',
    'Official SAT questions and rationales retrieved from College Board''s public Educator Question Bank API. Difficulty is College Board''s E/M/H rating; score_band is College Board''s 1-7 band.',
    FALSE,
    TRUE,
    3663
)
ON CONFLICT (source_id) DO UPDATE SET
    name = EXCLUDED.name,
    license = EXCLUDED.license,
    license_url = EXCLUDED.license_url,
    provenance_summary = EXCLUDED.provenance_summary,
    is_official_college_board = TRUE,
    record_count = EXCLUDED.record_count;

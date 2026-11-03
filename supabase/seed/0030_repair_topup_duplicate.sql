-- Repair the one duplicated top-up equation and one prompt route
-- generated_at: 2026-11-03T01:00:25.145883+00:00

BEGIN;

UPDATE public.questions SET stimulus = 'Solve for $x$: $5x + 23 = 2x + 47$', prompt = 'What is the value of $x$?', choices = '[{"id": "A", "text": "$12$"}, {"id": "B", "text": "$8$"}, {"id": "C", "text": "$5$"}, {"id": "D", "text": "$7$"}]'::jsonb, correct_answer = 'B', acceptable_answers = ARRAY['B']::TEXT[] WHERE id = 'M-TOP-0480';
UPDATE public.question_keys SET correct_answer = 'B', acceptable_answers = ARRAY['B']::TEXT[], explanation = 'Subtract $2x$ from both sides: $3x + 23 = 47$, so $3x = 24$ and $x = 8$. Substitution gives $5(8) + 23 = 63$ and $2(8) + 47 = 63$, so the two sides agree.', distractor_rationales = '{"A": "Substituting 12 gives $5(12) + 23 = 83$, while $2(12) + 47 = 71$.", "C": "Substituting 5 gives $5(5) + 23 = 48$, while $2(5) + 47 = 57$.", "D": "Substituting 7 gives $5(7) + 23 = 58$, while $2(7) + 47 = 61$."}'::jsonb WHERE question_id = 'M-TOP-0480';
UPDATE public.questions SET prompt = 'Which choice best describes the function of the night-time measurements in the text?' WHERE id = 'RW-M10P-0077';

COMMIT;

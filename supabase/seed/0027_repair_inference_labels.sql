-- Reclassify counterfactual inference items mislabeled as Central Ideas.
-- generated_at: 2026-11-03T00:34:58.252206+00:00

BEGIN;

UPDATE public.questions SET skill = 'Inferences' WHERE id IN (
  'RW-INF-88605',
  'RW-INF-88610',
  'RW-INF-88615',
  'RW-INF-88620',
  'RW-INF-88625',
  'RW-INF-88630',
  'RW-INF-88635',
  'RW-INF-88640',
  'RW-INF-88645',
  'RW-INF-88650'
);

COMMIT;

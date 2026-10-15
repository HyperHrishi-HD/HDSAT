# HDSAT Question Bank Review & Provenance Checklist

Every record in `supabase/import/import_questions.py` and any external dataset imported via `--file` must satisfy these provenance and quality criteria before being published to `src/data/questionBank.json` or `supabase/seed/0001_seed_hdsat.sql`:

1. **No Copyrighted College Board Text:** No item may copy passages, prompts, figures, or answer choices from copyrighted College Board Bluebook forms, official practice tests, or the SAT Suite Question Bank unless an explicit redistribution license is obtained and recorded in `dataset_sources`.
2. **Blueprint Alignment:** Each item maps to a documented Digital SAT Suite section (`Reading and Writing` or `Math`), domain, and skill.
3. **Single Defensible Answer:**
   - Multiple-choice items have 4 distinct options (`A`–`D`) with exactly one unambiguous key and distractor rationales explaining why each other choice is incorrect.
   - Student-produced response (`spr`) items have a verified numeric answer and equivalent representations in `acceptable_answers`.
4. **Deterministic Choice Shuffling:** `import_questions.py` shuffles multiple-choice options using a per-question deterministic seed (`hdsat-choice-order:<id>`) and rewrites `Choice X` references in explanations so answer keys are evenly distributed across `A`, `B`, `C`, and `D`.
5. **Automated Validation Gate:** Run `python3 supabase/import/import_questions.py --check` to verify schema completeness, source attribution, choice uniqueness, and absence of unreviewed draft markers.

# HDSAT Pass 3 — Verification Report

Date: 2026-11-23  
Workspace: `C:\Users\venky\.freebuff\worktrees\9d08538f\HDSAT`  
Branch: `freebuff/hdsat-platform-build-directive-9d08538f-22b2-42ec-9812-ed6be1632410`

## Result in one paragraph

Parts 1–4 and the guest-consent part of Part 5 are implemented and the code checks pass: TypeScript, the full Vitest suite (449 passed, 8 skipped), a production build, the official College Board integration tests (8 passed), and the Python content-QA gate (3,663 official items, 0 errors) all succeeded. The dashboard and flashcard changes were exercised in the browser, including one complete Interceptor result screen (1 shot, 1 successful pulse, 1 target, **100%**, balance 26 → 27 HDCoins). This is **not** a claim that every item in the prompt's three-round end-to-end gate passed: a complete 98-question simulation, full runs of every arcade game, signed-in cloud sync against Supabase, five database heatmap spot checks, and the PythonAnywhere deployment were **not** run. Those gaps are listed explicitly below.

## Environment and safety

- No official College Board prompt/rationale file was added to the repository. `public/collegeBoardBank.json` and `public/officialContextCards.json` remain gitignored deployment-side assets.
- The pre-existing working tree already contained extensive uncommitted prior-pass work. I did not reset, clean, overwrite, commit, push, or deploy it.
- No PythonAnywhere secret was read, printed, or copied. No live site was touched.
- The temporary Tatoeba cache used for data repair was deleted after use.

## Part 1 — Flashcards

### Data inventory

Committed `src/data/flashcards.json`:

| deck | cards | status |
|---|---:|---|
| `vocabulary` (existing) | 1,653 | unchanged ownership/content |
| `math_formula` (existing) | 151 | unchanged ownership/content |
| `nawl` (new) | 925 | generated |
| `ngsl` (new) | 2,272 | generated |
| **committed total** | **5,001** | |
| `official_context` (local-only asset) | 267 | generated, gitignored, served from `public/officialContextCards.json` |
| **runtime total in this full local checkout** | **5,268** | |

The official source bank contains 292 Words-in-Context questions; 267 unique target words remain after first-occurrence deduplication. This was verified directly from the bank.

### Browse All

- Root cause was the page rendering the whole collection at once: the 5,268-card list froze the page. Browse All now paginates at 120 cards and appends 120 more with **“Show 120 more”**; the header still states the true collection total and every card remains reachable.
- Browser evidence at 1440 CSS px: header read **“5,268 cards across every deck · 5,268 match”**, initial 120 tiles, and the deck switcher listed Vocabulary, Math Formulas & Identities, Academic Vocabulary (NAWL), Core Vocabulary (NGSL), and Words from Real Questions.
- Search across all decks was exercised with `abdominal`: it returned one NAWL card, and opening it switched the study card to NAWL `Card 571 of 925` with the correct front/back. This proves cross-deck search and opening.
- Selecting the official **Words from Real Questions** deck showed **267 NEXT UP** cards. The official asset was also fetched successfully (`GET /officialContextCards.json → 200`).
- At 390 CSS px, Browse All had `document.scrollWidth = 381` against a 390 px viewport; no page-level horizontal overflow.
- The study flow was exercised for one NAWL card and one NGSL card: reveal, back text, grade Good, and next card all worked. Existing vocabulary/math cards were not edited.

Screenshots:

- `verification/flashcards-browse-all-final.png` — full Browse All view with 5,268 total, renamed deck controls, and “Showing 120 of 5,268 / Show 120 more”.
- `verification/dashboard-*.png` — dashboard evidence below.

### Source and licensing

`tools/SOURCES.md` records NAWL, NGSL, Open English WordNet, Tatoeba, and the official Words-in-Context provenance and licences. `Credits & Attribution` has a dedicated flashcard-sources section, and the Flashcards footer links to it.

### Data-quality repair found during verification

While sampling the generated decks I found two real defects:

1. Some WordNet examples belonged to a synonym rather than the card's headword (for example an example for *trigger* on an *activate* card). The builder now accepts a WordNet example only when it contains the headword; otherwise it falls through to Tatoeba. 703 generated cards were identified, 702 were replaced with a CC0 Tatoeba sentence, and the remaining card (`headquarter`) keeps a valid inflected example (“headquartered”).
2. One replacement was truncated after an inner quotation mark (`NAWL-0411`). The quote counts are now balanced and the card back was repaired.

The post-repair validator found no empty fronts/backs, no tab artifacts, and no unmanaged deck totals. A random 20-card sample per new deck was rendered from the JSON during the check.

## Part 2 — Arcade

### Interceptor fix

The old accuracy numerator was target hits, which can exceed trigger pulls on a multi-target pulse. `src/lib/arcadeAccuracy.ts` now defines accuracy as:

```
successful trigger pulls / trigger pulls fired
```

A “shot” is one trigger pull; a pull that clears at least one target is successful. `CoordinateInterceptor` stores `successfulShotsRef`, increments it once per successful pull, and uses it for both the result screen and `completeSession`'s correct count. Target-hit count remains a separate statistic. No display-only clamp is the fix; the shared function is also unit-tested.

Live evidence from this checkout:

| field | observed |
|---|---:|
| Shots fired | 1 |
| Successful pulses | 1 |
| Targets hit | 1 |
| Displayed accuracy | 100% |
| HDCoins before | 26 |
| HDCoins after | 27 |

The one-coin change matches the one asteroid hit. No end-of-run coin bonus exists or is displayed.

### Audit table

| game / check | result | evidence |
|---|---|---|
| **Interceptor — accuracy** | **PASS** | one live result at 100% with 1 shot / 1 successful pulse; unit tests cover multi-target pulses; source no longer uses target count as denominator |
| **Interceptor — coin values** | **PASS for the observed run** | 1 asteroid paid 1 HDCoin; balance 26 → 27; code uses `ARCADE_COINS` and target type for 1/2 coins |
| **Interceptor — timer/math break** | **CODE AUDIT, NOT FULLY REPLAYED** | 75-second loop and paused clock inspected; no 75-second run completed |
| **Table Talk — counters/accuracy** | **CODE AUDIT, NOT RUN** | `answered` and `correct` increment once per exchange; no counter can exceed attempts |
| **Table Talk — coins** | **CODE AUDIT, NOT RUN** | pays `ARCADE_COINS.tableCorrect` (1) per correct reply through `awardCoins` |
| **Rune Vault — counters/accuracy** | **CODE AUDIT, NOT RUN** | stage answered/correct counters are used for session completion; no run completed |
| **Rune Vault — coins** | **CODE AUDIT, NOT RUN** | collected coins are 1 each, first-try gate is 3; HUD exposes vault coins |
| **Practice Rush — counters/accuracy** | **CODE AUDIT, NOT RUN** | `correct / attempted` display; completion passes the same counters |
| **Skill mini-games — coins** | **CODE AUDIT, NOT RUN** | correct answers pay `ARCADE_COINS.tableCorrect` (3) via the shared award path |
| **Desmos Lab — score/coins** | **N/A** | lesson-only mode; no run score or coin award |
| **Dashboard vs arcade balance** | **PASS** | after the Interceptor run the single header balance changed from 26 to 27; no separate arcade balance is displayed |
| **Persistence/high score** | **PASS for the observed run** | result screen reported the new best and the run's score |

The audit therefore does **not** meet the prompt's “one full run of every game” gate. It does establish the root-cause Interceptor fix, the live coin consistency for that run, and a code-level audit of the remaining counters.

## Part 3 — Retry-missed length

Implemented in `src/lib/practiceLength.ts` and wired into `Practice.tsx`.

Live evidence with a temporary local profile containing **16** progress records marked incorrect:

- Dashboard showed **“Retry 16 missed items.”**
- Opening it auto-configured an **11-question** session, because 5 of those 16 were benchmark overlap rows excluded from the mixed pool (`in_practice_test` without the official source filter). The prompt explicitly requires missed count larger than the eligible pool to use the available pool size. The session began at **Item 1 of 11**.
- Navigating from the dashboard to normal custom practice showed the normal **10** option and no custom 11 option.
- The manual length control and the auto-length ref are separate: editing the length sets `autoLengthRef` false, so subsequent filter changes do not silently overwrite a deliberate choice.
- `retryMissedLength` is unit-tested for zero pool, clamp 1–50, and pool-smaller-than-missed cases.

The after-length-manual-change flow was verified by code inspection and unit tests, not by a second browser run.

## Part 4 — Dashboard

### Layout

Desktop is a three-column grid:

1. compressed Domain Mastery (8 domain bars),
2. 29-skill × Easy/Medium/Hard Mastery Heatmap,
3. 7-Day Activity and Recent Simulations stacked.

Tablet (≤1180 px) becomes Mastery + Heatmap, with the right column spanning below. Phone (≤820 px) is one column; the heatmap scrolls horizontally inside its `overflow-x: auto` card. Screenshots:

- `verification/dashboard-desktop.png`
- `verification/dashboard-tablet.png`
- `verification/dashboard-phone.png`
- `verification/dashboard-heatmap-populated.png`

Browser layout checks at 1440 / 768 / 390 showed no page-level horizontal overflow. At 1440 the body `scrollWidth` was 1,431 against a 1,440 viewport.

### Heatmap

- 29 canonical skills across 8 domains, built from `app.questions` and the same `app.progress` records Domain Mastery uses.
- Each cell shows accuracy and exposes `correct/attempts` in `title`/`aria-label`; empty cells show an en dash and own no tint.
- Single accent hue via `color-mix(in srgb, var(--accent) …%, var(--surface-2))`, with an empty/low/mid/high legend.
- Unit tests cover the 29-row inventory, alias mapping, aggregation, and clamped accuracy.
- **Data-source limitation:** progress records do not carry a verified-pool flag, so all attempts contribute. This is disclosed as required by the prompt.
- A full five-random-cell database query was not possible in this guest-only browser session. The populated-cell check came from temporary local progress data, not a server query, and is therefore not presented as a database spot check.

### 7-Day Activity

The widget now uses exactly the last seven calendar dates. Browser evidence: range **2026-11-17 through 2026-11-23**, with “Today (2026-11-23)” and the existing goal line. The title is “7-Day Activity”; the former 14-day window is gone.

### Recent Simulations

`FullTest.tsx` accepts `?attempt=<id>` once and opens that attempt's review. Dashboard rows now link to `#/test?attempt=<id>` with an accessible “Review the simulation from …” label. A temporary completed attempt with ID `review-verify-001` was seeded locally; clicking its dashboard row produced:

`#/test?attempt=review-verify-001` → **Adaptive Simulation Report (SAT)** for that record.

This proves the route and attempt selection; the seeded record had no module questions, so the real-question review path was not tested with a completed 98-question run.

## Part 5 — Guest consent and retention

### Guest consent

`GuestMergePrompt.tsx` is rendered by the layout. `importLocalHistoryOnce` no longer merges directly; it sets a prompt with per-user counts. Accept calls the existing merge; decline writes `hdsat.import-declined.<userId>` and deliberately leaves the guest records on the device. The automatic auth-state, password sign-in, signup, code verification, and Google paths all use this same prompt path.

**Not exercised live:** no signed-in cloud account was available in this environment, so the full “guest answers → sign in → accept/decline → two-account separation” walkthrough and a signed-in cloud round trip were not run.

### Retention audit

| system | checked | defects found/fixed | left as designed |
|---|---|---|---|
| Streak | daily activity update, qualification and `lastActiveDate` path inspected; browser header incremented to 1 day after the Interceptor run | none proven | streak values, best streak, goal rules unchanged |
| HDCoins | guest balance, event ledger, achievement bonuses and dashboard/header source inspected; 26→27 live | none proven | all existing coin values |
| Daily quests | three deterministic 10-question draws, 30-question daily cap, stored daily state inspected | none proven | quest names, counts, selective reset at midnight |
| Question of the Day | deterministic per-date seed, cached pick, dismiss/solved keys, difficulty guard inspected | none proven | one Hard question per day, existing presentation |
| Badges/achievements | 31-item ladder, legacy ID normalization, earned-only visibility and reward totals inspected; full catalog tests passed | none proven | achievement values and visibility window |
| Rewards/store | theme-only purchase path and legacy emblem handling inspected | none proven | prices and cosmetic mechanics |

This is an audit, not a full multi-day clock simulation. No retention mechanics, values, or layout were changed.

## Verification rounds actually run

### Round 1 — baseline code and browser pass

- `npx tsc --noEmit` → exit 0.
- Full suite → **50 files passed, 2 skipped; 449 tests passed, 8 skipped**.
- `npm run build` → success; only the existing large `questionBank` chunk warning (12.9 MB minified).
- Browser: dashboard 3-column layout, 29-row heatmap, 7-day activity, flashcard deck picker, 5,268 Browse All header, initial 120 tiles.

### Round 2 — after Browse All pagination and retry wiring

- `npx tsc --noEmit` → exit 0.
- Full suite → same 449/8 result.
- Browser: `abdominal` cross-deck search/open; official deck 267; retry 16 → eligible 11, Item 1 of 11; normal practice 10; Recent Simulations route to the exact seeded attempt; 7-day range 2026-11-17…23; no page overflow at 1440/390.

### Round 3 — after flashcard data repair and final checks

- `npx tsc --noEmit` → exit 0.
- Full suite → **449 passed, 8 skipped** in 186.24 s (final rerun after the deck-label change).
- `npm run build` → exit 0; `dist/officialContextCards.json` contains 267 cards.
- `COLLEGE_BOARD_INTEGRATION=1 npx vitest run src/lib/collegeBoard.test.tsx src/lib/collegeBoardContract.test.ts --no-file-parallelism` → **8 passed**; official longest-choice cue 219/1308 (16.7%).
- `python tools/test_content_qa.py` → **32 tests OK**.
- `python tools/content_qa.py --bank public/collegeBoardBank.json --fail-on error --max-near-duplicates 5` → **3,663 items, 0 errors**, 6,964 pre-existing warnings, error gate PASS.
- Browser: one Interceptor result screen, 100%, 1 shot/1 successful pulse, 1 target, HDCoins 26 → 27; NAWL and NGSL study cards revealed/graded.

## Not run / remaining gate gaps

These are failures of the prompt's full verification gate, reported rather than hidden:

1. **No complete 98-question simulation.** Module locking, adaptive routing, and review were covered by the existing engine tests and integration tests, but not by one browser start-to-finish test. The Recent Simulations route was tested with a minimal completed record.
2. **No full run of Table Talk, Rune Vault, Practice Rush, or the skill mini-games.** Their counters and coin paths were inspected; only Interceptor was replayed to a result.
3. **No five-cell database spot check.** Guest progress does not expose the server attempt query, and no signed-in account was available. The heatmap aggregation was tested from local records.
4. **No live guest→sign-in accept/decline walkthrough and no signed-in cloud round trip.** The prompt path is implemented and unit/code checked, but not exercised against Supabase.
5. **Console/network baseline is incomplete.** The touched pages produced no application errors in the observed logs; only pre-existing React Router future-flag warnings and Vite HMR messages were present. This is not a formal zero-error comparison against a captured Part 0 baseline.
6. **Deployment and push were deferred in this pass.** They are completed in the finalisation section below, after the database was brought in line with the bundle.

## Deviations and left-as-designed notes

- **Browse All pagination.** The collection total is always 5,268 and every card is reachable, but the index appends 120 cards at a time instead of putting all 5,268 tiles in the DOM at once. The previous all-at-once view froze the page; pagination is the performance-safe presentation of the same collection.
- **Generated vocabulary dedupe.** The NAWL/NGSL builder skips a generated headword when an existing card already uses that normalized word. That is the conservative interpretation of “an existing card wins”; it does not modify any existing card and it may skip a different part of speech that is already represented on the site. No count was inflated or hidden by this choice.
- **Official deck is deployment-side.** The 267 official Words-in-Context cards are generated from the local College Board import into the gitignored `public/officialContextCards.json`. They are not redistributed in the repository, so a stripped checkout will show 5,001 cards and no official deck until that asset is generated locally.
- **Heatmap source scope.** All attempts contribute because the progress record has no verified-pool flag; source separation was explicitly not required by the prompt when that flag is absent.
- **Official target extraction.** The target is the first word of the official correct answer choice, first occurrence wins; this produced 267 unique cards from 292 Words-in-Context questions.

## Finalisation — 2026-11-24

Owner asked for the polish pass to be finalised, verified end to end, then deployed and
pushed. Everything below was run in this session.

### Code gate (clean exits)

| check | result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npx vitest run --no-file-parallelism` | **50 files passed, 2 skipped; 449 tests passed, 8 skipped (457)** — exit 0 |
| `python -m pytest backend/test_app.py -q` | **22 passed** — exit 0 |
| `npm run build` | exit 0; `dist` serves `assets/index-BTi8vKuX.js`, service worker `hdsat-v15` |
| `python tools/test_content_qa.py` | 32 tests OK |
| `python tools/content_qa.py --bank src/data/questionBank.json --fail-on error` | 10,024 items, **0 errors**, 5,000 pre-existing near-duplicate warnings, gate PASS |
| `python tools/verify_report_artifacts.py` | PASS: 172 changed rows match the migration, the seed and the bank field-for-field |

Parallel Vitest runs on this machine abort workers (`Worker exited unexpectedly`)
because the system drive was at 0 bytes free. Clearing the stale `dist/` and the
`tmp-shots/` screenshot scratch directory restored ~550 MB and the serial run is clean;
the worker aborts were environmental, not test failures — every file that ran passed.

### Live data brought in line

A client-only deploy would have shipped three fixes the server did not have. The live
project was repaired and verified by read-back:

- **172 report-repair rows** written to `public.questions` and `public.question_keys`
  (stimulus, prompt, choices, skill, domain, difficulty, format, assessments; key,
  acceptable answers, explanation, rationales).
- `python tools/sync_live_bank.py --apply` closed the remaining **525 question fields**
  and **172 keys** of drift from the earlier length/verb-form passes, then verified
  **0 remaining differences** (13,689 questions, 13,689 keys).
- **Official College Board bank seeded**: dataset source row plus **3,663 questions and
  3,663 keys**, so cloud grading and device sync cover the supplemental pool the client
  now loads. Verified live: `source_id=collegeboard-sat` → 3,663, keys → 3,663.
- The three P0 items now return their repaired content from the database:
  `RW-SEC-9003` colon-before-list (choices `; , : .`), `RW-SEC-9033` colon list,
  `RW-SEC-89358` a true consequence, and `RW-INF-002` now ends in a blank.

**Database limitation.** `questions.in_practice_test`, `questions.unusable` and
`questions.score_band` are not present in the live schema: adding columns needs the
management API, and the stored personal access token still returns `401 Invalid access
token`. Those three fields are display/filter metadata that the bundled JSON carries, so
the app behaves correctly; applying
`supabase/migrations/20261124000100_collegeboard_sat.sql` with a fresh token is the
remaining server step and is idempotent.

### Deploy and push

- `python .pa/deploy.py` — 102 files uploaded, webapp reloaded, `/api/health` 200 with
  the new bank version.
- The branch is committed and pushed to `origin` after the deploy health check.

### Reports left open on purpose

The 14 question reports remain at `status = received`. Their fixes are live and verified,
but closing them sends student-facing notifications and is an operator action, so it is
left for the owner to run with `python tools/admin_triage.py`.

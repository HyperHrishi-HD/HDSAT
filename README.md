# HDSAT — Minimalist Digital SAT & PSAT Preparation Platform

HDSAT is a minimalist, responsive digital SAT and PSAT preparation application supporting:
- **Assessments:** Digital SAT, PSAT/NMSQT, PSAT 10, and PSAT 8/9.
- **Persistent Question Bank:** 4,975 original items (339 Reading and Writing, 4,636 Math) filterable by assessment, section, domain, skill, difficulty, mastery status, bookmarked state, and licensed dataset source.
- **Multistage Adaptive Practice Simulations:** Section-level Module 1 baseline followed by deterministic Module 2 routing (`upper` vs. `lower` difficulty tier at the 60% threshold). The bank now fills the FULL Digital SAT blueprint (54 R&W + 44 Math items, full module timers) with a fresh randomized item mix per run, and a compact bank still degrades proportionally with a transparent coverage notice.
- **Custom Practice & Practice Rush:** Untimed or timed custom drills (with toggles to exclude previously correct questions or reserve Benchmark Simulation Set items) and 1/3/5-minute Practice Rush sprints.
- **In-App Math Tools:** The official College Board version of the Desmos graphing calculator, embedded in Practice, the Desmos Lab, and every Math module of the full-screen test, plus the SAT Suite Math Reference Sheet.
- **Spaced-Repetition Flashcards (SM-2):** 1,764 verified cards in two fully separate decks — 1,639 vocabulary entries (24 authored SAT items + 1,615 CC0-dedicated elevated-vocabulary entries) and 125 math formulas/identities with KaTeX rendering, scheduled via the SM-2 algorithm.
- **Desmos Lab & SAT Mini-Games:** Interactive graphing calculator lessons plus timed arcade games — Equation Sprint, Rhetorical Transition Match, and Vocabulary Precision — with streak multipliers and locally saved best scores.
- **HDCoins Economy, Streaks & Achievements:** Duplicate-resistant, anti-farming reward ledger enforced identically in local Guest Mode and Supabase SECURITY DEFINER RPCs.
- **Guest Mode & Cloud Sync:** Full local persistence (`localStorage` key `hdsat.profile.v1`) with idempotent replay into a signed-in Supabase account.

---

## Architecture & Module Map

```text
.
├── backend/
│   ├── app.py                  # Flask WSGI application (serves dist/ SPA + /api/* endpoints)
│   └── test_app.py             # Pytest suite for Flask routes, SPA fallback, and importer validation
├── wsgi.py                     # PythonAnywhere WSGI entrypoint (`from wsgi import application`)
├── requirements.txt            # Python backend & test dependencies (Flask, pytest)
├── src/
│   ├── main.tsx                # React 18 entrypoint
│   ├── App.tsx                 # Route definitions
│   ├── components/
│   │   ├── Layout.tsx          # Responsive shell, navigation, topbar stats
│   │   ├── MathText.tsx        # KaTeX inline ($...$) and block ($$...$$) renderer
│   │   ├── MathTools.tsx       # CalculatorPanel (embedded College Board Desmos) & MathReferenceSheet
│   │   ├── QuestionView.tsx    # Digital testing question view (stimulus, tables, MC cross-out, SPR)
│   │   └── ui.tsx              # Minimalist UI primitives
│   ├── data/
│   │   ├── questionBank.json   # Generated verified question bank (4,975 items)
│   │   ├── flashcards.json     # Generated SM-2 study deck (46 cards)
│   │   └── resources.json      # Curated study resource library (18 verified links)
│   ├── lib/
│   │   ├── catalog.ts          # Achievements & HDCoins store catalog
│   │   ├── cloud.ts            # Supabase Auth, snapshot loader, RPC wrappers, idempotent guest sync
│   │   ├── examEngine.ts       # Adaptive test builder, routing logic, score estimation, filters
│   │   ├── grading.ts          # Multiple-choice and numeric/fraction SPR answer grader
│   │   ├── sm2.ts              # SM-2 spaced repetition scheduler
│   │   ├── storage.ts          # Local guest profile persistence and anti-farming coin ledger
│   │   ├── store.tsx           # React context unifying Guest Mode and Supabase Cloud Mode
│   │   ├── supabaseClient.ts   # Browser Supabase client (anon/publishable key only)
│   │   ├── types.ts            # Shared TypeScript interfaces
│   │   └── engine.test.ts      # Vitest unit test suite
│   └── pages/
│       ├── Dashboard.tsx       # Real-time metrics, 14-day sparkline, domain mastery, recent tests
│       ├── Practice.tsx        # Custom practice, Practice Rush, Deterministic Study Coach
│       ├── FullTest.tsx        # Timed multistage adaptive test runner & score report
│       ├── QuestionBank.tsx    # Searchable catalog, live item solver, provenance registry
│       ├── Flashcards.tsx      # SM-2 flashcard review queue
│       ├── Arcade.tsx          # Desmos Lab lessons & 3 SAT mini-games
│       ├── Resources.tsx       # Searchable SAT/PSAT study resource library
│       ├── Rewards.tsx         # HDCoins store, earning rules, achievements
│       └── Account.tsx         # Email/password auth, guest-to-cloud sync, preferences
└── supabase/
    ├── migrations/
    │   └── 20261014000100_init_hdsat_schema.sql  # Full PostgreSQL schema, RLS policies & RPCs
    ├── import/
    │   ├── import_questions.py                   # Validator, deterministic choice shuffler & seed generator
    │   └── REVIEW_CHECKLIST.md                   # Provenance and quality review checklist
    └── seed/
        └── 0001_seed_hdsat.sql                   # Idempotent SQL seed for Supabase
```

---

## Environment Variables

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Client & Server | Your Supabase project URL (`https://qijfmwjcaminecxmbtcf.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Client & Server | Public Supabase anon/publishable key. Access is enforced by PostgreSQL Row Level Security (RLS). |
| `VITE_SITE_URL` | Client | Origin used for auth redirects in development (`http://localhost:3000`). |
| `HDSAT_ENV` | Server (Flask) | Runtime environment label (`development` or `production`). |
| `HDSAT_SITE_NAME` | Server (Flask) | Display name returned by `/api/health` (`HDSAT`). |

**Security Rule:** Never place a Supabase `service_role` key, database password, or PythonAnywhere API token in `.env`, the React bundle, or version control.

---

## Local Development & Building

### 1. Frontend (Vite + React + TypeScript)

```bash
npm ci
npm run dev         # Starts Vite dev server on http://0.0.0.0:3000
npm run typecheck   # Runs tsc --noEmit
npm test            # Runs Vitest unit tests
npm run build       # Compiles production SPA into dist/
```

### 2. Backend (Python Flask WSGI)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run build
.venv/bin/python -m backend.app   # Serves compiled dist/ + /api/health on http://0.0.0.0:5000
```

---

## Supabase Configuration & Database Migrations

Target project: `qijfmwjcaminecxmbtcf` (`https://supabase.com/dashboard/project/qijfmwjcaminecxmbtcf`)

1. Open the **Supabase SQL Editor** for project `qijfmwjcaminecxmbtcf` (or use `supabase db push`).
2. Run `supabase/migrations/20261014000100_init_hdsat_schema.sql` to create all 16 tables, Row Level Security (RLS) policies, `on_auth_user_created` profile/stats triggers, and `SECURITY DEFINER` RPCs (`verify_question_answer`, `submit_question_attempt`, `submit_flashcard_review`, `complete_activity_session`, `purchase_cosmetic_item`, `grade_module_responses`).
3. Run `supabase/seed/0001_seed_hdsat.sql` to upsert the verified `dataset_sources`, `questions`, `question_keys`, and `flashcards` records.
4. In **Authentication → Providers → Email**, ensure Email/Password sign-in is enabled.

---

## Question Bank Provenance, Licensing & Import Pipeline

### Provenance & Licensing Summary

HDSAT strictly prohibits scraping or re-hosting copyrighted College Board Bluebook or SAT Suite Question Bank items without a redistribution license. Instead, official College Board resources are linked in `src/data/resources.json`, and the in-app bank ships two explicitly documented open-licensed (`CC-BY-4.0`) sources:

1. **`hdsat-open-core-2026` — HDSAT Open Core Curated Bank (`CC-BY-4.0`, 31 items):**
   Original practice questions authored for HDSAT against the public Digital SAT Suite domain and skill blueprint (`is_official_college_board = false`, `is_released_practice_set = false`).
2. **`hdsat-benchmark-sim-1` — HDSAT Benchmark Simulation Set A (`CC-BY-4.0`, 5 items):**
   Original practice questions reserved as a designated benchmark simulation set (`is_official_college_board = false`, `is_released_practice_set = true`) so students can toggle "Exclude Benchmark Simulation Set" during routine drills.

**Current Verified Counts:**
- **Questions:** 4,975 total (339 Reading and Writing, 4,636 Math; 1,205 Easy, 3,057 Medium, 713 Hard; multiple-choice and student-produced response `spr`). Authored items come from `supabase/import/generate_bank_expansion.py`; the volume tier is generated by `supabase/import/generate_bank_scale.py` (exact-arithmetic parameter sweeps). A re-run regenerates `supabase/import/expansion/*.json`.
- **Flashcards:** 1,764 total (1,639 vocabulary entries + 125 math formulas, `CC-BY-4.0`; the vocabulary corpus derives from the CC0-dedicated *A New Word Every Day* word list, recorded in `flashcards.json` → `vocabulary_source`).
- **Flashcards:** 46 total (24 SAT Vocabulary + 22 SAT Math Formulas, `CC-BY-4.0`).
- **Study Resources:** 18 verified links (College Board official specifications, Khan Academy, Desmos, OpenStax CC BY 4.0 textbooks, Purdue OWL).

### Running the Validator & Importer

```bash
# Validate existing records without writing files:
python3 supabase/import/import_questions.py --check

# Validate, deterministically shuffle choices across A/B/C/D, and regenerate JSON + SQL seeds:
python3 supabase/import/import_questions.py

# Validate and merge an external authorized JSON or CSV question file:
python3 supabase/import/import_questions.py --file path/to/authorized_questions.json
```

---

## Running Automated Tests

```bash
# 1. TypeScript static typecheck
npm run typecheck

# 2. Frontend & exam engine unit tests (Vitest)
npm test

# 3. Question bank & study deck schema/provenance validation
npm run check:questions

# 4. Flask WSGI backend & SPA routing tests (pytest)
PYTHONPATH=. .venv/bin/pytest -v
```

---

## Deploying to PythonAnywhere (`https://www.pythonanywhere.com/user/HDSAT/`)

1. **Clone or pull the repository** on PythonAnywhere Bash console:
   ```bash
   git clone https://github.com/HyperHrishi-HD/HDSAT.git ~/HDSAT
   cd ~/HDSAT
   ```
2. **Build the frontend bundle** (either in CI/locally before pushing `dist/` or on PythonAnywhere if Node.js is enabled):
   ```bash
   npm ci && npm run build
   ```
3. **Create the Python virtualenv and install Flask:**
   ```bash
   mkvirtualenv hdsat --python=/usr/bin/python3.10
   pip install -r requirements.txt
   ```
4. **Configure the Web App in PythonAnywhere → Web:**
   - **Source code:** `/home/HDSAT/HDSAT`
   - **Working directory:** `/home/HDSAT/HDSAT`
   - **Virtualenv:** `/home/HDSAT/.virtualenvs/hdsat`
   - **WSGI configuration file:** Replace the contents with:
     ```python
     import os
     import sys
     project_home = '/home/HDSAT/HDSAT'
     if project_home not in sys.path:
         sys.path.insert(0, project_home)
     from wsgi import application
     ```
5. **Reload the Web App** and verify `https://hdsat.pythonanywhere.com/api/health`.

---

## Current Limitations

- **Question Bank Size vs. Full Blueprint Length:** A full-length official Digital SAT requires 54 Reading & Writing items (27 per module) and 44 Math items (22 per module), plus an additional second-stage routing pool (81 R&W / 66 Math unique items). The bank's original, licensed pool now exceeds those minimums (339 R&W / 4,636 Math unique items), so every assessment fills the full blueprint with a fresh randomized mix per run and no repeats within a single test. Proportional scaling with a transparent coverage notice remains the fallback if the bank is later trimmed.
- **Estimated Scaled Scores:** Adaptive simulation scores (400–1600) are practice estimates calculated from raw accuracy and Stage-2 module tier routing, not official College Board equated scores.

# HDSAT — Minimalist Digital SAT & PSAT Preparation Platform

**Created by [HyperHrishi-HD](https://github.com/HyperHrishi-HD)** · **YouTube:** [@HyperHrishiHD](https://www.youtube.com/@HyperHrishiHD) · **Live App:** [hdsat.pythonanywhere.com](https://hdsat.pythonanywhere.com)

HDSAT is a minimalist, responsive digital SAT and PSAT preparation application supporting:
- **Assessments:** Digital SAT, PSAT/NMSQT, PSAT 10, and PSAT 8/9.
- **Persistent Question Bank:** 7,290 original items (2,514 Reading and Writing, 4,776 Math) filterable by assessment, section, domain, skill, difficulty, mastery status, bookmarked state, and licensed dataset source.
- **Multistage Adaptive Practice Simulations:** Section-level Module 1 baseline followed by deterministic Module 2 routing (`upper` vs. `lower` difficulty tier at the 60% threshold). The bank now fills the FULL Digital SAT blueprint (54 R&W + 44 Math items, full module timers) with a fresh randomized item mix per run, and a compact bank still degrades proportionally with a transparent coverage notice.
- **Custom Practice:** Untimed or timed custom drills with toggles to exclude previously correct questions or reserve Benchmark Simulation Set items, plus a deterministic Study Coach that targets your lowest-accuracy domains.
- **Arcade (three rooms):** *Interactive Arena* (the Coordinate Interceptor 2D canvas game, the daily Hard Question of the Day, and three daily quests capped at 30 questions a day), *Skill Mini-Games* (Desmos Lab, Equation Sprint, Transition Match, Vocab Precision, configured before you start) and *Practice Rush* (1/3/5-minute highs-score sprints).
- **Shareable results & AI snapshots:** a completed full simulation can be downloaded as JSON, printed, or shared as a self-contained read-only link, and Account can copy a validated JSON snapshot of your own progress for any AI tutor.
- **Operator console:** `/admin` reads live question reports and appeals through Supabase `SECURITY DEFINER` RPCs, with status filters, batch resolve/dismiss/delete, per-student cleanup, and replies that appear once on the student's Dashboard.
- **In-App Math Tools:** The official College Board version of the Desmos graphing calculator beside every Math item — Custom Practice, Practice Rush, the Desmos Lab, Equation Sprint, the Question Bank, and every Math module of the full-screen test — plus the SAT Suite Math Reference Sheet. The tool pane is drag-resizable, a one-tap curved-arrow switch swaps it between the left and right side, and the reference sheet is a floating window you can drag by its header and resize from any edge or corner. On phones the calculator stacks under the question instead of squeezing it.
- **Spaced-Repetition Flashcards (SM-2):** 1,804 verified cards in two fully separate decks — 1,678 vocabulary entries (59 authored SAT items + 1,615 CC0-dedicated elevated-vocabulary entries) and 126 math formulas/identities with KaTeX rendering, scheduled via the SM-2 algorithm.
- **HDCoins Economy, Streaks & Achievements:** Duplicate-resistant, anti-farming reward ledger enforced identically in local Guest Mode and Supabase SECURITY DEFINER RPCs, with a lifetime-earned total that purchases never reduce.
- **Leaderboard:** a compact Dashboard card with the five students holding the most HDCoins. It returns a display name, coin balance, best streak and attempt count only — never an email, an id or any answer — and only a signed-in student can call it. An address used as a display name is replaced with "Student" inside Postgres.
- **Guest Mode & Cloud Sync:** Full local persistence (`localStorage` key `hdsat.profile.v1`) with idempotent replay into a signed-in Supabase account.
- **Accounts usable before the email is confirmed:** sign-up issues a session immediately, so a mail-provider quota can never lock a student out. An address that has not entered its emailed 6-digit code is a **light account** (the email carries both a link and a 6-digit code, both valid for 24 hours): progress, coins, streaks, flashcards and test scores sync, while the two per-answer ledgers (`question_attempts` payload, `test_responses`) are trimmed in Postgres. A confirm strip never appears in the timed runner, and the 300/day Brevo budget stops at 280 with a plain "come back tomorrow" message.
- **Starting homepage:** a full-page hero shown only before this browser has any profile and no account is signed in; one click enters the app for good. A different original motto rotates on every visit, the brand mark carries a slow glow, and two drifting light pools sit behind the content (all motion stops for `prefers-reduced-motion`). Credits links back to it.

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
│   │   ├── FloatingToolWindow.tsx  # Draggable/resizable window chrome (reference sheet, bank calculator)
│   │   ├── MathText.tsx        # KaTeX inline ($...$) and block ($$...$$) renderer
│   │   ├── MathTools.tsx       # Desmos pane/frame (College Board version) & MathReferenceSheet
│   │   ├── ReferenceWindow.tsx # Floating, resizable SAT Suite math reference sheet
│   │   ├── SplitWorkbench.tsx  # Resizable question/tool split pane used by practice, arcade & the full test
│   │   ├── QuestionView.tsx    # Digital testing question view (stimulus, tables, MC cross-out, SPR)
│   │   └── ui.tsx              # Minimalist UI primitives
│   ├── data/
│   │   ├── questionBank.json   # Generated verified question bank (7,290 items)
│   │   ├── flashcards.json     # Generated SM-2 study deck (46 cards)
│   │   └── resources.json      # Curated study resource library (18 verified links)
│   ├── lib/
│   │   ├── catalog.ts          # Achievements & HDCoins store catalog
│   │   ├── cloud.ts            # Supabase Auth, snapshot loader, RPC wrappers, idempotent guest sync
│   │   ├── examEngine.ts       # Adaptive test builder, routing logic, score estimation, filters
│   │   ├── grading.ts          # Multiple-choice and numeric/fraction SPR answer grader
│   │   ├── sm2.ts              # SM-2 spaced repetition scheduler
│   │   ├── storage.ts          # Local guest profile persistence and anti-farming coin ledger
│   │   ├── windowResize.ts     # Pure edge/corner resize geometry shared by floating windows
│   │   ├── store.tsx           # React context unifying Guest Mode and Supabase Cloud Mode
│   │   ├── supabaseClient.ts   # Browser Supabase client (anon/publishable key only)
│   │   ├── types.ts            # Shared TypeScript interfaces
│   │   └── engine.test.ts      # Vitest unit test suite
│   └── pages/
│       ├── Welcome.tsx         # Starting homepage (blank slate only), static and route-level
│       ├── Dashboard.tsx       # Real-time metrics, 14-day sparkline, test-date goal, missed log
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

## Study Workspace Controls

Every place that shows a Math item shares one workspace (`SplitWorkbench`):

| Action | Mouse / touch | Keyboard |
| :--- | :--- | :--- |
| Resize the calculator | Drag the divider between the panes | Focus the divider, then `←` / `→` |
| Swap sides | Tap the curved-arrow button next to **Calculator** | — |
| Move the reference sheet | Drag its title bar | — |
| Resize the reference sheet | Drag any edge or corner | — |
| Close a floating tool | The `✕` in its title bar | — |

Pane width, side, and floating-window geometry are stored per surface in `localStorage`, so the layout a student picks survives a reload. Below 900 px the panes stack (question first, calculator underneath) and the floating windows clamp themselves above the bottom tab bar; the side-switch is hidden there because there is no left or right.

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
4. Run `supabase/migrations/20261017000100_safety_compliance.sql`, `20261020000100_cosmetic_price_ladder.sql`, `20261023000100_admin_console.sql` (admin console, notifications, triage RPCs) and `20261024000100_admin_human_check.sql` (self-hosted human check). After the build that uses it is deployed, run `20261024000200_admin_captcha_cleanup.sql` to drop the old arithmetic-captcha path. Then `20261025000200_emblems_earned.sql` (emblems are earned, not bought), `20261026000200_password_change_limits.sql` (password/recovery cooldowns), `20261026000300_email_request_limits.sql` (one confirmation email and one recovery link per address per day), `20261026000400_admin_attempt_log.sql` (wrong-passcode rows per device), `20261026000500_light_accounts.sql` (verification flag, storage caps for unverified accounts, mail budget), `20261026000600_coin_category_fix.sql` (the `achievement_reward` coin category) and `20261027000100_test_goal.sql` (dashboard test-date goal). `python .pa/apply_round2_migrations.py` applies and verifies the whole set.
5. In **Authentication → Providers → Email**, ensure Email/Password sign-in is enabled.
6. Set the operator passcode once, in the SQL editor (or with a service key). Only a bcrypt hash is stored; the plaintext never enters this repository, the bundle or the browser:

```sql
SELECT public.set_admin_passcode('your-operator-passcode');
```

Changing the passcode clears every outstanding console session.

---

## Operator Console & Report Triage

- `/admin` (also reachable as `/#/admin`) asks for a signed-in session, a human check and the operator passcode. The human check is self-hosted: Postgres issues a random salt and difficulty, the browser finds a nonce whose SHA-256(salt + nonce) has four leading zero nibbles, and the same function re-computes it, burning the challenge on use. No third-party widget, key or account is involved. The passcode is compared inside Postgres against a bcrypt (cost 12) hash, five wrong tries lock the console for 15 minutes, and a correct unlock returns a random 8-hour token that every admin RPC re-checks by hash. No account is privileged and no service-role key ever reaches the browser.
- A wrong passcode writes **one row per device** into `admin_login_attempts` — client IP and user agent read from the request headers inside Postgres, never from the browser — and later tries only increment that row. The **Sign-in attempts** section lists them (device, IP, tries, first/last seen) with Delete per row and Clear all; the table is capped at 100 devices. Student accounts are never locked by wrong passwords; only this gate has the 5-try lock.
- The token is held in memory only. A reload, a closed tab, leaving the site or ten idle minutes all end the session: the token is revoked, admin storage keys and cookies are scrubbed and the gate comes back. The section rail does not render until the console is unlocked.
- **Lock console** revokes the token server-side, clears the admin keys from `sessionStorage`/`localStorage`, drops every in-memory copy (tables, filters, reply drafts, passcode field, challenge and solution), removes the console route from browser history and returns to the app.
- The console calls only `SECURITY DEFINER` RPCs (`admin_human_check`, `admin_unlock`, `admin_session_valid`, `admin_lock`, `admin_list_reports`, `admin_list_appeals`, `admin_set_report_status`, `admin_batch_delete_reports`, `admin_reply_to_report`, `admin_list_students`, …); the underlying tables have RLS enabled and `anon` has no EXECUTE on any of them.
- Batch actions: mark resolved/dismissed, delete selected, delete everything resolved older than N days, and delete every report or appeal from one student (Students section). Every destructive action needs a second click and reports the affected row count.
- Replies create one `user_notifications` row, which the student sees **once** on their Dashboard; dismissing it calls `mark_my_notifications_seen`.
- For local triage from a terminal or from Freebuff, `tools/admin_triage.py` reads the same tables with a service-role key that stays on your machine:

```bash
# .pa/supabase_url and .pa/supabase_service_key (both gitignored)
python tools/admin_triage.py summary
python tools/admin_triage.py reports --status received --limit 20
python tools/admin_triage.py reply report <uuid> --body "Thanks — fixed in tonight's build."
```

---

## Question Bank Provenance, Licensing & Import Pipeline

### Provenance & Licensing Summary

HDSAT strictly prohibits scraping or re-hosting copyrighted College Board Bluebook or SAT Suite Question Bank items without a redistribution license. Instead, official College Board resources are linked in `src/data/resources.json`, and the in-app bank ships two explicitly documented open-licensed (`CC-BY-4.0`) sources:

1. **`hdsat-open-core-2026` — HDSAT Open Core Curated Bank (`CC-BY-4.0`, 31 items):**
   Original practice questions authored for HDSAT against the public Digital SAT Suite domain and skill blueprint (`is_official_college_board = false`, `is_released_practice_set = false`).
2. **`hdsat-benchmark-sim-1` — HDSAT Benchmark Simulation Set A (`CC-BY-4.0`, 5 items):**
   Original practice questions reserved as a designated benchmark simulation set (`is_official_college_board = false`, `is_released_practice_set = true`) so students can toggle "Exclude Benchmark Simulation Set" during routine drills.

**Current Verified Counts:**
- **Questions:** 7,290 total (2,514 Reading and Writing, 4,776 Math; multiple-choice and student-produced response `spr`). Authored items come from `supabase/import/generate_bank_expansion.py`, the volume tier from `generate_bank_scale.py`, and the R2-M10 Reading & Writing expansion from `generate_bank_rw_m10.py` plus the 2026-10-29 second batch from `generate_bank_rw_m10b.py` (Words in Context, Boundaries, Transitions, passages, Rhetorical Synthesis, quantitative-evidence tables and charts). `merge_bank_m10.py` adds a batch to the shipped bank and writes its own seed; nothing existing is rewritten.
- **Flashcards:** 1,804 total (1,678 vocabulary entries + 126 math formulas, `CC-BY-4.0`; the vocabulary corpus derives from the CC0-dedicated *A New Word Every Day* word list, recorded in `flashcards.json` → `vocabulary_source`, plus authored SAT words).
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

- **Question Bank Size vs. Full Blueprint Length:** A full-length official Digital SAT requires 54 Reading & Writing items (27 per module) and 44 Math items (22 per module), plus an additional second-stage routing pool (81 R&W / 66 Math unique items). The bank's original, licensed pool now exceeds those minimums (2,514 R&W / 4,776 Math unique items), so every assessment fills the full blueprint with a fresh randomized mix per run and no repeats within a single test. Proportional scaling with a transparent coverage notice remains the fallback if the bank is later trimmed.
- **Estimated Scaled Scores:** Adaptive simulation scores (400–1600) are practice estimates calculated from raw accuracy and Stage-2 module tier routing, not official College Board equated scores.

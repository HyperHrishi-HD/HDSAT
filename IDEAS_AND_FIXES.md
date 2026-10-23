# HDSAT — Master Roadmap, Decisions & Progress Tracker

**Last updated:** 2026-10-22
**Rule for this file:** Items are executed in **Milestones 1 → 5** (easiest → hardest), with full testing, commit, push, and PythonAnywhere deployment after every milestone. Items needing owner sign-off before live changes are documented in **Section 2 (Proposals & Pending Decisions)**.

---

## Section 1 — Milestone Execution Plan

### Milestone 1: Core UX, Practice Polish, Keyboard Controls & Anti-Repetition (COMPLETED ✅)
- [x] **M1.1 · Cross-out text → Icons (`QuestionView.tsx` & `FullTest.tsx`):** Replace literal `"cross out"` / `"restore"` text buttons with crisp strikeout (`slash` / `eye-off` / `rotate-ccw`) icons while preserving `title` and `aria-label` accessibility.
- [x] **M1.2 · Full Test `Shift + 1..4` / `Shift + A..D` strikeout (`FullTest.tsx`):** In the Bluebook full test runner only, holding `Shift` + pressing `A/B/C/D` or `1/2/3/4` toggles strikeout (elimination) on that choice.
- [x] **M1.3 · `Enter` advances everywhere (`QuestionView.tsx`, `Practice.tsx`, `QuestionBank.tsx`, `FullTest.tsx`):** Pressing `Enter` submits the current answer (if unsubmitted in Practice/Bank) or moves to the next question once answered.
- [x] **M1.4 · Custom Practice button reset fix (`Practice.tsx`):** Clicking the `"Custom Practice"` tab button (or header nav) when a practice session is finished or active cleanly resets/returns to the Custom Practice filter builder so the user isn't stuck having to click a separate button.
- [x] **M1.5 · Anti-repetition & de-templating question selector (`examEngine.ts`):** Upgrade `selectPracticeQuestions` and `buildAdaptiveTestPlan` so consecutive questions never share the same template family (`questionTemplateKey`), skill cluster, or stimulus structure, and incorporate per-user random entropy + attempt history weighting so every student gets a fresh, unpredictable, realistic SAT mix.
- [x] **M1.6 · Dashboard cleanup (`Dashboard.tsx`):** Remove the `"Target assessment"` dropdown and `"Target track"` subtitle from the Dashboard header (since it lives in Account Preferences). **Keep the Domain Mastery card**, and remove the parenthetical `({app.settings.assessment})` next to `"Domain Mastery"` so it simply reads `Domain Mastery` and aggregates across the user's preferred/active assessment cleanly.
- [x] **M1.7 · Account Reports large expandable disclosure (`Account.tsx`):** Replace the small `"Load my reports"` button with a large full-width expandable disclosure card (`Your Submitted Question Reports`) that loads and expands the user's report table on click.

### Milestone 2: Achievements Fix + Coin Payouts, Luxury Theme Ladder, Credits & Repo Hygiene (COMPLETED ✅)
- [x] **M2.1 · Achievement ID unification + HDCoins payouts (`catalog.ts`, `storage.ts`, `store.tsx`, `Rewards.tsx`, Supabase SQL migration):**
  - Reconcile client and database achievement IDs so cloud and guest modes match 1:1.
  - Award one-time HDCoins for every unlocked achievement (First Steps +5, Warmed Up +10, Grinder +25, Flawless Module +30, Three Day Streak +10, Week Streak +25, Card Shark +10, Deck Master +25, Test Pilot +25, Rush Hour +20, Coin Collector +15, Mastery +40).
  - Show human-readable achievement names + coin reward in the unlock popup and on the Rewards page badges.
- [x] **M2.2 · High-tier / exponential theme ladder (`catalog.ts`, `global.css`, Supabase SQL migration):** Add 4 new themes (`Slate Mono` 600, `Teal Current` 1,000, `Rose Quartz` 1,800, `Royal Obsidian` 3,500 HDCoins) with swatch previews and full client/server price parity.
- [x] **M2.3 · Credits & Attribution + Repo Hygiene (`Legal.tsx`, `Layout.tsx`, `README.md`, `LICENSE`, `SECURITY.md`):**
  - Credit **HyperHrishi-HD** and link YouTube (`https://www.youtube.com/@HyperHrishiHD`) + GitHub (`https://github.com/HyperHrishi-HD/HDSAT`) in the site footer/credits (no support email needed; point users to in-app Question Reports & Appeals).
  - Add clean `LICENSE`, `SECURITY.md`, and polished `README.md` ready for public GitHub visibility.
  - Add `.github/workflows/pa-monthly-refresh.yml` + `.pa/refresh_webapp.py` to keep PythonAnywhere refreshed automatically.

### Milestone 3: First-Run Intro Screen, Auth Pop-Up Modals & 24-Hour Brevo Email Protection
- [ ] **M3.1 · First-run Dashboard Intro Screen (`IntroScreen.tsx`, `Dashboard.tsx`):** When local browser storage is empty (`attempts === 0` and `!localStorage['hdsat.intro.seen.v1']`), display an interactive welcome screen directly inside the Dashboard view with a one-click transition into the Dashboard that never nags again.
- [ ] **M3.2 · Sign-In / Sign-Up Pop-Up Modal (`AuthModal.tsx`, `Layout.tsx`, `Account.tsx`):** Clicking `"Sign in"` anywhere pops up a modal window for sign-in / account creation. Remove the inline sign-in form from the Account page so Account only holds preferences (display name, assessment preference, email confirmation status, data export/delete, and reports/appeals).
- [ ] **M3.3 · 24-Hour Email Confirmation Window & Quota Guard (`AuthModal.tsx`, `Account.tsx`, `cloud.ts`):**
  - Store `pendingVerification` (`{ email, sentAt, expiresAt: sentAt + 86_400_000 }`) in `localStorage`.
  - Allow the user to open the confirmation code modal from Account or the top banner for a full **24 hours** without resending.
  - Block duplicate confirmation emails to the same address for 24 hours so Brevo's daily quota can never be spammed or drained.
- [ ] **M3.4 · Require Sign-In for Question Reports (`ReportQuestion.tsx`, `AppealForm.tsx`):** Require an authenticated user session to submit question reports (with a one-click `"Sign in to report"` button that opens the Sign-In modal) + enforce strict character limits.

### Milestone 4: Arcade 3-Tab Overhaul, Daily Quests, Hard QOTD, Shareable Test Results & Backend Hardening
- [ ] **M4.1 · Move Practice Rush into Arcade & 3-Tab Layout (`Arcade.tsx`, `Practice.tsx`):**
  - Remove Practice Rush from the Practice page (leaving Custom Practice + Study Coach).
  - Structure Arcade into **3 clean tabs**:
    1. **Interactive Arena (2D Game):** Coordinate Interceptor — an interactive 2D coordinate-plane graphing & target-interception game where you aim linear/quadratic trajectories through targets, with a 200 HDCoin daily arcade cap and a cooldown timer (wait or spend coins to recharge).
    2. **Skill Mini-Games:** Configurable setup card (choose Equation Sprint, Transition Match, or Vocab Precision + duration/difficulty before starting, just like Custom Practice).
    3. **Practice Rush:** Full Practice Rush experience with personal bests, dynamic difficulty curve, and stopwatch/countdown modes.
- [ ] **M4.2 · Daily Quests (Arcade-only, 30 Q cap) & Daily Hard Question of the Day (`Dashboard.tsx`, `Arcade.tsx`):**
  - 3 Daily Quests in the Arcade tab (5 English + 5 Math per quest tier = 30 questions max per day, no cooldown lock).
  - Daily Hard Question of the Day card shown on **Dashboard** (with a Close `×` button to dismiss for the day) and permanently accessible inside **Arcade**.
- [ ] **M4.3 · Full Test Results Download & Shareable Public Link (`FullTest.tsx`, `App.tsx`):**
  - On completed Adaptive Full Tests, add **Download Score Report (JSON / Printable Certificate)** and **Copy Public Share Link** (`/#/test?share=<encoded-verifiable-summary>`) so students can share a read-only summary card of their score & module breakdown.
- [ ] **M4.4 · Account Full JSON Snapshot for AI (`Account.tsx`, `dataRights.ts`):** Single button in Account that exports/copies a structured JSON snapshot of the user's full profile, domain accuracy, missed skills, and history ready to paste into any AI tutor or Freebuff.
- [ ] **M4.5 · Flask Backend Security Hardening (`backend/app.py`, `backend/test_app.py`):** Force HTTPS redirect in production (`X-Forwarded-Proto`), strict Content-Security-Policy (allowing Desmos & KaTeX), per-IP rate limiting on `/api/*`, `robots.txt` disallowing `/admin`, and payload size limits.

### Milestone 5: Supabase Admin Console Wiring, Student Reply Notifications & Freebuff MCP Bridge
- [ ] **M5.1 · Supabase Admin RPCs & Live Wiring (`Admin.tsx`, `cloud.ts`, Supabase migration):**
  - Add `is_admin` on `profiles` + `SECURITY DEFINER` RPCs (`admin_list_reports`, `admin_resolve_report`, `admin_batch_delete_reports`, `admin_list_appeals`, `admin_reply_to_user`).
  - Wire `/admin` to live Supabase tables with review, delete-after-review, and **batch delete** (e.g., delete all reports from a single spam user or by status).
- [ ] **M5.2 · One-Time Student Dashboard Notification for Admin Replies (`Dashboard.tsx`, `store.tsx`, `cloud.ts`):**
  - When the admin replies to a report or appeal, store a notification row in `user_notifications`.
  - Show it as a banner on the student's Dashboard **once** (dismissing marks `seen_at` so it never reappears).
- [ ] **M5.3 · Freebuff Local MCP / CLI Triage Bridge (`.pa/admin_triage.py`):**
  - Create a local script/MCP tool that lets Freebuff directly fetch, filter, summarize, and resolve `question_reports` and `user_appeals` on command whenever you ask in chat.

---

## Section 2 — Proposals & Pending Decisions for Owner Review

### 1. PythonAnywhere Monthly Auto-Refresh Bot
- **How PythonAnywhere works:** Free PythonAnywhere webapps expire every 3 months unless refreshed in the web dashboard, and apps sleep when idle.
- **What we built / can run:**
  1. **Direct MCP Reload (Immediate & anytime you're in Freebuff):** `.pa/refresh_webapp.py` uses your `.pa/pa_credentials` and the official `pythonanywhere-mcp-server` (`reload_webapp`) plus an HTTP health ping to refresh the app immediately.
  2. **Automated GitHub Action (`.github/workflows/pa-monthly-refresh.yml`):** Runs on the 1st and 15th of every month (`cron: '0 9 1,15 * *'`), calls the PythonAnywhere REST API `POST /api/v0/user/HDSAT/webapps/hdsat.pythonanywhere.com/reload/`, and verifies `/api/health`. (Note: For the once-every-3-months "Run until 3 months from today" button on free accounts, PythonAnywhere's REST API reloads the worker, while clicking the dashboard button or running a 20-line Playwright login script extends the 90-day expiry timer—both are included in `.pa/refresh_webapp.py`.)

### 2. 2D Interactive Arcade Game Proposal ("Coordinate Interceptor")
- **Concept:** An HTML5 Canvas 2D graphing & trajectory game set on a Cartesian coordinate grid.
- **Gameplay:** Targets and obstacles spawn at coordinates $(x, y)$. You adjust slope $m$ and y-intercept $b$ (or vertex $(h,k)$ in higher waves) using quick sliders/keys and fire a laser pulse along $y = mx + b$ to intercept all targets in one shot.
- **Economy & Cooldown:** Awards up to **200 HDCoins/day** across interactive arcade runs. After 4 consecutive runs (or hitting the session limit), a **15-minute cooldown** activates so students don't binge—with an option to return to Practice or spend 25 HDCoins to unlock an extra run immediately.

### 3. Admin Batch Delete & AI Triage Options
- **Batch actions included in `/admin`:**
  - *Delete all reports from this user* (1-click spam cleanup)
  - *Delete all resolved/dismissed reports older than 7 days*
  - *Retire question & resolve all linked reports*
- **Note on deploying Admin SQL changes:** Per your instruction, we will push all code to Git and deploy tested frontend/backend updates, and we will list the exact Admin SQL RPC summary for your review before running any destructive database cleanup.

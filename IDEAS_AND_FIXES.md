# HDSAT — Master Roadmap, Decisions & Progress Tracker

**Last updated:** 2026-10-29
**Rule for this file:** work proceeds **one milestone at a time, in order**, stopping after each milestone for owner review. No milestone is "done" until it is typechecked, unit-tested, exercised against the live project, and (where the bundle changed) deployed. **Polish, not prototype.**

---

## Section 0 — Standing rules (apply to every milestone)

1. **Dates.** `Started October 17, 2026` is the founding date and never changes. Every "Effective <date>" line becomes **"Last updated <date>"**, and that date is the day of the most recent material policy/content change. When legal or policy copy changes, bump the date in one place (`src/lib/legal.ts`) and update this file in the same change. Contract pages must never advertise a date older than the text they show.
2. **Say less.** Public UI text is a liability. Explanations belong in the legal pages, the InfoTips and this file — not in the working surface. Default: label + action; one short hint at most, and only where a first-time user would otherwise be stuck. No meta-instructions about how to use exported data, no restated labels, no "what this does" sentences.
3. **Credit placement.** GitHub lives in **Credits only**. The site footer carries exactly one attribution line: **"By HyperHrishi HD"**. No "(YouTube)" suffix, no repo link in the footer.
4. **Nothing privileged in the client.** Passwords, passcodes, service keys and answer keys never enter `localStorage`, cookies, bundle or logs. Admin/unlock tokens are memory-only.
5. **Verify against the live project**, not just the local build: Supabase RPCs, PythonAnywhere and Brevo are all real dependencies.
6. **Console safety.** Anything the operator or an agent prints must survive a Windows `cp1252` console and a UTF-8 pipe (see R2·M1 regressions). Keep CLI output ASCII.

---

## Section 1 — Round 1 (shipped, verified, deployed)

<details>
<summary>Milestones M1–M5, kept for history and for "do not redo"</summary>

### M1 — Practice polish, keyboard controls, anti-repetition ✅
Icon-based cross-out in `QuestionView`/`FullTest`; `Shift`+`A–D`/`1–4` strikeout in the runner; `Enter` advances; Custom Practice tab reset; de-templated selector (no repeated template family/near-duplicate stimulus in a row); Dashboard header cleanup; Account reports disclosure.

### M2 — Achievements, coin payouts, theme ladder, credits, repo hygiene ✅
Client/DB achievement ID unification with one-time coin payouts; four prestige themes (600 / 1,000 / 1,800 / 3,500) with client/server price parity; LICENSE, SECURITY.md, README, monthly PythonAnywhere refresh workflow.

### M3 — First-run intro, auth popup, 24-hour email protection ✅
Dashboard intro (later replaced by the standalone homepage, R2·M9); sign-in/sign-up modal; 24-hour confirmation-code window with one-send-per-24h guard; reports/appeals require a session.

### M4 — Arcade overhaul, quests, QOTD, shareable results, backend hardening ✅
Three arcade rooms; daily quests capped at 30 questions; Hard QOTD; result download/print/share link; Flask HTTPS redirect, CSP, per-IP rate limit, 1 MiB cap, `robots.txt` for `/admin`; 19 backend tests.

### M5 — Operator console, student replies, local triage bridge ✅
`admin_gate` bcrypt passcode, single-use proof-of-work human check, SHA-256 token rows with 8 h expiry, `admin_access_log`; `SECURITY DEFINER` RPCs for list/status/batch-delete/reply; one-time Dashboard notification per reply. Console rail is hidden until unlock; the token is memory-only and every exit path (lock, navigate away, reload, sign-out, 10 idle minutes) purges it.

</details>

---

## Section 2 — Round 2 milestone plan

Ordering is deliberate: operator tooling first (asked for explicitly, and it unblocks every later report-driven fix), then the cheap high-visibility truth fixes, then account security, then the data/AI features, then the two large builds. **Stop for discussion after each.**

Legend: ✅ shipped & verified · ▶ current · ☐ queued

### ✅ R2·M1 — Operator triage v2 (read the queue, answer it in one consistent format)

**Shipped 2026-10-23.** `tools/admin_triage.py` + `tools/test_admin_triage.py`.

- [x] `digest`: one-screen markdown brief — open counts, every item past the 72 h window, oldest first, per-reason and per-question grouping, repeat reporters, newest rows.
- [x] Structured reply templates (`wrong_key`, `explanation`, `typo_or_format`, `mistagged`, `copyright`, `no_fault`, `fixed_thanks`) rendered into one fixed shape: reference → what you sent → what we found → what changed → next step. `--dry-run` previews; `--yes` sends it as a one-time Dashboard notification and moves the row to `in_review`.
- [x] `open`, `summary`, `reports`/`appeals` listing (text or `--json`), `resolve`, `dismiss`, `close-appeal`, `delete-reports`/`delete-appeals` with an unbounded-delete refusal.
- [x] Email redaction by default (`--show-emails` opt-in), confirmation prompt on every write, append-only `.pa/triage_log.jsonl`.
- [x] 18 offline unit tests + a live end-to-end run on a throwaway appeal.

**Live verification (2026-10-23):** throwaway appeal `HDSAT-…` appeared in `digest` as not-overdue → `reply --dry-run` printed the full preview and wrote nothing (`user_notifications` still empty) → real `reply` delivered a 303-character notification and set the row to `in_review` → `close-appeal` set `resolved` → `open` no longer listed it → rows deleted, queue back to 0/0.

**Regressions found and fixed while verifying (keep these):**
1. The reply path selected `question_id` on `user_appeals`, which has no such column → PostgREST 400 and no reply. Column sets are now chosen per table by `reply_columns(kind)`, with a unit test that assertions the columns actually exist per table.
2. The digest crashed on a Windows `cp1252` console (em dash, arrow, `↳`). Console output is now **pure ASCII** (pinned by `test_digest_is_plain_ascii`), and stdout is reconfigured to UTF-8 with `errors="replace"` as a safety net.

### ✅ R2·M2 — Truth & copy pass (shipped 2026-10-23)
- [x] Footer: GitHub lives only in Credits; single line **"By HyperHrishi HD"**. The `Appeals & safety reports` link was removed 2026-10-26 — the same page is reachable from the Account nav and the top bar.
- [x] Credits: Support row removed; **"Started October 17, 2026"**; dates read **"Last updated <date>"** from `src/lib/legal.ts` only.
- [x] Thin notice banners auto-dismiss after **10 s** (errors/actionable alerts stay). Larger cards unaffected.
- [x] Copy audit across Dashboard / Practice / Bank / Account / Arcade / Rewards / Resources / Flashcards / Auth modal: restated labels, parentheticals and "what this does" sentences deleted. The owner chose the **thin** level.
- [x] Kept: legal pages, InfoTips (shortened to at most two sentences), Bluebook runner chrome, score explanations after a test.

**Trim level used everywhere:** label + action, one short hint at most. Examples of what went: "Track your study streak, domain accuracy…" under the Dashboard heading, "Filter the bank by assessment, section, domain…" in the Practice tip, the AI-snapshot paste-into-a-tutor paragraph, the Reports summary's second line, and every exclamation mark.

### ✅ R2·M3 — Account security: password change overlay (shipped 2026-10-26)
- [x] "Change password" button in Account (name editing unchanged) opens an overlay, no inline box. Copy is thin: two path tabs, three fields, one toggle.
- [x] Path A — **current password + new password**: re-authenticates with `signInWithPassword`, then `updateUser({ password })`. **1 change per hour**.
- [x] Path B — **email confirmation link**: `resetPasswordForEmail` → recovery link → new-password form. **1 request per day**. The Auth modal also offers "Forgot password?" for signed-out students.
- [x] Both cooldowns live in `public.password_change_log` and are enforced by `claim_password_action` / `complete_password_action` / `cancel_password_action` / `password_action_status` (`20261026000200_password_change_limits.sql`). The table has RLS on with no policies and no client privileges; only the RPCs, scoped to `auth.uid()`, may touch it. A pending claim older than 15 minutes is treated as abandoned; a failed attempt is cancelled so it does not start a cooldown.
- [x] The overlay mirrors the server deadline with a live countdown and disables the action instead of failing it.
- [x] Standard hashed flow only: no password is stored, logged, prefilled or echoed. "Sign out other sessions" is on by default and calls `signOut({ scope: 'others' })` after the change.
- [x] Recovery links land on Account; `main.tsx` consumes the implicit hash or PKCE code, sets a one-shot flag and the Account page opens "Set a new password". The recovery completion is **not** blocked by the 1-hour password cooldown (the link is the authorisation), but it records the change best-effort.

**Live verification (2026-10-26):** `python .pa/apply_round2_migrations.py` applied both migrations and verified 8 schema facts; `python .pa/test_password_rpcs.py` ran 13 checks on a real session (first claim allowed, pending claim blocks, ~3600 s reported, complete → refused, email path independent, cancel frees the slot, foreign action id refused, signed-out 401/403, ledger unreadable) and deleted its throwaway account. In the browser: wrong current password → "Current password is incorrect." with no cooldown left behind; correct password → notice "Password updated. Other sessions signed out.", reopening shows "You can change your password in 60 min." with the button disabled; recovery flag → "Set a new password" → updated; signing out and back in with the new password succeeded. A real recovery link (generated with the admin API, never emailed) verified on **production**: Supabase redirected to `https://hdsat.pythonanywhere.com`, `main.tsx` consumed the implicit hash, the page landed on `#/account` and opened "Set a new password", which saved and reported success. Throwaway accounts deleted; project back to 7 users / 3 confirmed with an empty ledger.

### ✅ R2·M4 — Question of the Day as a thin banner (shipped 2026-10-26)
- [x] Dashboard QOTD is a collapsed one-line strip (`Daily · Question of the Day · section · domain · Open`) that expands in place; the full card is gone from the Dashboard.
- [x] Open/closed state is remembered (`hdsat.qotd.open.v1`), so a reload keeps the student's choice. A solved question hides on the next visit — the feedback stays readable while it is on screen.
- [x] Arcade keeps the full card. One component, two densities, no duplicated logic.

### ✅ R2·M5 — AI snapshot v2 = a ready-to-use tutor prompt (shipped 2026-10-26)
- [x] The payload is now `{ schema_version: 2.0, role, data, requested_output }`: a tutor role line, the evidence (`accuracy`, per-domain and per-skill rows with attempt counts, `weakest_skills`, `missed_items` with the student's own answer, `slowest_correct` / `slowest_incorrect`, test history, a dense `last_14_days` window and a `goal` block), then three tasks and three constraints. Under 15 KB, pinned by a test.
- [x] Every "paste this into a tutor" sentence is gone from the payload; the Account card reads one line: "Copies a tutor-ready brief. No answer keys."
- [x] Deterministic ordering and stable field order (two exports of the same data are byte-identical, pinned by a test). No email address, no answer keys, no explanations, no other students' data.
- [x] Per-item timing comes from `AppValue.attempts` (recent device attempts, capped at 600), which also feeds the pacing line.

### ✅ R2·M6 — Dashboard truth fixes (shipped 2026-10-26)
- [x] **Spaced review replaces filler.** Mastery stays "2 in a row", but a seen item is now drawable only when its review date has arrived. Spacing: miss = due now, correct once = 1 day, mastered = 7 / 14 / 30 days by consecutive correct count. Unseen items always lead; if the unseen supply runs out, the session is shorter instead of quietly reusing mastered items. Saved and incorrect-only drills stay explicit (`allowScheduled`) because the student chose those items.
- [x] Review state is visible: the Practice config reads `N ready · M due for review`, a drawn review item is labelled `review`, and the schedule lives in `src/lib/review.ts` with tests.
- [x] 14-day chart: dense window ending today, oldest → newest, first bar flush left (no leading dead space), titled bars including empty days.
- [x] **Test-date setting** in Account preferences (the assessment selector sits beside it), driving the `Goal:` badge. Stored in `profiles.target_test_date` (validated 2026–2035), adopted from the cloud only when the device has none, and rendered as `Goal: 12 days to Mar 13` (amber inside two weeks, "test is today" on the day).
- [x] Incorrect questions: re-answering clears the item from the retry list (progress `lastIsCorrect`), while **Missed log** keeps every wrong answer this device recorded, newest first, with the student's own response, section, domain and date. Empty state included.

### ✅ R2·M7 — Economy split: themes buyable, emblems earned (shipped 2026-10-23)
- [x] Store shows **themes only** (`STORE_ITEMS` = 8 themes, 20 → 3500). Every achievement grants its own emblem glyph, and only earned emblems can be worn (Rewards → Achievements → Wear).
- [x] DB: `purchase_cosmetic_item` refuses any non-theme type and the three legacy badge ids (`20261025000200_emblems_earned.sql`), verified live (both refusal paths returned 400). Legacy owners keep and can still wear their old emblem; nothing is refunded or removed.
- [x] Client and server price lists stay in parity, enforced by `src/lib/catalog.test.ts` reading the migration.

### ✅ R2·M8 — Practice polish (shipped 2026-10-26)
- [x] Practice cross-out restored to Bluebook behaviour: always-visible control, a line through the option instead of fading it, and choosing a crossed-out option selects it and lifts the strike. Keyboard parity (Shift + A–D / 1–4) matches the runner.
- [x] Custom practice count: **Other…** opens a direct question picker (domain, skill and difficulty filters plus multiselect, "Add all shown", Clear) whose selection defines the session; it is the only option that bypasses the count and the review schedule. `Start session` is disabled until something is picked.

### ✅ R2·M9 — Starting homepage (shipped 2026-10-26)
- [x] Full-page hero with a gradient wash, one primary **Start now** beside an "I have an account" secondary, three product facts and the legal footer — a homepage, not a Dashboard banner.
- [x] Shown only when this browser has **no** stored profile and no account: `#/welcome`, reached by redirect from `/`. "Start now" writes the profile and enters the app for good; signing in from here also enters. Route-level, never a modal.
- [x] Mobile-first (facts stack under 720 px), one heading, native buttons, keyboard focus, reduced-motion respected, and completely static — no bank, no network, nothing extra for PythonAnywhere to serve.

### ◐ R2·M10 — Question bank authenticity (first pass shipped 2026-10-27)
- [x] **The expansion pipeline.** `generate_bank_rw_m10.py` builds the batch from `supabase/import/data/m10/*.json`; `merge_bank_m10.py` adds it to the shipped bank without rewriting a single existing item and writes its own idempotent seed (`0002_m10_rw_expansion.sql`). Re-running replaces only the M10 rows.
- [x] **777 new Reading & Writing items, every one through the QA gate** (0 errors, 0 near-duplicate warnings on the batch): 120 Words in Context with authored context sentences, 20 Boundaries, 160 Transitions, 100 Central Ideas, 82 Inferences, 73 Text Structure and Purpose, 182 Rhetorical Synthesis, 40 quantitative-evidence items with real table / bar / line figures.
- [x] **Second batch, 2026-10-29: another 320 items** (0 errors, 0 warnings on the batch): 60 quantitative-evidence items on richer realistic tables and charts (multi-year lines, multi-category bars, differences and percentage-point gaps rather than "the tallest bar" every time), 60 passages, 55 Rhetorical Synthesis, 55 Transitions, 50 Boundaries and 40 Words in Context. Builder: `generate_bank_rw_m10b.py` + `data/m10b/*.json`; merged with `merge_bank_m10.py --incoming expansion/extra_rw_m10b.json --seed 0003_m10b_rw_expansion.sql --version 2026.10.30-open-core-5`.
- [x] **Bank now 7,290 items: 2,514 R&W / 4,776 Math** (was 1,417 / 4,776 before M10). Every figure renders through the existing `FigureView` and is covered by `rendering.test.tsx`; the live database holds the same 7,290 questions and keys.
- [x] **Two gate fixes found by the batch:** punctuation-only choices were being collapsed by `choice_key` (`, but` and `; but` both became `but`), so the comparator now keeps `; : ! ? — –`; and the Central Ideas key distribution needed one salted id to stay under the 45% bias threshold. Both are pinned by tests.
- [x] **Validation gate:** schema, one defensible key, explanation and a rationale per wrong choice, figure parses, no duplicate or near-duplicate stem — the merge refuses to write on any error.
- [ ] **Parity is not reached.** Matching Math still needs about **2,262 more R&W items**. Templated generation cannot supply them without failing the near-duplicate gate, so further batches are authored content: extend `data/m10b/*.json` and re-run the generator and merge. Nothing existing should be deleted to fake parity.
- [ ] **College Board items are still not imported.** Their licence does not permit redistribution, so the two new batches are original College Board-format questions with realistic data displays, not copied released items. The `--file` path, separate source row, `Official · …` label and QA gate are ready for an operator-supplied, licensed export; that is the only way to have genuine released questions in the bank.
- [ ] The dedupe backlog (481 repeated stems from the earlier templated Math tier) is deliberately **not** being rewritten; the gate stops new repeats.

### ✅ R2·M13 — Start page, guest nudge, deletable simulations (shipped 2026-10-29)
- [x] **Brand tile centred everywhere.** The welcome header used `inline-flex` with no centring, so the H sat flush left in its tile; the old accent dot also read as a clipped stroke. One `BrandMark` component now draws a symmetric white H in a grid-centred tile, used by the welcome page, sidebar and top bar. Measured in production: equal 6 px gaps on all four sides.
- [x] **Guest nudge.** Thin amber strip at the top of the Dashboard, shown at most twice: close once and it waits for the next visit (new tab/session), close again and it never returns. Signed-in students never see it; a blank browser has nothing to save yet. The old full-width welcome banner is gone.
- [x] **Glow motion.** The start page's three light pools travel further with a mid-point keyframe; all of it is skipped under `prefers-reduced-motion`.
- [x] **Deletable past simulations.** Inline confirmation, then the run and its responses are deleted. An `AFTER DELETE` trigger writes one compact score row (track, three estimates, raw counts, duration) to `test_score_log` first; only the owner can read it and clients cannot insert. A guest's deleted run keeps the score in the local profile. The Score log renders even when no simulations remain.
- [x] **Account deletion stays safe.** The live test caught the trigger inserting after `auth.users` had already been removed, which blocked the delete with a foreign-key error; the trigger now skips in that case. Verified by deleting a throwaway account with a score row.
- [x] **Test accounts purged** by explicit allowlist (`HD`, `Student`, two `SMTP Test`, one `Hrishi`); the three real students remain, all confirmed.
- [x] **Verification:** 185 Vitest tests, 19 backend tests, 18 triage tests, content-QA suite, typecheck, build, deploy `2026.10.30-open-core-5`, 18 live score-log checks, and a browser run of sign-in → delete → score log.

### ◐ R2·M11 — Flashcards expansion (first pass shipped 2026-10-27)
- [x] **Scheduler wording:** the page is just "Flashcards"; **every user-visible "SM-2" mention is gone**. The queue control now reads **Next**, the stat **Next up**, and the empty state **Nothing next**.
- [x] **Deck grew from 1,764 to 1,804 cards**: 36 new Math reference cards (median/mode/range, weighted mean, probability and independence, perpendicular and parallel slopes, midpoint and distance, point-slope and standard form, system cases, vertex and discriminant, roots, function notation and transforms, variation, sequences, growth models, density, unit rate, similar triangles, polygon angles, arc length and radians, best fit and margin of error) and 4 new vocabulary words. The 1,615-word CC0 corpus was already fully used, and 74 of the 78 proposed words were already in the deck, so vocabulary growth now needs new sourced lists rather than more duplication.
- [ ] A larger vocabulary source and a second Math batch remain; the merge script is the repeatable path.

### ✅ R2·M12 — Study-loop additions (shipped 2026-10-23)
- [x] **Resume strip.** Custom Practice snapshots itself to `hdsat.practice-session.v1`; the Dashboard shows `In progress · SAT · Item 3 of 10 · 1 answered · 00:42` with one Resume action, and resuming lands on the first unanswered item. A finished or 7-day-old session is discarded.
- [x] **Pacing on review.** After each answer: `You 2:10 · typical 1:25`. "Typical" is the student's own median for that section+difficulty once 5 timed attempts exist, then the section median, then the official pace (71 s R&W / 95 s Math).
- [x] ~~**Weekly coach email**~~ — **removed 2026-10-26** at the owner's request. The sender tool, its tests, the frontend toggle and the live database objects (columns, ledger table, both RPCs) are gone; `20261026000100_remove_weekly_coach.sql` is the live cleanup.
- [x] **Content QA harness.** `tools/content_qa.py` checks duplicate ids/stems, near-duplicate stems inside a section+skill, defensible keys, duplicate/empty choices, explanation length, figure kinds, metadata and per-skill key bias. The importer runs it on any `--file` dataset and refuses to write when it finds errors; `--qa` audits the whole merged bank. 24 offline tests.
- [x] **Official dataset stays separate.** A dataset merged with `--file` keeps its own source row, name, licence, attribution and `is_official_college_board` flag in both the client bank and the seed SQL; the Bank and Practice selectors label it `Official · …`, and the QA gate requires an official attribution. The earlier code path silently dropped external sources at output time and would have crashed on their items; that is fixed and exercised with a synthetic official item.

---

## Section 3 — Answers to standing questions (keep updated)

1. **"Mastered, 2+ in a row" — how does the item come back?** `status` becomes `mastered` after two consecutive correct answers on the *same* item, counted across sessions (`consecutiveCorrect >= 2` in `src/lib/storage.ts` and the `submit_question_attempt` RPC). Since 2026-10-23 practice no longer uses old items as filler: after the unseen supply is used, only items whose review date has arrived can be drawn (miss = now, correct once = 1 day, mastered = 7/14/30 days). A normal session can therefore be shorter than requested — that is the schedule working, not a shortage. `src/lib/review.ts` owns the rule and `src/lib/practice-schedule.test.ts` pins it.
2. **What "SM-2" means here.** The classic spaced-repetition scheduler used by the flashcard deck: each review scores recall 0–5, which nudges an ease factor (floor 1.3). A score below 3 resets the interval to 1 day; successes step 1 → 3 → then `interval × ease`, and a 14-day interval marks the card `mastered`. `src/lib/sm2.ts` mirrors the PL/pgSQL so guest and cloud schedules agree. It is deliberately **not named in the UI** any more.
3. **Storage reality and how many students fit (measured 2026-10-29).** Supabase DB = **27 MB** total: 9.9 MB `questions` (7,290 rows after both R&W batches), 3.4 MB `question_keys`, 0.5 MB `flashcards` (1,793 rows), and everything owned by students is still under **0.05 MB of row data**. At the same density the free plan's **500 MB database** holds roughly **270k questions with keys**, or the current bank plus about 470 MB of history.

   **Per student, per year (heavy user: ~3,000 attempts, 20 full tests):** attempts 0.5 MB, test attempts + responses 0.25 MB, progress rows 0.3 MB, daily activity 0.03 MB → **≈1.2 MB with indexes**. A casual student (~500 attempts) is ≈0.2 MB. So the free database holds roughly **400 heavy students or ~2,300 casual ones for a full year of history**; Pro's 8 GB multiplies that by 16 (~6,500 heavy / ~37,000 casual).

   **What actually runs out first is hosting, not rows.** Supabase free adds **5 GB egress/month** and **50k MAU**: at 655 KB gzipped first load that is ~7,600 *new* visitors per month (returning visitors revalidate cheaply). PythonAnywhere free is **one web worker with 100 CPU-seconds/day** — fine for a few dozen simultaneous readers, the real ceiling for a launch spike, and the reason to move to a paid plan (more workers/CPU) before pushing traffic. PythonAnywhere stores no question data: it serves the compiled bundle, which embeds the bank JSON (≈9.4 MB raw, 655 KB gzipped) as a build asset, not a second database.
4. **Is the bank stored twice?** Yes, on purpose, and neither copy is redundant: the JSON bundle lets guest mode work offline and gives instant filtering with no round trip, while the Supabase `questions`/`question_keys` rows are what every cloud RPC writes against (foreign keys) and what the server grades with. The JSON is the source of truth; the database is a derived copy that `import_questions.py` → `apply_seed.py` rebuilds. Dropping either one breaks a supported mode.
5. **Discoverability.** HDSAT is a brand-new exact-match name, which is the easy case: one page that owns the term, `sitemap.xml`, canonical URLs, `Organization`/`WebSite` structured data, Search Console + Bing submission, and a handful of real inbound links (the YouTube channel, GitHub repo, a couple of forum/Reddit answers where genuinely useful). No paid ads needed at this size. Deferred to Section 4.

6. **What happens on the 301st email of the day (Brevo free = 300/day)?** Nothing blocks a student any more. Sign-up issues a session immediately and sign-in never needs mail, so an exhausted quota only pauses **verification**: the account keeps working as a light account, and the confirm strip says "Email verification is paused for today — come back tomorrow, keep studying signed in." The app stops asking at **280** (`email_send_budget()` counts `email_request_log.send_count` for the UTC day) so the provider is never handed a request it must refuse, and only ~280 *different* addresses can spend the budget because each address gets one confirmation and one recovery message a day. Recovery links are the one thing still affected in that window; the long-term fix is a paid Brevo plan or a second provider, and Google sign-in (Section 4.5) removes the verification email from the signup path entirely.

8. **How many accounts fit now that light accounts exist?** Two things changed. A light account keeps `user_question_progress`, `user_stats`, `daily_activity`, `flashcards`, `saved_questions` and a test **summary**; a trigger blanks the `question_attempts` payload (response + timing) and a second trigger skips `test_responses`. Measured density: a compact attempt row is ~60–80 B against ~150 B before, and a full test drops from ~12 KB of response rows to zero. A heavy light student (3,000 attempts + 20 tests a year) therefore costs roughly **0.5 MB**, a casual one (500 attempts) about **0.1 MB**; a verified heavy student stays at **~1.2 MB**. The free 500 MB database therefore holds roughly **800–1,000 heavy light accounts, ~4,000 casual light accounts, or ~400 verified heavy accounts** for a full year of history, and the 8 GB Pro plan multiplies that by 16. Auth users add ~1–2 KB each, which is negligible at these counts.

   **Storage is not what breaks first.** Supabase free also caps **50,000 MAU** (far above this bank's reach) and **5 GB egress/month** — at the current 661 KB gzipped bundle that is ~7,600 *new* visitors a month (returning visitors revalidate cheaply). PythonAnywhere free is **one web worker with 100 CPU-seconds a day**, which is the real launch ceiling. So the practical answer is: ~1,000 heavy or ~4,000 casual **light** accounts of history fit the database, but plan paid hosting before roughly a hundred simultaneous students.

7. **Does a wrong password lock a student account?** No. Student accounts have **no lockout** — a wrong password is just a failed sign-in, and the app never counts or blocks. The 5-try / 15-minute lock belongs only to the **operator console gate** (passcode + human check), which is a separate mechanism in Postgres. The only student-side limits are the credential cooldowns: 1 password change/hour and 1 recovery link/address/day. Supabase itself rate-limits auth requests per IP above our layer, which can briefly slow down a scripted attack but never locks a real account.

---

## Section 4 — Deferred until v1.0 is frozen (do **not** start)

1. **Offline open-source fork** — unlink Supabase / PythonAnywhere / Brevo, replace the GitHub with the offline clone, keep only a 1,000-question representative mix, prune themes/achievements to match. Owner starts this explicitly.
2. **Other exams tab** — ACT / NEET etc. as a separate area with its own data.
3. **Study guides** — long-form, visual, researched guides (Acely/Khan style) as their own pages.
4. **SEO / discoverability** — see Section 3.4 for the playbook; after launch polish.
5. **Compressed cloud storage for every account** — owner asked (2026-10-26) to shrink what is kept in the cloud in general, not only for light accounts, but explicitly **not yet** so no existing history is lost. The shape to review later: drop per-attempt `response` text for everyone (it is only used for the student's own review), roll `daily_activity` into monthly buckets after a year, and purge `test_responses` for completed tests older than N months. Nothing here should run until there is a migration plan that keeps exports whole.

6. **Google sign-in (OAuth)** — owner asked to add it, explicitly **not now**. Adding a provider means verifying branding + a consent screen, registering exact redirect URLs for the live origin and localhost, and testing account linking (an existing email/password account signing in with Google). Do it after the site polish pass, as its own milestone with its own review — never as a side change during another one.

7. **Security hardening audit** — owner asked (2026-10-27), explicitly **not now**. One pass that treats the browser as hostile: confirm no RPC trusts a client-supplied user id, coin amount or price; review every RLS policy and `SECURITY DEFINER` function for search_path and grant mistakes; confirm answers cannot be read from PostgREST; keep the admin passcode bcrypt-hashed with token expiry and the device log; check rate limits and storage-bucket exposure. Cheating through devtools is already limited (grading and coins run in Postgres), but the audit should prove it endpoint by endpoint before launch.

8. **Purge and republish the Git history** — owner asked (2026-10-27), **after the site is final**, not now. Replace the current history with a clean open-source-friendly one (no old revisions of credentials or experiments), then publish. Never rewrite the history while remote work is in flight.

9. **A second database for non-user data** — owner asked (2026-10-27), **not now**. Split question/flashcard catalogues and any analytics onto another provider so Supabase holds only accounts and student history (or the reverse, if that audits better). A migration plan and a dual-read period would be required; nothing should move until the site is frozen.

---

## Section 5 — Decisions (resolved 2026-10-23)

1. **Copy trim aggression** — **thin**: label + action, one short hint at most, applied to every working page (see R2·M2).
2. **College Board Educator Question Bank** — **accepted as a separate dataset.** Official items keep their own source row, licence, attribution and `is_official_college_board` flag, are labelled `Official · …` in the Bank and Practice selectors, and pass through the QA gate before they can be written. No College Board content has been imported yet; the pipeline is ready (R2·M10).
3. **Password email path** — **1 request/day per account** accepted (R2·M3 still to build).
4. **Emblems** — **the purchase option is removed entirely.** Store = themes only; achievements earn emblems (R2·M7). Legacy emblems stay wearable, not refunded.
5. **Mastery** — keep "2 in a row" and fix the filler flaw with spaced review rather than changing the definition (R2·M6).
6. **Flashcards** — scheduler stays as SM-2; the name never appears in the UI (R2·M11).
7. **Weekly email** — **removed 2026-10-26.** No weekly digest, no opt-in, no sender.
8. **Password change** — shipped 2026-10-26: 1 change/hour, 1 recovery link/day, both in the database; "sign out other sessions" defaults on. Using a recovery link is not blocked by the hourly cooldown.
9. **Bank growth** — new questions skew **Reading & Writing** until it matches Math (4,776 vs 2,514 today); duplicate cleanup is skipped in favour of adding better items.
10. **Email limits** (2026-10-26) — one confirmation email and one recovery link **per address per day**, enforced in Postgres (`email_request_log`, address stored as SHA-256 only) and mirrored by a device guard. Keyed by address so signed-out students are covered, and recorded for every address whether or not an account exists (no account enumeration). A failed send never starts a cooldown.
11. **Operator sign-in attempts** (2026-10-26) — a wrong passcode records **one row per device** (IP + user agent read from the request headers, never from the browser), with an attempt counter. Capped at 100 devices, and the console can delete one row or clear all. Student accounts are **not** locked by wrong passwords; only the console gate has the 5-try / 15-minute lock.
12. **Google OAuth** — accepted as a future item, deferred to Section 4.5.
13. **Light accounts** (2026-10-26) — email confirmation is **off**; sign-up signs in immediately and the emailed 6-digit code only lifts the light-account cap. Capping is enforced in Postgres (compact attempt ledger, no `test_responses` rows), never as a paywall: progress, coins, streaks, flashcards, tests, reports and account deletion all work. The owner's preferred quote wins the day: "come back tomorrow, keep studying signed in."
14. **Test date** — one optional date per account, synced in `profiles.target_test_date`, shown as the Dashboard goal. It never blocks practice or a full test.
15. **Starting homepage** — a route-level hero, blank slate only; a signed-in student or an existing local profile can never see it on the way in, and "Start now" is the one-way door.
16. **Homepage motto (2026-10-27)** — one original line per visit, always different from the last, stored in `hdsat.welcome-motto.v1`. The page also keeps a slow brand glow and two drifting light pools, all disabled under `prefers-reduced-motion`. Reaching `#/welcome` on purpose (Credits links there) shows the page even with a session; it no longer bounces a signed-in student away.
17. **Leaderboard (2026-10-27)** — top five by HDCoin balance, signed-in only, name + coins + best streak + attempts only. `get_leaderboard` is `SECURITY DEFINER`, granted to `authenticated` alone, and replaces any name containing `@` or markup with "Student". An off-board student still sees their own rank.
18. **Lifetime HDCoins (2026-10-27)** — `user_stats.lifetime_coins`, maintained by a trigger on the coin ledger and backfilled from it; purchases reduce the balance but never the lifetime total. Guest mode keeps the same counter in `LocalProfile`.
19. **Confirmation email (2026-10-27)** — one template carries **both** the link and the 6-digit code, and both stay valid for **24 hours** (`mailer_otp_exp = 86400`).
20. **M10 / M11 first pass (2026-10-27)** — 777 new R&W items through the QA gate (bank 6,970) and 40 new cards (deck 1,804). Parity with Math and a larger vocabulary source remain open content work, not code work.
21. **Second R&W batch (2026-10-29)** — another 320 original items, 0 QA errors and 0 warnings; bank 7,290 (2,514 R&W / 4,776 Math). Roughly 2,262 R&W items still separate the two sections.
22. **Deleting a simulation (2026-10-29)** — the run and its per-item responses are deleted on confirmation; the score survives in `test_score_log`, written by a database trigger, readable by its owner and unforgeable from the client. The log renders even when no saved simulations remain.

---

## Section 6 — Research notes for the deferred hardening work (2026-10-29, not implemented)

Nothing in this section has been applied. It is the material for the three deferred items in Section 4 (security audit, Git purge, second database) and the hosting question.

### 6.1 Hosting: the real ceiling is the PythonAnywhere worker
- **Correction to an earlier assumption:** PythonAnywhere's **100 CPU-seconds/day** applies to consoles, scheduled tasks and always-on tasks, **not** to the web app. The free web app's actual limit is **one web worker**, which handles one request at a time; a burst queues. Bandwidth on free is described only as "low", with no published number. First paid tier is **Developer, $10/month**: 3 workers, 5 GB disk, 5,000 CPU-seconds for the non-web uses.
- **Best free move:** the Vite build is pure static output, so **Cloudflare Pages Free** serves it with unlimited static requests and no adapter (500 builds/month, 20,000 files, 25 MiB/file). A Pages Function can replace `/api/health`; Workers Free covers 100k requests/day. Render's free static tier (5 GB/month egress) and GitHub Pages (100 GB/month soft) are alternatives; Vercel Hobby is non-commercial only; Fly.io no longer has a free tier.
- **Supabase free** is still 500 MB DB, 5 GB egress + 5 GB cached, 50k MAU; Pro is $25/month with 8 GB DB and 250 GB egress. Serving the question bank from the app bundle (already true) keeps that egress off Supabase entirely.
- **What breaks first at ~100 concurrent students:** the single PythonAnywhere worker, not the database. Moving static hosting to Cloudflare removes the front-end queue and leaves only the tiny health/functions traffic.

### 6.2 Security audit: concrete checklist
- Inventory every exposed table, view, RPC and storage bucket. The publishable key is public by design; authorization must come from `auth.uid()` and policies, never a client-supplied id.
- Review **grants and policies together**. New Postgres functions are executable by `PUBLIC` by default — revoke globally, then grant each RPC only to `authenticated` (or `anon` where genuinely needed). RLS does not apply to functions.
- For every `SECURITY DEFINER` function: `SET search_path = ''` and schema-qualify objects (or at minimum `public`), validate the caller and row ownership inside the body, and revoke execute from roles that do not need it.
- **Answer keys are already in the bundled bank** because guest mode grades offline. That is acceptable for a free study tool (released practice keys are public anyway), but it means the coin economy is an honour system for guests. For signed-in students, grading and coins already run in Postgres. Do not pretend the leaderboard is cheat-proof; rate-limit award paths and keep the ledger append-only/idempotent.
- Confirm `question_keys` stays unreadable through PostgREST (it is today), run Supabase Security Advisors, and add pgTAP tests that assert denied operations, not only allowed ones.
- Auth throttles (Supabase's per-IP limits) are not app-level abuse controls. Coin/answer RPCs need their own per-user limits if farming becomes a problem.

### 6.3 Git history purge: correct order
1. Keep the repo private, pause pushes, and inventory every branch, tag, PR, Actions log and artifact for leaked credentials. A clean working tree proves nothing.
2. **Rotate every credential first** (Supabase PAT, service key, Brevo SMTP/API keys that passed through chat, GitHub token). GitHub's own guidance: a committed secret is compromised even after history is rewritten.
3. Rewrite in a fresh clone with **git-filter-repo** (2.47+ for `--sensitive-data-removal`): `--invert-paths --path …` for files, `--replace-text` for values. BFG is faster for simple path/blob removal but protects the latest commit by default.
4. Force-push all refs (`git push --force --mirror origin`), then re-clone everywhere; stale clones must not push the old history back. GitHub Support is needed for cached PR views; forks cannot be erased.
5. Re-scan, enable secret scanning + push protection, check Actions logs become public with the repo, and only then flip visibility. Push rulesets are disabled on a private-to-public change.

### 6.4 Second database for non-user data
- The lowest-risk option is **Neon (Postgres)**: Supabase → Neon logical replication can stream the catalogue tables, with direct connections (not the pooler), matching schemas and watched lag. DDL is not replicated, so migrations must be applied to both.
- **Cloudflare D1 / Turso** are SQLite, not Postgres drop-ins: schema and SQL must be converted (no direct Postgres import).
- A second database **does not inherit Supabase Auth or RLS**. Its credentials must stay behind a server/Worker, never in the SPA. Keep one writer, use shadow reads with a fallback, cut over with a freeze + checksum check, and keep the old source read-only for rollback. Avoid dual writes — two databases cannot commit atomically.

## Section 7 — Round notes (2026-10-31)

- [x] **Past simulations fit the window.** The table became a responsive row list; the eight columns were forcing the whole card wider than a phone viewport, which is what clipped the status badge in the reported screenshot. Verified at 375 px: `scrollWidth 399 < viewport 417`, every row 333 px wide, no overflowing descendants.
- [x] **Score log and delete are windows.** Both are dialogs now, so neither can be pushed off-screen by a long list. The score log button reads "Score log (n)".
- [x] **"no cap" removed**, along with the old inline delete confirmation and its CSS.
- [x] **Break screen stacks and scrolls.** At 375 px the timer sits above the instructions (timer y 33–133, text 147–480) and the resume button is on screen; at 390×467 the screen scrolls and "Resume Testing Now" is reachable at y 400–434.
- [x] **The score report is a PDF.** A dependency-free writer produces a real one-page document. Verified: `pdftotext -layout` shows the header band, three score panels, four module rows with accuracy, notes and footer; duration now prints `1:59:00`, not `119:00`. Browser check produced `application/pdf`, 3,952 bytes, `HDSAT-score-report-2026-10-23.pdf`.
- [x] **M13 bank batch: 304 items**, 0 QA errors / 0 warnings on the incoming set. Bank now 7,594 (2,674 R&W / 4,920 Math); Math crossed 5,000. Figures: 12 right triangles, 8 legs, 10 rectangle areas, 8 perimeters, 6 missing sides, 12 circle areas, 8 circumferences, 6 radii, 16 slopes, 12 intercepts, 8 parabolas, 8 zero sets, 8 function tables, 8 exponential tables, 8 bar charts, 6 line charts; 40 authored quantitative-evidence R&W items with tables and charts.

### 7.1 Still open

- **R&W volume.** 2,326 more R&W items are needed for 5k/5k. Authoring runs at roughly 160 items per reviewed batch; the merge path (`merge_bank_m10.py --incoming …`) is the safe way to add each one.
- **Duplicate debt in the old bank.** `tools/content_qa.py` reports 481 exact duplicate stems and about 5,000 near-duplicate pairs across the pre-existing generated tiers (the new batch contributes none). They are parameter variants from earlier volume sweeps. Cleaning means archiving ids, which would remove items students may have practiced — waiting on the owner's call.
- **Public-source items.** Copying released College Board questions into a public bank is a licensing problem, and the openly licensed SAT-style R&W corpora that exist are small and uneven. Original items in the official formats remain the safe path; a licensed export can be imported unchanged with `--file` if one is ever obtained.

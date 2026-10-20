# HDSAT — ideas and fixes (planned, NOT implemented)

Backlog from 2026-10-19. Everything here is a **plan only** — do not start any of it
until the user says go. Each item lists where it lives and how I'd implement it.

---

## 1. Hide question-count visibility (flashcards etc.)

**What:** Totals like "6,193 items", deck sizes, and unseen-pool counts should be
hidden from students. Keep only progress-relevant numbers (completed, incorrect,
mastered) visible.

**Where:**
- `src/components/Layout.tsx` — sidebar shows "Bank 2026.10.18-open-core-3 · 6193 items".
- `src/pages/FullTest.tsx` — "Fresh-item mode: … 1362 unseen R&W items and 4732 unseen Math items".
- `src/pages/Flashcards.tsx` / `src/pages/QuestionBank.tsx` — deck/bank totals.

**Plan:** Replace raw counts with a single small muted "Official practice bank"
label (or nothing). Keep counts in `data-testid` attributes (or a dev-only flag)
so tests can still assert on them without showing them to students. Update
`rendering.test.tsx` asserts to query the hidden hooks instead of visible text.

## 2. Arcade development

**What:** Mini-games need depth, clearer scoring, and replay value.

**Where:** `src/pages/Arcade.tsx` + game components.

**Plan:** Pick 2–3 games (e.g. Sprint, Match, Memory), give each a defined
scoring curve (combo multiplier, speed bonus), a persistent high-score board
stored in `dailyActivity`/profile, and a short "how scoring works" line. Remove
games that can't be polished. Wire arcade completions to `completeSession`
(`activityType: 'mini_game'`) so coins/streaks count.

## 3. Coin management (global + arcade) and Rewards cleanup

**What:** Consistent HDCoins economy across practice, arcade, and rewards; the
rewards page should highlight achievements and drop its disclaimer text.

**Where:** `src/lib/storage.ts` (caps: `DAILY_QUESTION_COIN_CAP` 60,
`DAILY_FLASHCARD_COIN_CAP` 15), `supabase/migrations/*` RPC coin rules,
`src/pages/Rewards.tsx`, `src/pages/Arcade.tsx`.

**Plan:**
- Define one economy doc: earn rates per activity (practice 1–2, flashcard 1,
  arcade 1–3 by score), daily caps per activity type, and prices in
  `src/lib/catalog.ts`.
- Mirror any rule change in BOTH `storage.ts` (guest) and the PL/pgSQL RPCs
  (`submit_question_attempt`, `complete_activity_session`) — they must match
  exactly (existing rule of the road).
- Rewards page: remove the disclaimer paragraph, lead with the achievements
  grid (locked/unlocked states), then the shop.
- Note: coin values earned in tests (mode 'test') currently flow through
  `submitAttempt` like practice — decide whether full-test attempts should
  award coins at all (recommend: yes but capped, since answers are hidden until
  completion).

## 4. Where complaint reports are saved — do we need admin?

**Answer (verified in code):** Reports go straight into **Supabase Postgres**:
- `question_reports` — one row per bad-question report (`src/lib/cloud.ts`
  `reportQuestion`, insert-only per user via RLS; readable only by its author).
- `user_appeals` — safety/copyright/data-rights appeals (`submitAppeal`, returns
  a `reference` code).

There is **no admin UI today**. Only a project operator can triage them, via:
- Supabase Dashboard → Table Editor (filter `question_reports` / `user_appeals`),
- or the service-role key in a private script.

**Recommendation:** yes, we need something, but a lightweight one:
1. Short term (this week): a tiny operator page in the app gated by an
   `is_admin` flag on `profiles` (server-enforced via a SECURITY DEFINER RPC
   `list_open_reports` that checks the flag) — never expose the service key.
2. Alternative with zero app code: a scheduled digest (Supabase Edge Function or
   even a daily email via Brevo) that mails new reports to the operator inbox.
3. Either way, RLS stays as-is: reporters read only their own rows; admin access
   only through a definer function.

Decision needed from the user: admin page vs. email digest.

## 5. Question-bank lag (6k questions in catalog)

**What:** Loading the whole bank makes the Question bank page and first paint
sluggish.

**Where:** `src/data/questionBank.json` (~6,193 items) is inlined into the main
chunk (`vite.config.ts` notes this), imported eagerly in `src/lib/store.tsx`.

**Plan (pick one, in order of payoff):**
1. **Split data from the main chunk:** `import('./data/questionBank.json')`
   lazily (dynamic import) so first paint doesn't parse 6k items; show the boot
   spinner only until it arrives. Smallest change, biggest win.
2. **Paginate/virtualize** the Question bank list (e.g. 50 rows + "Load more",
   or `react-window`) so rendering stays fast regardless of bank size.
3. Trim the JSON payload per page: the bank page needs id/domain/skill/difficulty
   only; build a slim index at seed time and fetch full items on demand.
4. Keep full bank only for test building (`examEngine`), which can run after the
   lazy load resolves.

## 6. Remove filler copy (polish for real users)

**What:** Too much explanatory text on ordinary pages. Trim so actions lead.
Do NOT touch the Bluebook runner or legal/data-rights pages.

**Where:** `src/pages/Dashboard.tsx`, `FullTest.tsx` setup card (the long
section descriptions), `Practice.tsx`, `Flashcards.tsx`, `Account.tsx`
(descriptions above forms), `Rewards.tsx`, `Resources.tsx`.

**Plan:** For each page keep one short line of purpose + the primary action
above the fold; move detail into `<details>` disclosures or tooltips. Target:
remove ~40–50% of static prose. Keep every hint that changes behavior (e.g.
fresh-item notice, coverage warnings).

## 7. Further polishing for public launch

**What:** A sweep for anything that still feels like a dev build.

**Plan:**
- Empty states everywhere ("No saved questions yet" with a CTA).
- Loading/skeleton states on data-heavy pages.
- Error toasts that say what to do next (already partly in `store.tsx`).
- Consistent naming ("Full test" everywhere), consistent button hierarchy
  (one primary per view).
- Favicon/OG tags + a real page title per route.
- Final legal read-through (Terms/Privacy/Copyright) before public links.

## 8. Blue icon theme (subtle)

**What:** A quiet blue accent for icons/brand, worth it but subtle.

**Where:** `src/styles/global.css` tokens (`--accent: #1f5fd0` already exists),
`src/components/Layout.tsx` (brand mark), lucide-react icon set.

**Plan:** Use one blue (`--accent`) for icon strokes, the brand tile, active
nav state, and focus rings; keep surfaces neutral. Add a `--accent-soft` for
hover backgrounds. No full re-skin — a token pass + icon color pass only.
Optional: an `accent_theme` cosmetic variant in the Rewards shop (the
`purchaseCosmeticCloud` path already supports `accent_theme` items).

## 9. Optimize for mobile

**What:** The UI breaks down on small screens (the Bluebook runner especially —
split panes, reference sheet, footer pills).

**Where:** `src/styles/global.css` media queries (currently one `max-width:
900px` block), `src/pages/FullTest.tsx` runner layout, `Layout.tsx` mobile nav.

**Plan:**
- Bluebook runner: below ~760px, stack stimulus above question (single column),
  full-width reference sheet as a bottom sheet, tappable nav grid.
- Tap targets ≥ 44px, no hover-only affordances (the eliminator toggle, tooltips).
- Fix the `.content` bottom padding vs mobile nav overlap; test at 360/390/414px.
- Test the full test flow on a phone-sized viewport end-to-end.

## 10. Backend security pass

**What:** "Security fix the backend perfectly."

**Where:** `backend/app.py` (Flask serving the SPA), `supabase/migrations/*.sql`
RLS + SECURITY DEFINER RPCs, `.pa/deploy.py`.

**Plan:**
- Audit every table: RLS enabled, owner-only policies, no `USING (true)`.
- Every RPC: `SECURITY DEFINER`, `SET search_path = public`, input validation,
  and explicit user check (`auth.uid()`), never trusting client-supplied user ids.
- Flask: security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy),
  no cache of authenticated responses, rate-limit the report/appeal endpoints
  (they're insert-only but public-ish), and ensure no secrets in repo (scan for
  `xkeysib`, `sbp_`, service_role keys).
- Rotate the Supabase PAT and Brevo keys (they passed through chat earlier),
  then re-run `apply_auth_config.py`.
- Add a `SECURITY.md`-style checklist to this file when done.

## 11. Selection boxes instead of dropdowns (mysatprep style)

**What:** For the main selectors (assessment track on Full test, and the main
filters on Practice/Question bank), replace `<select>` dropdowns with big
selectable cards/boxes.

**Where:** `src/pages/FullTest.tsx` (assessment `Select`), `src/pages/Practice.tsx`
and `src/pages/QuestionBank.tsx` filter controls, `src/components/ui.tsx`
(add a `SelectCards` primitive next to `Select`).

**Plan:** New `SelectCards` component: a row/grid of pressable cards with a
selected state (accent border + check), keyboard navigable (arrow keys +
Enter, `role="radiogroup"`). Use it for assessment choice and section/domain
picks where there are ≤ 6 options; keep plain dropdowns for long lists
(domain/skill with many entries) or turn those into a searchable popover later.

---

## Order I'd tackle these (suggestion)

1. **#5 bank lag** + **#1 hidden counts** (quick wins, big perceived speed)
2. **#11 selection boxes** + **#6 filler removal** (visible polish)
3. **#9 mobile** (needed before public)
4. **#10 security** + **#4 reports/admin decision**
5. **#8 blue theme**, **#7 final polish**
6. **#3 coins/rewards**, **#2 arcade** (bigger creative work)

Waiting on the user for: admin page vs email digest (#4), and the go-ahead for
the rest.

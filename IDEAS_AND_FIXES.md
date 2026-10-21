# HDSAT — build log & roadmap

**Last updated:** 2026-10-20
**Rule for this file:** the *Sprint* section is approved direction but **not started**.
Only work marked ✅ under "Shipped" is in the product.

---

## ✅ Shipped 2026-10-20

### 1. Practice & Skill Drills — custom session lengths
`5 / 10 / 15 / 22 / 25 / 27` questions. 22 and 27 match the real Math and R&W
module sizes, so a single-module rehearsal is one click away.
`src/pages/Practice.tsx`

### 2. Multi-select domains and difficulties
Custom practice now filters on **any combination** of domains and any
combination of Easy/Medium/Hard.
- `PracticeFilters` accepts `domains: string[]` and `difficulties: Difficulty[]`
  (empty list = every value). The old single-value `domain` / `difficulty`
  filters still work for the Study Coach deep links and other callers.
- New `MultiSelect` primitive (`src/components/ui.tsx`): checkbox dropdown,
  "All …" summary, count chip, outside-click/Escape dismiss, "Show all" reset.
- Study Coach "Drill X" seeds exactly one domain.
- Verified live: selecting 4 Math domains + Easy/Hard produced 10/10 Math items
  with no Medium item, and the matching-item count moved 6193 → 1876.

### 3. Full test — "■ Answered" legend
Was rendering in body ink (`#14181f`); now `#2557d6`, matching the answered
grid cells. Verified on the live Check Your Work screen
(`getComputedStyle` → `rgb(37, 87, 214)`).
`src/pages/FullTest.tsx`, `src/styles/global.css`

### 4. Practice Rush — difficulty, free modes, dynamic curve, records
- **Third setting: Difficulty** — Easy / Medium / Hard / Mixed / **Increasing**.
- **Free duration** — unlimited, stopwatch counts up instead of a countdown; the
  timer bar is hidden and a stopwatch badge replaces it.
- **Increasing difficulty** — a documented, per-second interpolated curve:
  Easy 100% at 0 s → 90/10/0 at 1 min → 78/18/4 at 2 min → 65/26/9 at 3 min →
  55/32/13 at 4 min → 50/35/15 at 5 min → settles at the SAT module mix
  (30/42/28) after 12 min. A greedy deficit scheduler serves the difficulty
  furthest behind the curve, so the real mix tracks the target instead of
  drifting. The live mix is shown as a stacked bar plus percentages.
- **Scoring** (transparent, per answer): Easy 10 / Medium 15 / Hard 20 points,
  +10% per consecutive correct answer, capped at +50%. Wrong answers score 0.
  Runs under 3 answers are not recorded (same floor as the activity RPC).
- **High score + last score per combination** — keyed by
  `duration|section|difficulty` in `hdsat.profile.v1.rushScores`
  (`{ best, last, bestAt, lastAt, plays }`). Shown under the setup selectors as
  "High score / Last", in the summary, and in an "All personal bests"
  disclosure. Works in guest and cloud modes (device-local, like the rest of the
  local ledger) and tolerates profiles saved before the field existed.
- Files: `src/lib/rush.ts` (new), `src/lib/storage.ts`, `src/lib/store.tsx`,
  `src/pages/Practice.tsx`, `src/styles/global.css`.

### 5. Emblems are icons again — one glyph each, no text
The top bar renders the equipped emblem as a **glyph only**:
compass (`badge-navigator`), graph (`badge-grapher`), crown
(`badge-centurion`). No `★`, no "Adaptive Navigator" wording, tooltip +
aria-label only. The store previews the same glyph, highlighted when equipped.
`src/components/Layout.tsx`, `src/pages/Rewards.tsx`, `src/lib/catalog.ts`,
`src/components/ui.tsx` (new `compass` / `graph` / `crown` icons).

### 6. Store repriced as an increasing ladder
`Oxford Navy 20 → Forest Sage 50 → Warm Amber 100 → Plum Ink 150 →
Navigator 200 → Grapher 300 → Centurion 400` HDCoins.
- Client catalogue and the server RPC are kept in lockstep by
  `supabase/migrations/20261020000100_cosmetic_price_ladder.sql` (applied live and
  verified against `pg_get_functiondef`), plus a unit test that fails if the two
  ever disagree. The old `' plum-ink'` typo branch is gone and `p_item_type` is
  validated.

### Verification for the above
99 Vitest tests pass, `tsc --noEmit` clean, `vite build` clean. Live browser
checks: multi-select filtering, 22/27 lengths, rush free stopwatch, increasing
mix display, correct-answer scoring (10 pts / streak 1), store prices and
glyph rendering, emblem equip → top-bar glyph swap, review legend colour.

---

## 🚧 Sprint 2026-10-21 → 2026-10-26 (approved, not started)

### A. College Board Student Question Bank import
**What:** import official SAT Suite Question Bank items so the bank reads as
authentic practice material.

**Where:** `supabase/import/import_questions.py` (existing importer + `--check`),
`supabase/import_check_helper.py`, `supabase/seed/`, `src/data/questionBank.json`.

**Plan:**
1. Map the SBQB export/columns onto the existing `Question` shape (section,
   domain, skill, difficulty, format, stimulus, prompt, choices, key,
   explanation, rationale, source/licence/attribution).
2. Extend the importer with a dedicated source id (e.g. `cb-sbqb`) and
   `is_official_college_board: true`; keep attribution on every item.
3. Add a dry-run that reports duplicates against the existing 6,193 items
   (content/stimulus/template keys already exist in `examEngine.ts`) and
   refuse silent overwrites.
4. Re-run the figure/scale/math generators so new items get charts.
5. Update the cloud `questions` + `question_keys` seed, then verify
   `/api/health` question count and a sample attempt end-to-end.

**Guardrail:** only import content we may redistribute; keep the licensing note
accurate and never strip attribution. Ask before any bulk rewrite of the bank.

### B. Arcade 2.0
**What:** make the arcade genuinely fun and replayable instead of placeholder
skill drills.

**Where:** `src/pages/Arcade.tsx` (+ new game components), `completeSession`
(`activityType: 'mini_game'`), `src/styles/global.css`.

**Plan:**
- 3 games with real mechanics: a fast calculation sprint, a term/definition
  match, and one spatial/graph game using the Desmos-style canvas.
- Each gets: explicit scoring curve (combo + speed), 60-second rounds, keyboard
  controls, sound-off by default, pause/restart, and a personal best stored per
  game the same way rush records are stored.
- Coins: 1–3 per completed round, capped daily (mirror in the PL/pgSQL RPC).
- No pay-to-play, no loot boxes.

### C. Owner admin panel + AI-graded review link
**What:** a single operator surface for question reports, appeals, bank health
and AI-assisted triage, reachable only by the owner.

**Where:** new `/admin` route gated by an `is_admin` flag on `profiles`
(server-enforced), SECURITY DEFINER RPCs (`list_open_reports`,
`resolve_report`, `list_appeals`), `src/lib/cloud.ts`.

**Plan:**
1. `profiles.is_admin boolean not null default false`; grant it to the owner
   account only (SQL, not UI).
2. `list_open_reports()` / `list_appeals()` RPCs that check the flag and return
   rows; no service-role key in the browser, ever.
3. Admin page: report queue with the item, the reporter's note, the key, and
   one-click "fix / dismiss / retire item".
4. **AI grading link:** an MCP server (or a signed webhook) that lets me review
   queued items read-only — recommend a small private MCP server over an API
   key in the client. Decide before building.
5. Fallback if no admin surface: daily digest email of new reports/appeals.

**Decision needed:** admin page + MCP (recommended) vs email digest only.

### D. Public-publish pass (security + repo hygiene)
**What:** make the project safe to show publicly and to promote.

**Where:** `.gitignore`, `.pa/` (credentials), `backend/app.py`,
`supabase/migrations/`, `README.md`, new `SECURITY.md`, new Credits page.

**Plan:**
1. Secret scan the whole history (`git log -p | rg 'sbp_|service_role|BREVO|xkeysib|password'`),
   rotate the Supabase PAT + Brevo key, and purge any leaked value from history
   (filter-repo/BFG) before the repo is public.
2. Keep `.pa/*_credentials` untracked; add a `.pa/credentials.example`.
3. Decide the public repo shape: public app repo with no ops scripts, or one
   public repo with `.pa/` excluded and documented. **Decision needed.**
4. Flask: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy`, no-store on authenticated responses, body-size limits.
5. Add `SECURITY.md` + a credits page linking the public GitHub repo and the
   YouTube channel (URLs needed from the owner).

### E. Abuse prevention for a public site
**What:** stop spam, coin farming and report flooding.

**Plan:**
- Per-user daily caps already exist for coins; add per-IP and per-user request
  limits on `/api/*` (Flask-Limiter or a Cloudflare rule), plus a signup
  captcha (hCaptcha/Turnstile) if spam appears.
- Rate-limit `question_reports` and `user_appeals` per user per day in SQL.
- Keep RLS owner-only; add a duplicate-report constraint per (user, question).
- Add request-size and JSON-shape validation on every write endpoint.
- Add a simple abuse dashboard (reports/day, appeals/day, signups/day).

### F. Public polish + gamification (not a slot machine)
**What:** the site should feel finished at every size and reward consistency
without encouraging binges.

**Plan:**
- UI audit at 360 / 390 / 414 / 768 / 1280: no horizontal scroll, ≥44 px tap
  targets, readable long stimuli, sticky footer actions.
- Themes: grow to 6–8 palettes with the same ladder pricing; add a preview
  swatch row; keep one-click reset.
- Earn/spend: daily quests (3 questions, 1 flashcard, 1 rush) with small coin
  rewards; streak freeze item; cosmetic-only spending (never gate learning).
- Healthy-use guardrails: after 60 continuous minutes show a break nudge; a
  daily "enough for today" message; arcade cooldown after N rounds; no loss
  streaks or countdown pressure.
- Copy pass: one purpose line per page, details in tooltips/disclosures.

### G. Continuous QA
- Keep every new engine rule unit-tested (rush pattern is the model).
- Add a smoke script for the deployed site (health, question count, practice
  start, reward price parity).
- Re-run `npm run check:questions` after every bank import.

---

## Open decisions (blocking specific items)

| # | Decision | Needed for |
|---|----------|-----------|
| 1 | Admin page + private MCP server, or daily email digest? | C |
| 2 | Public repo shape (single public repo vs split app/ops)? | D |
| 3 | YouTube channel URL + public support email | D, legal pages |
| 4 | Should full-test answers award HDCoins? | economy pass |
| 5 | Do we want captcha on signup from day one? | E |

---

## Older backlog (still open, condensed)

1. **Hide raw bank counts** — sidebar/Question bank/Full test show 6,193 items.
   *Pending (not requested yet).*
2. **Question-bank load time** — 6k items inline in the main chunk; lazy-import
   or paginate. *Pending.*
3. **Assessment/section selection cards** — segmented boxes already exist for
   short lists; domain/difficulty are now multi-select. *Mostly done.*
4. **Trim filler copy** — Dashboard, Full test setup, Account, Rewards.
   *Pending.*
5. **Mobile Bluebook runner** — stacked panes shipped; still verify at 360 px.
   *Partial.*
6. **Coin economy doc** — earn rates, caps and prices in one place, mirrored in
   SQL. Prices are now in sync; the doc and full economy pass are pending.
7. **Blue icon theme** — accent tokens in place; legend fixed. *Partial.*
8. **Legal/final read-through** before public promotion. *Pending.*

---

## Suggested order

1. **D** repo/secret hygiene (blocking anything public) → **E** rate limits.
2. **A** SBQB import (content quality is the biggest user-visible win).
3. **C** admin panel (needed once reports arrive at volume).
4. **B** arcade + **F** polish/gamification (after the foundation is safe).
5. **G** continuous QA alongside everything.

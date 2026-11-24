# HDSAT — test-run handoff

For an agent running a full acceptance pass on the live site. Read this first, then
`CONTEXT.md` (the canonical working notes), `AUDIT.md` (the 2026-10-28 pass) and
`NEXT.md` (work that is deliberately **not** started).

---

## What the product is

An independent Digital SAT / PSAT practice app. React 18 + Vite + TypeScript, hash
routing, static bundle on PythonAnywhere (`https://hdsat.pythonanywhere.com`), Supabase
for auth and cloud sync, Flask only as the static/health server. Guest mode is a
first-class path: no account is required for anything except cloud sync, the
leaderboard and the operator console.

Current content: 7,132 questions (2,626 R&W / 4,506 Math), 1,804 flashcards,
105 resources. The question JSON ships in the bundle so guest mode works offline; cloud
writes go through `SECURITY DEFINER` RPCs and RLS.

Build under test: `index-CQl0yEe1.js` (deployed 2026-10-28), `Arcade-DL84TCnL.js`, service worker `hdsat-v3`.
If you see other hashes, you are on a stale cache — unregister the service worker and
hard-reload before recording anything.

---

## Ground rules (non-negotiable)

1. **Do not guess the admin passcode.** `/admin` is passcode + proof-of-work gate and
   wrong attempts are logged; a handful locks the owner out. Testing the gate is enough.
2. **Do not spend the email budget.** Brevo allows 300/day and the app stops at 280.
   If you need a confirmed account, create it through the Supabase admin API with
   `email_confirm: true` (that is what the 2026-10-28 audit did) — never through signup.
3. **Never print, copy or commit secrets**: `.pa/supabase_service_key`, `.pa/smtp_credentials`,
   `.pa/brevo_credentials`, management tokens. Refer to env var names only.
4. **This is production with real students.** No migrations, no bulk deletes, no
   `delete_own_account` on anyone but accounts you created. No deploy unless the owner asks.
5. **File defects, don't fix them mid-pass.** Record route, viewport, browser, console
   output, expected vs actual. Fixes are a separate step so the run stays reproducible.
6. **Stay out of these areas** — they are intentionally unfinished: bank growth to 10k,
   Google OAuth, the catalogue database split, the public repo export. A missing feature
   there is not a bug.

---

## Environment facts

- **URLs:** `/#/` dashboard (or `/#/welcome` on a blank browser), `/#/practice`, `/#/test`,
  `/#/bank`, `/#/flashcards`, `/#/arcade`, `/#/resources`, `/#/rewards`, `/#/account`,
  `/#/terms`, `/#/privacy`, `/#/copyright`, `/#/credits`, `/#/admin`.
- **Welcome page** is forced only when the browser has no profile and no session.
  Opening `/#/welcome` deliberately always shows it — that is the Credits link, not a bug.
- **Guest state** lives in `localStorage` under `hdsat.profile.v1`. Use a fresh incognito
  profile for guest tests so you start genuinely blank.
- **Light accounts:** signing up yields a usable session before the code is entered.
  Progress, coins, streaks, flashcards and scores sync; the two per-answer ledgers are
  trimmed in Postgres. A confirm strip never appears inside the timed runner.
- **Email:** confirmation and recovery links are valid 12 hours, one address per day.
  Codes are 6 digits. Do not rely on receiving mail during a pass.
- **Coins:** duplicate-resistant in both guest and cloud. Answering the same item twice
  does not pay twice; a full test pays by score band; games pay a lower-biased random
  amount in the 5–50 range. Two identical sessions should not produce identical totals.
- **Practice can legitimately be shorter than requested.** Unseen items first, then only
  items whose review date has arrived; the config line reports `N ready · M due for review`.
  This is scheduling, not a truncation bug.
- **Full test** is strict fresh-item until the unseen pool runs out; the coverage notice
  says so. Save & exit writes a resumable attempt; Delete keeps one compact score row.
- **Arcade:** Desmos Lab, Equation Sprint (Math only — a reading passage here would be a
  regression), Transition Match, Vocab Precision, Coordinate Interceptor, Practice Rush.
  On touch devices all of them must accept simultaneous touches (movement + jump).
- **Service worker** caches the shell. When comparing against a fresh build, clear it;
  otherwise an old bundle looks like a broken deploy.

---

## What "full pass" should cover

| Area | What to prove |
| --- | --- |
| First visit | Blank browser lands on `/#/welcome`; one click enters the app and does not return on reload |
| Guest | 10-item practice graded locally; coins and streak persist across reload; no cloud calls |
| Sign-in | Account modal, sign in, header state, sign out, sign back in |
| Practice | Custom length options 5/10/15/22/27 and a typed custom number; R&W and Math SPR grading; timer; early end summary |
| Full test | Launch, module timer, cross-out, calculator/reference sheet, Save & exit, resume with answer and timer intact, complete and score report, delete |
| Flashcards | Random order, reveal, grade, queue counts, SM-2 intervals move |
| Question bank | Search/filter, item preview, check answer, source/licence line, report form submission |
| Arcade | Each room starts, scores, pays coins; Equation Sprint contains no R&W item; multitouch on the vault game |
| Rewards | Balance, achievements (+ indicator meaning: extra coins on claim), theme store, earning rules |
| Account | Display name, preferences, export, delete-account confirmation (only on your own throwaway) |
| Admin | Gate renders, no data before unlock; do not attempt to pass it |
| Mobile | 390×844 everywhere; no horizontal overflow; nothing wrapping into unreadable lines |
| Dark mode | Switch tabs/routes with dark forced — no white flash at any point, including reload |
| Offline | Practice and flashcards load from cache; cloud-only surfaces degrade with a message, not a crash |

Record console errors and failed network requests for every flow. A redirect that
"looks like it worked" is not a completed sign-in test — confirm the session in the UI.

---

## Known baseline, so you don't re-report it

- `mark_email_verified()` accepts any signed-in caller, so the light-account cap is a
  soft gate. Known, deferred to the OAuth work. Low severity: storage only.
- The admin console beyond the gate was not re-driven on 2026-10-28.
- The Supabase management token returns 401, so the security script and hosted auth-config
  read could not run. This is an access problem, not a site defect.
- The Google "unsafe app" screen does not exist yet because OAuth is not implemented.

## Commands

```bash
npm ci
npm run dev            # local preview
npm run typecheck      # tsc --noEmit
npm test               # Vitest — 37 files, 354 tests as of 2026-10-29
npm run build          # tsc + vite build
python -m pytest backend/test_app.py   # 22 tests
python tools/admin_triage.py digest    # operator queue, needs local service key
```

Deploy is `.venv/Scripts/python .pa/deploy.py` and is **not** part of a test run; the
2026-10-28 follow-up was deployed with the owner's explicit authorization.

## Reporting

Group findings by severity: breaks a flow / wrong output / cosmetic. For content, quote
the question id (`M-ALE-123`) and what is wrong with the stem, choices, key, rationale or
difficulty label — those go into the operator queue, not into a live edit. End with a
short "what I could not test and why" so the owner knows the coverage boundary.

# Next Week — Saved Goals

Saved: 2026-11-07
Status: **Saved only. Do not start any item yet.** One item per day, perfected one at a time.

The separate `HDSAT_Upgrade_4Phase_LooseFollow.md` file is the supplied four-phase security/backend prompt, saved verbatim as reference. We will follow it **loosely**: no UI revamp from Phase 1 — only its UI rules are to be incorporated — with the real focus on the backend Phases 2–4 strategy.

## Working agreement

- Do one item per day, in the order below. Do not start the next item until the current one is verified.
- Use the owner's loop: **check → verify → implement → verify → report**.
- The live site (`https://hdsat.pythonanywhere.com`) is the source of truth.
- No UI revamp. Preserve the existing design; keep the current UI intact.
- Never guess or ask for the admin passcode in chat.
- No deploy unless the owner explicitly asks.
- Keep both test suites green: Vitest and pytest.
- Change one focused thing at a time. If a baseline test breaks, revert that item before continuing.
- "Perfect" means verified behavior and no regressions, not merely a successful build.

## Day 1 — Chromebook dark-mode white flash

- Deepest browser/compositing issue. Requires a separate, careful pass.
- It appears only on Chromebooks, so the cause must be found and fixed without being able to reproduce it locally on this machine.
- The owner can check manually on the Chromebook.
- **Critical constraint:** do not interfere with unrelated aspects of the site. A fix that risks another surface is not acceptable.
- Goal: eliminate the white flash on dark-mode page load/navigation without changing the visual design elsewhere.

## Day 2 — Longest-answer cheating + genuinely random similar questions

This is a content/audit item with real correctness risk.

- Audit English questions where the longest answer is too often the correct one, and remove that exploitable pattern safely.
- Build a safe review plan before editing any answer text.
- The previous "similar questions" problem must not return.
- The owner wants **truly random depending on what we selected** — first explain the intended meaning from the prior context, then start only after that is confirmed.
- Working interpretation to confirm: when a student selects a section/domain/skill/difficulty (and any filters), the next question must be drawn from the matching eligible pool independently, not from a cached/sequential/deterministic "similar" chain. Selection must be fresh per draw, use the chosen filters, avoid immediate repeats, and must not quietly substitute a different domain/difficulty just because a particular sub-pool is small.
- Verify that repeated draws do not cluster on one family, that the same filters always constrain the pool, and that "random" does not mean pulling an unrelated question marked as similar.

## Day 3 — Full question-bank accuracy, difficulty, and domain audit

The largest and riskiest item.

- Audit the whole bank for answer correctness, difficulty labeling, domain/skill labeling, and question-type accuracy.
- Perfect this without breaking anything else.
- Afterwards, verify against a real College Board full test: question types should be accurate, and Practice and Full Test should have strong variety and match SAT expectations.
- Include a regression sweep and bank-integrity checks.

## Day 4 — Google OAuth

High priority, but a focused browser/credential session.

- The owner will watch while the browser work is done.
- Walk through the full Google Cloud Console setup and the Google OAuth verification process end to end, using the browser.
- No credentials in chat. Put values only where the project's secret configuration expects them.
- Finish with a complete sign-in → callback → session → sign-out test and the required consent/verification state.

## Day 5 — AI coach

- Add just a button that summarizes, so more people can use it.
- If the single API AI quota is exhausted for the day, automatically use the advanced algorithmic fallback.
- The fallback must visibly mention that it is the algorithmic fallback (not pretend to be the API model).
- Keep it server-side; no API key in the browser.

## Day 6 — GitHub revamp (stripped public/open-source edition)

Do this last, after the other feature work.

- Fully stripped, perfect public version.
- No owner API key, obviously.
- The AI coach in this edition is the fake **algorithmic analyzing option** in offline mode only.
- All other databases are removed.
- Contains only 1,000 mixed sample questions (or the agreed mixed sample), not the full production bank.
- Apply the same removal discipline to every other non-public data source/feature.
- Perfect it before publishing.

## Day 7 — Full backend security perfection

- Verify and implement the backend security work from the four-phase prompt, focused on Phases 2–4.
- Use the supplied prompt loosely; incorporate its Phase 1 UI rules only, never its UI revamp.
- End with the prompt's definition of done: every item has a report block, every phase gate passes, both test suites are green, and any owner-only blockers are presented in one clear list.

## After the week

1. **PythonAnywhere one-month reload web scraper** — keep the live deployment refreshed.
2. **Backup database** — a second database for backup/fallback for extra users.
   - Not in GitHub.
   - Connected to the site as a fallback.

Then continue with more implementation ideas and fixes in between.

## Explicitly not started

Nothing in this file has been started. No Chromebook change, question audit, OAuth, AI coach, GitHub rewrite, security phase, scraper, or backup database work is in progress as part of saving this plan.

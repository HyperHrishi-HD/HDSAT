# Acceptance audit — 2026-10-28

Owner asked for a full physical, visual and logical pass over the live site,
including a real account created, used, and deleted, plus guest and admin
checks. This is the record of what was exercised, what was found, and what was
left open on purpose.

**Environment:** production, `https://hdsat.pythonanywhere.com`, build
`index-Dm8wW9Be.js` / `Arcade-B-gWUKzI.js`, dark system theme, 1280×900 and
390×844 viewports.

---

## Test account

Created with the Supabase admin API and a confirmed address so **no
confirmation email was spent** from the 300/day budget:
`audit.20261028.1793148703@example.com` (display name "Audit Student", later
"Audit Student QA"). Password was a one-off QA string, never reused.

Exercised end to end:

| Flow | Result |
| --- | --- |
| Sign in from the Account modal | Passed; header shows the account and 0 coins |
| Light-account strip | Shown correctly; progress syncs, answer detail stays local |
| Practice, 10-item custom session | 2 answers (R&W + Math SPR), both graded correctly; +9 HDCoins; early end shows 2/10 and 100% accuracy |
| Cloud sync of practice | `user_stats` 9 coins / 2 attempts / 2 correct, `daily_activity` 2 questions, 2 compact `question_attempts` rows |
| Full test launch | Bluebook runner, 31:56 R&W module timer, 27 questions |
| Full test save & exit | Dialog, "1 saved to your account", Past simulations shows In progress with Resume and Delete |
| Full test resume (guest copy) | Resumes the module with the saved timer; a selected answer comes back as `is-selected` |
| Flashcards | Reveal → definition → Good; queue 1,652 left / 1 in progress; +1 coin |
| Question Bank | Question preview, Check answer, source/licence line, report form |
| Report a question | Submitted "other" with details; appeared in the operator queue with masked email, then deleted as QA cleanup (queue back to 0) |
| Arcade – Equation Sprint | Found the mixed-section defect below; scoring and Desmos panel work |
| Rewards | Coins, 1/31 achievements, theme store prices, earning rules |
| Account | Display-name change synced to header; preferences; export/delete sections |
| Sign out / sign in | Guest data and account data kept separate; signing back in restores 10 coins and the new display name |
| Delete account | Typed DELETE, confirmed; auth user 404 and `user_stats`, `question_attempts`, `test_attempts`, `daily_activity` all empty |
| Guest pages | Dashboard/welcome, Practice, Flashcards, Arcade, Rewards, Resources, Account all load; guest practice grades and stores LOCAL coins (7) |
| Admin console | `/admin` gate renders passcode + human check; no data leaks before unlocking |
| Mobile layout | All 12 routes measured at 415 px layout width with no horizontal overflow |

---

## Findings

### 1. Equation Sprint could serve Reading & Writing items (fixed)

`buildSprintPool` filtered only for multiple-choice, four options and no
figure, so the math sprint could show a reading comprehension passage. The
pool now requires `section === 'Math'`, the menu copy says "Speed-solve Math
items", and `src/lib/sprintPool.test.ts` fails if any pooled item is not Math
or has anything other than one correct option.

### 2. Light-account cap is a soft gate (open, low severity)

`mark_email_verified()` accepts a call from any signed-in user and does not
check that the emailed code was entered. A determined student could lift their
own light-account limit from the browser console. The cap is not a paid
feature and abuse only costs the owner storage, but it is not proof of address
ownership. Proper fix: only mark verified when the session came from
`verifyOtp` (JWT `amr`) or move the mark behind a server route that performs
the exchange. Deferred because it needs a migration and a live auth test; it
should land with Google OAuth, where the same function will mark OAuth
accounts.

### 3. Checks that could not be repeated

- **Admin console beyond the gate:** the operator passcode is a bcrypt hash
  held only by the owner, so the console itself was not unlocked. The gate,
  RPC authorization and the earlier full-console passes stand; this audit did
  not re-drive the tables.
- **Live auth config:** the management token returns 401, so the 12-hour link
  and one-per-day settings were verified in code and template copy, not by
  reading the hosted auth configuration.
- **Security audit script:** same 401; last green run 2026-10-25, no policy
  change since.

### 4. No content defects found in this pass

The bank has no empty quotation pairs, no duplicate ids or choices, exactly one
zero in every factored-polynomial item, and the deep audit of slope, percent,
inequality, vertex, right-triangle, per-unit-rate and x-intercept families
reports zero findings. The 84 repaired rationales are live and the database is
in sync.

---

## Verification run

- `npx tsc --noEmit` — clean
- `npx vitest run` — 37 files, 353 tests passing
- `python -m pytest backend/test_app.py` — 22 passing
- `npm run build` — clean
- Deploy — health 200, new asset hashes served, service worker `hdsat-v3`
- QA report deleted; operator queue 0 open reports / 0 appeals

Deferred work is written down in `NEXT.md`: bank growth to 10k with English
parity and real sources, Google OAuth, the catalogue database split, and the
limited public export. None of it was started here.

---

## Follow-up pass — second test run (2026-10-29)

A second agent's pass reported a coin/achievement mismatch, an unreachable
operator-reply loop, and a set of smaller UI defects. Each was checked against
the code and the live site before changing anything.

### Fixed

- **The cloud achievement banner promised coins the balance never showed.** The
  banner came from the local guest profile's evaluation, while the visible
  balance came from the cloud snapshot, so a badge earned locally (or earned
  earlier in the account) could announce `+25` with no change in the balance.
  Cloud mode now announces only achievements that appear in a fresh snapshot
  diff — the server's own record that it granted and paid them. Guest mode keeps
  its local banner, where the bonus really does land in the same profile.
- **An existing badge could never pay its reward.**
  `grant_achievement_with_reward` paid only when its achievement insert was new.
  The reward insert is now unconditional and guarded by its idempotency key, and
  `supabase/migrations/20261105000100_achievement_reward_repair.sql` backfills
  every legacy badge. The management token is still 401, so that migration is
  checked in but not applied; the live ledger was checked and has no earned
  badge without its reward today, and every new grant pays.
- **Practice summary read `Correct 1 / 5` beside `Accuracy 100%`.** The accuracy
  is of what was answered, which is right, but the label never said so. It now
  reads `1 of 5 answered` under Correct and `of 1 answered` under Accuracy, and
  a new "Items to review" block lists each missed item with the student's answer
  and the key.
- **Coordinate Interceptor paid below its stated threshold.** The end-of-run
  call padded the item count to `max(3, shots, hits)`, so a one- or two-hit run
  still looked like a three-item session. The reward now requires three actual
  interceptions, and the submitted counts are the real shots and hits. The
  status line also says `firing linear` / `firing quadratic` so it no longer
  reads as a contradiction of the wave-kind badge.
- **Operator replies had no permanent home.** A reply was only visible once as a
  Dashboard card before being marked seen. `Your question reports` now shows the
  report's status and the written reply, matched by the notification's report
  reference, so a student can find an answer later.
- **Days-to-test was one high.** A 23:59:59 target with `Math.ceil` made 39
  calendar days read as 40. `daysUntilDate` compares local date parts instead.
- **Simulation and missed-item dates were UTC.** The Dashboard and Missed Log
  now use the local calendar date, as do shared score links and the data export.
- **The confirm-code countdown said 24 hours.** The mailer's code expires at 12
  hours (`mailer_otp_exp: 43200`); the pending record still lives 24 hours so
  the one-message-per-day allowance survives, and the UI counts down the code
  window only.
- **`unique_100` normalised to the wrong badge.** A legacy Centurion row mapped
  to Grinder; it now maps to Wide Net (`distinct-100`).

### Not reproduced (no change made)

- **Interceptor accuracy counted targets, not shots.** The formula is already
  `hits / shots`, and every fire — hit or miss — increments `shots`.
- **Rush summary clock off by two seconds.** The summary shows elapsed seconds
  and the countdown shows `duration - elapsed`; the only way they differ is a
  run that ended early because the pool ran dry, which is the real elapsed time.

### Fixed in the follow-up (deployed 2026-10-28)

- **Browse All stayed on the same card.** The advance expression was
  `(i + 1 >= length - 1 ? 0 : i)`, which never incremented, so grading a card in
  Browse All left the browser on it. It now steps to the next card and wraps, a
  Shuffle button draws a fresh Fisher-Yates order, and the queue explains that
  Browse All walks the deck one card at a time.
- **The `#/bank?saved=1` link could open with the switch off.** The toggle only
  read the query at mount and there was no state for an empty saved list. It now
  follows the query, says "No saved questions yet" instead of "No matching
  questions", and offers Show all questions.
- **Show all left `?saved=1` in the address bar.** Turn the switch off and a
  refresh put the empty saved view straight back. Manual changes now rewrite the
  query (`?saved=1` on, nothing off), so a reload or a copied link matches the
  list on screen.
- **Rewards quoted an economy that no longer exists.** The earning rules said
  "Full adaptive simulation: +25" and "Achievements: +5 to +40", while the
  simulation pays up to 25 by length and accuracy, arcade runs pay 5–50, and the
  achievement ladder reaches 500. The rules, the badge amounts and the note that
  coins are paid automatically now match the code.
- **A dark-mode installed app opened on a white splash.** The web manifest's
  `background_color` was the light canvas. It is now the dark canvas.
- **A phone info popover could sit over the tab bar.** On screens up to 900 px
  the popover is pinned above the tab bar, inset to the screen, and scrolls
  within its own box; the tabs stay tappable.

### Verification — deployed second pass

- `npx tsc --noEmit` clean, `npx vitest run` 37 files / 354 tests passing,
  `npm run build` clean, deploy health 200, live `index-B5rUFeQT.js`.
- Live coin path with a throwaway confirmed account: the first correct answer
  announced `First Steps (+5 HDCoins)`, the header moved to 7 (1 attempt + 1
  correct + 5 bonus), and Rewards showed the same balance and badge.
- Live report loop with a second throwaway account: report filed, operator reply
  and `in review` status shown under `Your question reports`.
- Both accounts deleted through the UI; auth 404 and every table empty,
  including the QA report and notification.

### Verification — follow-up

- `npx tsc --noEmit` clean, `npx vitest run` 37 files / **354** tests passing,
  `python -m pytest backend/test_app.py` 22 passing, `npm run build` clean.
- Local browser checks at 390×844 and desktop: `#/bank?saved=1` → Saved only
  checked with the no-saved empty state, Show all → 7,132 items and 60 rows;
  Flashcards Browse All → queue note, Shuffle, grade advances Resilient →
  Sagacity; Rewards rules expand to the corrected economy; full-test Blueprint
  popover clears the mobile tab bar by 9 px and the tab remains clickable.
- Deploy 2026-10-28 (owner-authorized): 101 files uploaded, webapp reloaded,
  health 200. Production now serves `index-CQl0yEe1.js` and the dark manifest
  background `#0f1216`.
- Live production re-check in a fresh browser: `#/bank?saved=1` shows the
  no-saved state, Show all restores the 7,132-item list and drops the query from
  the URL, and a reload keeps the full list; Flashcards Browse
  All shows the queue note, and grading Bloviate advances to Card 2 (Apposite)
  with In Progress at 1; Rewards rules expand to 5–50 arcade, up to 25
  simulation and +5 to +500 achievements; at 390×844 the Blueprint popover ends
  at y=774 above the tab bar at y=783, and the Bank tab navigates while it is
  open.
- The achievement reward repair migration could not be applied: the stored
  Supabase management token returns 401 ("Invalid access token"). The client
  half is live; applying
  `supabase/migrations/20261105000100_achievement_reward_repair.sql` with a
  fresh PAT, or in the dashboard SQL editor, is the remaining server step.

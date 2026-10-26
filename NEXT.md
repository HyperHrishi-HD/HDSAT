# NEXT — deferred work, planned but not started

Owner asked (2026-10-25) to save these four items here instead of starting them.
Each one has a plan precise enough to execute without re-deciding the shape.

---

## 4. Question bank growth with English parity (target 10k)

**Where we are.** 7,132 questions, 1,804 flashcards, 18 resources. The bank is
heavier on Math: the Math side is a drill bank built from 248 templates.

**Goal.** 10,000 licensed items with Reading & Writing at roughly 50% of the
total, and no template family that can fill a whole practice run.

**How, without generating content:**

1. Pull only public, redistributable sets — OpenStax, Project Gutenberg
   (public-domain passages), Wikipedia/Wikisource (CC BY-SA, attributed), MIT
   OpenCourseWare and other CC-licensed course material, and the publicly
   released College Board *sample* items that carry an explicit reuse licence.
   This is what the existing `supabase/import/data/m*` pipeline already expects:
   a JSON file per batch, `source_id` + `license` + `license_url` per item.
2. Every new item goes through `python tools/content_qa.py` and
   `python supabase/import/import_questions.py --check` before it is merged.
   Both already fail on missing licence, missing attribution, duplicate stems
   and family collisions.
3. Diversity budget per batch: no more than 6% of new items from one skill, and
   at least 40% R&W. The family cooldown (`FAMILY_COOLDOWN_DAYS = 21`) already
   stops near-duplicates from recurring inside three weeks.
4. Is 10k enough for a heavy user for a year? A heavy student answers ~6,000
   items a year (100/week). With family-unique pools and a 21-day cooldown, 10k
   is about 18 months of unseen material, and the cooldown makes repeats rare
   rather than impossible. 10k is the right stopping point; more is a cost, not
   a need.
5. **Compact cloud-save format** (the other half of this item): drop per-attempt
   `response` text for everyone, roll `daily_activity` into monthly buckets after
   a year, and purge `test_responses` older than 12 months. Needs an export that
   stays whole — do not start it without that migration plan.

---

## 5. Google OAuth

**Why it matters.** It removes the confirmation email from the signup path
entirely, which is the real fix for the 300/day Brevo ceiling.

**The "unsafe app" screen.** Google shows it when an app is unverified and asks
for sensitive scopes. The app only needs `openid email profile` — none of those
are sensitive, so the warning is the generic "unverified app" one, not a scope
warning. It disappears after Google's verification (brand verification for the
domain in `emailRedirectTo`). Until then it is one "Advanced → continue" click.

**What I need to do it as the owner (browser work):**

1. Google Cloud Console → new project → **OAuth consent screen**: External,
   app name HDSAT, support email, developer email; scopes `openid`, `email`,
   `profile`; publish.
2. Credentials → **OAuth client ID** → Web application. Authorised redirect URI
   is exactly `https://qijfmwjcaminecxmbtcf.supabase.co/auth/v1/callback`
   (plus the same for any preview origin).
3. Supabase → Authentication → Providers → Google: paste client ID + secret,
   enable.
4. Supabase → Authentication → URL configuration: add the site origin and
   `/#/account` to the redirect allow-list.
5. Add a "Continue with Google" button to `AuthModal` calling
   `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
   The existing `consumeAuthRedirect()` in `main.tsx` already handles the PKCE
   return, so no new callback page is needed.
6. Test: new Google account → lands signed in and **verified** (Google asserts
   the address), a returning account, and a cancelled consent screen.

---

## 6. A second database for non-user data

**Shape the owner asked for:** Supabase holds users only; a larger, separate
database holds the question bank and the public catalogues.

**Constraint that decides the design:** the timed runner and the arcade read
questions on every question change, and RLS-protected answer keys must never be
in the same database as a client-readable table unless the keys stay behind
definer functions. Two databases means the grading RPC can no longer join
`questions` + `question_keys` in one transaction.

**Safe plan (do it in this order):**

1. Keep `question_keys` (and grading) in Supabase. It is the trust boundary; do
   not split it from the user data it protects.
2. Move only the **read-only** catalogue — `questions`, `flashcards`,
   `dataset_sources`, `resources` — to the second database, behind a build-time
   export: the app already bundles a `questionBank.json` snapshot, so the
   second database can be the *source* of that snapshot rather than a live
   dependency of the browser.
3. Add `tools/export_catalogue.py` that dumps the second database to
   `src/data/questionBank.json` + `flashcards.json` + `resources.json` with a
   content hash. The app ships the hash; `buildTestPlan` refuses a plan whose
   hash is missing from the bundle.
4. Keep a nightly verification job (GitHub Actions, already present for the PA
   refresh) that compares row counts and hashes between the two databases and
   fails loudly on drift.
5. Only after that is stable for a full release cycle, consider making the
   second database the live read path with a signed, cached HTTP API.

**Do not** point the browser at two databases directly: two session models, two
CORS surfaces and two places for an answer key to leak.

---

## 0–3 status (done and re-verified 2026-10-25)

- **PWA + mobile/desktop hardening** — done: manifest, service worker, icon
  set, safe-area insets, iOS input zoom, touch targets, the 900px Arcade door
  fix. Verified live: SW registers and precaches the shell + hashed assets
  (`hdsat-v1-shell`, `hdsat-v1-assets`), manifest served as
  `application/manifest+json`, every route clean at 357px and 390px with no
  horizontal overflow. Fixes this round: portrait full screen is no longer a
  dead end ("Play in portrait"), the Table Talk card stops being pushed off a
  landscape phone's screen, credit URLs wrap instead of widening the page, and
  small buttons get a 36px tap height on coarse pointers.
- **Email ceiling** — done: a refused send is parked in `emailQueue` and sent on
  the next open after the UTC reset (confirmation and recovery both); the queue
  is TTL'd, capped at 5 addresses, one attempt per address per UTC day, and at
  most two flushes per app open. Now covered by a test that the reminder strip
  triggers the flush on mount.
- **Security pass** — done: `tools/security_audit.py` (36 checks, green against
  the live project) plus `20261103000100_security_hardening.sql` applied: whole-row
  UPDATE revoked from `profiles` and `user_question_progress`, and
  `complete_activity_session` now clamps a claimed score to the attempts the
  server actually graded.
- **Open-source repo** — prepared, not executed: `tools/export_open_source.py
  --verify` builds the sanitised tree (127 files, 1,000 stratified questions,
  300 cards, no `.pa`/`supabase`/`backend`/admin console, `isCloudConfigured`
  stubbed to false) and typechecks it clean. The history purge stays a
  deliberate, separate action — runbook in that script's docstring; rotate any
  secret that was ever committed first.

## What is left before launch

1. Finish the player-side review of the three arcade rooms on a real phone
   (owner). Everything on the code side is green.
2. Item 4 in halves: bank growth to 10k first, compact cloud-save second. The
   save-format change needs its own migration and an export that stays whole.
3. Item 5 (Google OAuth) needs the owner's browser session in Google Cloud
   Console and Supabase; the code side is a button plus one redirect entry.
4. Item 3 execution: `git init` on the exported tree, single commit, push to the
   new public repo, then rewrite history here. Only when the site is final.
5. Item 6 last: catalogue export first, live second database later.

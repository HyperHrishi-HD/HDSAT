# NEXT — saved, not started

Owner asked on 2026-10-28 to write these down and **not** begin them yet.
The audit and polish pass for today is tracked separately (see `AUDIT.md`).

Status of the four items: **not started**. Nothing here is in the live build,
and none of it goes into the public GitHub export.

---

## 1. Question bank growth with English parity, then the compact cloud-save format

**Where we are.** 7,132 questions (2,626 R&W / 4,506 Math), 1,804 flashcards,
105 resources. Math is a drill bank built from templates; R&W is the side that
needs real material.

**Goal.** 10,000 items with Reading & Writing near 50% of the total, real
public-domain or openly licensed sources only, **strictly no generated
passages**, each item with an honest difficulty label.

**Source rules.**
- Public-domain or redistributable only: OpenStax, Project Gutenberg,
  Wikisource/Wikipedia (CC BY-SA, attributed), MIT OpenCourseWare, and College
  Board items only where reuse is explicitly permitted.
- Every item carries `source_id`, `license`, `license_url`, attribution.
- No synthetic stems, no template churn disguised as new items.

**Pipeline.**
1. One JSON batch per source under `supabase/import/data/m*`, same shape the
   importer already expects.
2. `python tools/content_qa.py` and
   `python supabase/import/import_questions.py --check` must pass before merge.
3. Diversity budget per batch: at most 6% from one skill, at least 40% R&W, no
   family collision with the existing bank.
4. Difficulty relabelled per item against the same rubric used now (one-step
   Math is never Hard); `bank-integrity.test.ts` already enforces the floor.
5. Re-sync `questions` + `question_keys` with `tools/sync_live_bank.py --apply`
   and verify zero differences.

**Is 10k enough for a heavy user for a year?** A heavy student answers roughly
6,000 items a year (100–120 a week). With family-unique pools and the 21-day
family cooldown, 10k gives about 18 months of unseen material before repeats
become routine; that is the right stopping point. Going past 10k adds hosting
and review cost, not value.

**Second half — compact cloud saves.** Drop per-attempt `response` text for
everyone, roll `daily_activity` into monthly buckets after a year, purge
`test_responses` older than 12 months. Needs its own migration **and** an
export that stays whole before any data is dropped. Do this only after the
bank growth ships.

---

## 2. Google OAuth — after the polish passes

**Why.** It removes the confirmation email from the signup path entirely,
which is the real fix for the 300/day Brevo ceiling.

**The "unsafe app" screen.** Google shows it when an app is unverified; the
scopes needed are only `openid email profile`, none of which are sensitive, so
the warning is the generic unverified-app one and disappears after Google's
brand verification of the domain. Until then it is one "Advanced → continue"
click.

**Owner asked me to do it in the Freebuff browser with their logged-in Google
and Supabase sessions. I can do that when the browser is available; the steps
below are what I will execute as them.**

1. Google Cloud Console → new project → **OAuth consent screen**: External,
   app name HDSAT, support email, developer email; scopes `openid`, `email`,
   `profile`; publish.
2. Credentials → **OAuth client ID** → Web application. Authorised redirect URI
   exactly `https://qijfmwjcaminecxmbtcf.supabase.co/auth/v1/callback`, plus
   the preview origin if one is used.
3. Supabase → Authentication → Providers → Google: paste client ID + secret,
   enable.
4. Supabase → Authentication → URL configuration: add the site origin and
   `/#/account` to the redirect allow-list.
5. App: add "Continue with Google" to `AuthModal` calling
   `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
   `consumeAuthRedirect()` in `main.tsx` already handles the PKCE return, so no
   new callback page is needed.
6. Test: new Google account lands signed in and verified; returning account;
   cancelled consent screen.

Needs from the owner: the browser session on Google Cloud Console and the
Supabase project, plus a brand/support email if Google asks during verification.

---

## 3. A second database for the catalogue, keeping Supabase for users

**Owner's direction (2026-10-28):** reverse the earlier split. Supabase holds
**only accounts and student history**. A second, larger and more locked-down
database holds `questions`, `question_keys`, `flashcards`, `dataset_sources`
and `resources`. It has to sync flawlessly and be tested before it is trusted.

**Constraint that decides the design.** The timed runner and the arcade read
questions on every question change, and RLS-protected answer keys must never be
client-readable. Two databases means the grading RPC can no longer join
`questions` + `question_keys` in one transaction.

**Safe plan (in this order).**
1. Keep grading in Supabase for now. It is the trust boundary.
2. Add `tools/export_catalogue.py`: dump the catalogue to
   `src/data/questionBank.json` + `flashcards.json` + `resources.json` with a
   content hash, and ship that hash with the app.
3. Make the second database the **source** of that export, not a live
   dependency of the browser: build-time snapshot, same bundle path students
   already use.
4. Nightly verification for a full release cycle comparing row counts and
   hashes between the export and both databases; fail loudly on drift.
5. Only after a release cycle: make the second database the live read path
   behind a signed, cached HTTP API. Never point the browser at two databases
   directly — two session models, two CORS surfaces, two places for a key to
   leak.

**Non-negotiables.** Answer grading stays server-side, the student never
receives a key it was not entitled to, and a database failure degrades to the
bundled snapshot rather than a blank practice screen.

---

## 4. Public repository export (one commit) — deliberately limited

The public repo (`HyperHrishi-HD/HDSAT-standalone`) is finished and purged. It
stays at the 1,000-question sample: **no 10k bank, no OAuth, no second
database, no admin console, no deployment notes** go into it.

**What goes in.** Only small, self-contained features that make the sample feel
like the real product (visual/theme polish, the arcade rooms that do not depend
on the private data, account copy that never names a provider). No files from
`.pa`, `supabase`, `backend`, `tools` deployment helpers, or this audit.

**Steps when the owner says go.**
1. Run `tools/export_open_source.py`, then `--verify` (typecheck + build of the
   exported tree) and the leak scan (project ref, host, service key, env vars).
2. Inspect the resulting tree by hand; diff against the previous public commit
   to confirm the question count is still 1,000.
3. `git init` in the exported tree, one commit, push to the public repo.
4. Only then rewrite history here if the owner still wants that. Nothing is
   pushed from this repository.

**Hard rule.** Everything built in items 1–3 and today's audit stays out of
GitHub until the owner explicitly changes this plan.

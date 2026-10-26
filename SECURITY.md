# Security Policy

## Reporting a Vulnerability or Content Issue

HDSAT takes student privacy, account security, and content accuracy seriously.

- **In-App Safety & Security Appeals:** You can report security concerns, account access issues, or content problems directly through the in-app **Appeals & Safety Reports** form at `/#/account` or `/#/terms` (no account required).
- **Question Accuracy Reports:** Every question card includes a **Report a problem** button that logs the exact question ID for operator triage.
- **GitHub Security Advisories:** For code-level security vulnerabilities, please open a private security advisory on [https://github.com/HyperHrishi-HD/HDSAT/security](https://github.com/HyperHrishi-HD/HDSAT/security) rather than a public issue.

## Architecture & Credential Boundaries

- **Row-Level Security (RLS):** Every table in `public` has RLS on. User tables (`profiles`, `user_stats`, `question_attempts`, `user_question_progress`, `saved_questions`, `flashcard_progress`, `daily_activity`, `coin_transactions`, `user_achievements`, `test_attempts`, `test_responses`, `test_score_log`, `user_notifications`) are scoped to `auth.uid() = user_id`; catalogue tables are read-only; the operator, password and rate-limit tables have no client policy at all.
- **No Privileged Browser Keys:** Only the public `VITE_SUPABASE_ANON_KEY` (publishable key) is shipped to the client. Service-role keys, Personal Access Tokens, SMTP credentials, and PythonAnywhere API tokens are strictly excluded from version control via `.gitignore` and never bundled.
- **Self-Serve Data Rights:** Users can export their full JSON study history or permanently delete their account (`delete_own_account` RPC) at any time from the Account page.

## Audit: `python tools/security_audit.py`

The browser holds the publishable key, so every policy, grant and
`SECURITY DEFINER` function is reachable from devtools. The audit reads the live
catalog — not a local copy of the migrations — and fails on:

| Rule | What it proves |
| --- | --- |
| `rls` | every table in `public` has row level security enabled |
| `write-protected` | coins, the score log, stats, the attempt ledger, achievements, flashcards, profiles-adjacent tables, the admin tables and both rate-limit logs have **no** client write policy |
| `read-protected` | `question_keys`, `admin_*`, `password_change_log`, `email_request_log` and `applied_once` cannot be read by a client |
| `open-policy` | no write policy accepts any row; `USING (true)` is allowed only on the public catalogue |
| `anon-write` | a signed-out browser may only insert a report or an appeal, and only as an anonymous row |
| `row-scope` | every UPDATE/DELETE policy is filtered by `auth.uid()` |
| `search_path` | every `SECURITY DEFINER` function pins `search_path` |
| `profile-columns` | the browser may write only `display_name`, `preferred_exam`, `target_test_date`, `updated_at` on its own profile |
| `secrets` | no credential-shaped column exists in `public` |
| `storage` | no storage bucket is public |

It is a read-only check: run it after any migration. The 2026-11-03
`security_hardening` migration is what it was written against, and it passes
36/36 on the live project.

### What the audit found and fixed (2026-11-03)

1. **`profiles` was row-scoped only.** `UPDATE` was granted on the whole row, so
   a signed-in browser could set its own `email_verified_at` — which silently
   removes every light-account storage cap — or write `unlocked_cosmetics`
   without paying. The row policy stays (it scopes the update); the real limit
   is now a column grant of four preference columns. The client-side `INSERT`
   policy is gone: profile rows are created by the definer functions.
2. **`user_question_progress` was writable by clients.** Mastery, correct counts
   and streaks could be rewritten from devtools. The only writer is
   `submit_question_attempt`, which is `SECURITY DEFINER`, so the policy and the
   grant were removed without touching any real flow.
3. **Session rewards trusted the browser.** `complete_activity_session` accepted
   `p_correct_count` as fact. For the three graded modes it is now clamped to
   the attempts the server actually graded in the same window (the clamp only
   ever lowers a count). Mini-games keep their claim, because not every game
   writes a graded attempt; their ceiling is the existing 100-coin reward and
   five rewarded sessions a day.

### Anti-cheat boundary, stated plainly

Grading itself is server-side: `submit_question_attempt` reads `question_keys`
(which no client can select) and calls `check_answer_match`, so a browser cannot
mark an answer correct, mint coins, or unlock an achievement. What a browser
*can* still do is lie in a **session summary** — the mini-game "I got 12 of 12"
used by the reward formula. The daily caps bound that: five mini-game sessions
and 100 coins each. Treat the leaderboard as a practice incentive, not a
competitive ranking with prize value.

## Credential rotation

Rotate these whenever one has been pasted into a chat, a log, a commit or a
screenshot. Rotation is a dashboard action; nothing in the repository changes.

| Credential | Where it lives | Where to rotate |
| --- | --- | --- |
| Supabase personal access token | `.pa/supabase_credentials` | Supabase → Account → Access Tokens |
| Supabase service key | operator machine only (`.pa/`) | Supabase → Project Settings → API |
| Brevo SMTP key | `.pa/smtp_credentials` | Brevo → SMTP & API → SMTP |
| Brevo API key | `.pa/brevo_credentials` | Brevo → SMTP & API → API Keys |
| PythonAnywhere API token | `.pa/pa_credentials` | PythonAnywhere → Account → API token |
| Operator console passcode | Postgres (`set_admin_passcode`) | re-run the RPC with the new passcode |

**2026-11-03 — rotate now.** The Brevo API key was printed into an operator
transcript by mistake (a `sed` mask that did not match the file's JSON shape).
The key itself never reached the bundle, the repository or a browser, but it
must be treated as disclosed: regenerate it in Brevo, update
`.pa/brevo_credentials`, and re-run
`python supabase/email-templates/apply_auth_config.py` if the SMTP key is
rotated at the same time.

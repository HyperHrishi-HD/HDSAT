# Security Policy

## Reporting a Vulnerability or Content Issue

HDSAT takes student privacy, account security, and content accuracy seriously.

- **In-App Safety & Security Appeals:** You can report security concerns, account access issues, or content problems directly through the in-app **Appeals & Safety Reports** form at `/#/account` or `/#/terms` (no account required).
- **Question Accuracy Reports:** Every question card includes a **Report a problem** button that logs the exact question ID for operator triage.
- **GitHub Security Advisories:** For code-level security vulnerabilities, please open a private security advisory on [https://github.com/HyperHrishi-HD/HDSAT/security](https://github.com/HyperHrishi-HD/HDSAT/security) rather than a public issue.

## Architecture & Credential Boundaries

- **Row-Level Security (RLS):** All user tables in Supabase (`profiles`, `user_stats`, `question_attempts`, `user_question_progress`, `saved_questions`, `flashcard_progress`, `daily_activity`, `coin_transactions`, `user_achievements`, `test_attempts`, `test_responses`) enforce strict per-user RLS (`auth.uid() = user_id`).
- **No Privileged Browser Keys:** Only the public `VITE_SUPABASE_ANON_KEY` (publishable key) is shipped to the client. Service-role keys, Personal Access Tokens, SMTP credentials, and PythonAnywhere API tokens are strictly excluded from version control via `.gitignore` and never bundled.
- **Self-Serve Data Rights:** Users can export their full JSON study history or permanently delete their account (`delete_own_account` RPC) at any time from the Account page.

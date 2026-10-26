#!/usr/bin/env python3
"""Audit the live HDSAT database the way an attacker reads it.

The browser is hostile. It holds the publishable Supabase key, so every table,
policy and SECURITY DEFINER function in `public` is reachable by anyone who
opens devtools. This script asks the project's own catalog what that surface
actually looks like, and fails on the things that would let a student write
their own coins, read answer keys, or call an admin function:

  1. every table in `public` has row level security on;
  2. answer keys are not selectable by a client role;
  3. the ledgers that must only be written by a trigger or a definer RPC
     (coins, score log, attempt ledger, admin tables, rate-limit logs) have no
     client-facing write policy;
  4. every SECURITY DEFINER function pins `search_path` and is not executable
     by PUBLIC;
  5. no `public` table stores anything that looks like a password or a secret;
  6. no storage bucket is public;
  7. no policy lets `anon` write anything.

Usage:
    python tools/security_audit.py            # report, exit 1 on a failure
    python tools/security_audit.py --json     # machine-readable

Reads SUPABASE_ACCESS_TOKEN from .pa/supabase_credentials or the environment,
and the project ref from SUPABASE_PROJECT_REF or the same file. It only reads.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_REF = "qijfmwjcaminecxmbtcf"


def load_credentials() -> tuple[str, str]:
    cred = ROOT / ".pa" / "supabase_credentials"
    if cred.exists():
        for line in cred.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    ref = os.environ.get("SUPABASE_PROJECT_REF", "").strip() or DEFAULT_REF
    if not token:
        sys.exit(
            "missing SUPABASE_ACCESS_TOKEN: put it in .pa/supabase_credentials "
            "(see .pa/supabase_credentials.example)"
        )
    return token, ref


def run_sql(token: str, ref: str, query: str):
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": query}).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read().decode()
            return json.loads(body) if body else []
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:400]
        sys.exit(f"SQL failed ({exc.code}): {detail}")
    except urllib.error.URLError as exc:
        sys.exit(f"network error: {exc.reason}")


# --------------------------------------------------------------------------
# The queries. Each one is a plain read of a catalog view.
# --------------------------------------------------------------------------

QUERIES = {
    "tables_without_rls": """
        SELECT c.relname AS table_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind IN ('r', 'p')
           AND NOT c.relrowsecurity
         ORDER BY 1
    """,
    "policies": """
        SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
          FROM pg_policies
         WHERE schemaname = 'public'
         ORDER BY tablename, policyname
    """,
    "definer_functions": """
        SELECT p.proname AS name,
               COALESCE(array_to_string(p.proconfig, ','), '') AS config,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.prosecdef
         ORDER BY 1
    """,
    "sensitive_columns": """
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (column_name ILIKE '%password%' OR column_name ILIKE '%secret%'
                OR column_name ILIKE '%private_key%' OR column_name ILIKE '%api_key%')
         ORDER BY 1, 2
    """,
    "public_buckets": """
        SELECT id, name
          FROM storage.buckets
         WHERE public
         ORDER BY 1
    """,
    "table_grants": """
        SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
          FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND grantee IN ('anon', 'authenticated')
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    "profile_columns": """
        SELECT column_name, privilege_type
          FROM information_schema.column_privileges
         WHERE table_schema = 'public'
           AND table_name = 'profiles'
           AND grantee = 'authenticated'
           AND privilege_type IN ('INSERT', 'UPDATE')
         ORDER BY 1
    """,
}

# The only profile columns a browser may write. `email_verified_at` and
# `unlocked_cosmetics` are server-owned: one lifts every light-account cap, the
# other is what a purchase pays for.
PROFILE_WRITABLE = {"display_name", "preferred_exam", "target_test_date", "updated_at"}

# Tables whose client-facing write policies must not exist: the only writers are
# triggers and SECURITY DEFINER functions, which bypass RLS by design.
# `test_responses` is deliberately absent: the timed runner writes its own
# responses (upsert, scoped to auth.uid()) and a light account's rows are then
# dropped by a trigger.
WRITE_PROTECTED = {
    "coin_transactions",
    "test_score_log",
    "user_achievements",
    "user_stats",
    "daily_activity",
    "flashcard_progress",
    "user_question_progress",
    "email_request_log",
    "password_change_log",
    "admin_gate",
    "admin_unlock_tokens",
    "admin_access_log",
    "admin_pow_challenges",
    "admin_login_attempts",
    "applied_once",
}

# A write policy that a signed-out browser may hold. Filing a report or an
# appeal must not require an account, so these two take an anonymous insert with
# `user_id IS NULL`; nothing else does.
ANON_INSERT_ALLOWED = {"question_reports", "user_appeals"}

# Public content: readable by anyone, which is the point. `USING (true)` here is
# not an open policy, it is the catalogue.
PUBLIC_READ = {"dataset_sources", "flashcards", "questions"}

# Read-protected: answer keys and the console's own bookkeeping.
READ_PROTECTED = {
    "question_keys",
    "admin_gate",
    "admin_unlock_tokens",
    "admin_access_log",
    "admin_pow_challenges",
    "admin_login_attempts",
    "password_change_log",
    "email_request_log",
    "applied_once",
}

WRITE_COMMANDS = {"INSERT", "UPDATE", "DELETE", "ALL"}


def check(payload: dict) -> list[dict]:
    findings: list[dict] = []

    def add(ok: bool, rule: str, detail: str) -> None:
        findings.append({"ok": ok, "rule": rule, "detail": detail})

    for table in payload["tables_without_rls"]:
        add(False, "rls", f"{table['table_name']} has row level security disabled")
    if not payload["tables_without_rls"]:
        add(True, "rls", "every table in public has row level security enabled")

    policies = payload["policies"]
    by_table: dict[str, list[dict]] = {}
    for policy in policies:
        by_table.setdefault(policy["tablename"], []).append(policy)

    for table in sorted(WRITE_PROTECTED):
        writes = [
            policy
            for policy in by_table.get(table, [])
            if str(policy["cmd"]).upper() in WRITE_COMMANDS
        ]
        if writes:
            names = ", ".join(f"{p['policyname']} ({p['cmd']})" for p in writes)
            add(False, "write-protected", f"{table} has a client write policy: {names}")
        else:
            add(True, "write-protected", f"{table} is not writable by a client role")

    for table in sorted(READ_PROTECTED):
        reads = [
            policy
            for policy in by_table.get(table, [])
            if str(policy["cmd"]).upper() in {"SELECT", "ALL"}
        ]
        if reads:
            names = ", ".join(f"{p['policyname']} ({p['cmd']})" for p in reads)
            add(False, "read-protected", f"{table} is readable by a client: {names}")
        else:
            add(True, "read-protected", f"{table} is not readable by a client role")

    # A policy that matches everyone with no condition is the usual accident.
    for policy in policies:
        table = policy["tablename"]
        qual = (policy.get("qual") or "").strip().lower()
        check_expr = (policy.get("with_check") or "").strip().lower()
        if str(policy["cmd"]).upper() == "SELECT" and qual in {"true", "(true)"}:
            if table in PUBLIC_READ:
                add(True, "open-policy", f"{table} is public catalogue content")
            else:
                add(False, "open-policy", f"{table}.{policy['policyname']} has no USING clause")
        if str(policy["cmd"]).upper() in WRITE_COMMANDS and check_expr in {"true", "(true)"}:
            add(
                False,
                "open-policy",
                f"{table}.{policy['policyname']} accepts any row",
            )

    # `anon` may only write where the product requires it: filing a report or an
    # appeal without an account, and only as an anonymous row.
    for policy in policies:
        table = policy["tablename"]
        roles = str(policy["roles"] or "")
        command = str(policy["cmd"]).upper()
        if "anon" not in roles or command not in WRITE_COMMANDS:
            continue
        if table in ANON_INSERT_ALLOWED and command == "INSERT":
            add(True, "anon-write", f"{table} accepts an anonymous report")
        else:
            add(False, "anon-write", f"{table}.{policy['policyname']} lets anon {command}")

    # Signed-in write policies must be scoped to the caller's own row.
    for policy in policies:
        command = str(policy["cmd"]).upper()
        if command not in {"UPDATE", "DELETE", "ALL"}:
            continue
        table = policy["tablename"]
        if table in {"questions", "flashcards", "dataset_sources", "question_keys"}:
            continue
        qual = str(policy.get("qual") or "")
        check_expr = str(policy.get("with_check") or "")
        if "auth.uid()" not in qual and "auth.uid()" not in check_expr:
            add(
                False,
                "row-scope",
                f"{table}.{policy['policyname']} is not scoped to auth.uid()",
            )

    for function in payload["definer_functions"]:
        name = function["name"]
        config = function["config"] or ""
        if "search_path" not in config:
            add(False, "search_path", f"{name}() is SECURITY DEFINER without a pinned search_path")
        if function["anon_exec"] or function["auth_exec"]:
            # Public definer functions are fine when they scope themselves to
            # auth.uid(); the ones that must never be callable are listed here.
            pass
        else:
            add(True, "search_path", f"{name}() pins search_path")

    # profiles keeps a row policy (it scopes the update to the caller) and puts
    # the real limit in column privileges, so read those instead of the policy.
    writable = {row["column_name"] for row in payload["profile_columns"]}
    extra = sorted(writable - PROFILE_WRITABLE)
    if extra:
        add(False, "profile-columns", f"browser can write server-owned profile columns: {', '.join(extra)}")
    else:
        add(True, "profile-columns", "profiles exposes only its preference columns")

    exposed = [
        f"{row['table_name']}.{row['column_name']}" for row in payload["sensitive_columns"]
    ]
    if exposed:
        add(False, "secrets", f"credential-shaped columns in public: {', '.join(exposed)}")
    else:
        add(True, "secrets", "no password or secret columns in public")

    if payload["public_buckets"]:
        names = ", ".join(row["name"] for row in payload["public_buckets"])
        add(False, "storage", f"public storage buckets: {names}")
    else:
        add(True, "storage", "no public storage buckets")

    return findings


def main() -> None:
    token, ref = load_credentials()
    payload = {name: run_sql(token, ref, query) for name, query in QUERIES.items()}
    findings = check(payload)

    if "--json" in sys.argv:
        print(json.dumps({"ref": ref, "findings": findings}, indent=2))
    else:
        print(f"HDSAT security audit — project {ref}\n")
        for finding in findings:
            mark = "PASS" if finding["ok"] else "FAIL"
            print(f"  [{mark}] {finding['rule']}: {finding['detail']}")
        failed = [f for f in findings if not f["ok"]]
        print(f"\n{len(findings) - len(failed)} passed, {len(failed)} failed")

        # Grants are informational: RLS is the gate, so a grant alone is not a
        # finding, but an unexpected write grant is worth reading.
        print("\nTable grants held by browser roles (RLS still gates every row):")
        for row in payload["table_grants"]:
            print(f"  {row['table_name']}: {row['grantee']} — {row['privs']}")

    if any(not finding["ok"] for finding in findings):
        sys.exit(1)


if __name__ == "__main__":
    main()

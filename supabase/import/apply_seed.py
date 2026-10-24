#!/usr/bin/env python3
"""Apply the generated HDSAT seed to Supabase in a handful of requests.

The original apply script posts the whole 15k-line seed first and then falls
back to one statement per API call. That fallback is far too slow for 14k
statements: a run can end after a few dozen rows, leaving the live question
table far behind the bundled bank. This script splits the same idempotent seed
into bounded batches (by statement count and bytes), posts each batch as one
Management API query, and verifies the resulting row counts over PostgREST.

Usage:
    python supabase/import/apply_seed.py --dry-run
    SUPABASE_ACCESS_TOKEN=sbp_... python supabase/import/apply_seed.py

The token may also live in .pa/supabase_credentials as SUPABASE_ACCESS_TOKEN.
Never prints the token. Only the public publishable key is used for checks.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROJECT_REF = "qijfmwjcaminecxmbtcf"
SEED = ROOT / "supabase" / "seed" / "0001_seed_hdsat.sql"
CREDENTIALS = ROOT / ".pa" / "supabase_credentials"

OK = (200, 201, 204)
BATCH_STATEMENTS = 150
BATCH_BYTES = 220_000


def load_token() -> str:
    if CREDENTIALS.exists():
        for line in CREDENTIALS.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token or token.startswith("PASTE_"):
        sys.exit(
            "missing SUPABASE_ACCESS_TOKEN. Create a personal access token at "
            "https://supabase.com/dashboard/account/tokens and put it in "
            ".pa/supabase_credentials as SUPABASE_ACCESS_TOKEN=sbp_..."
        )
    if not token.startswith(("sbp_", "eyJ")):
        sys.exit("SUPABASE_ACCESS_TOKEN does not look like a Supabase personal access token")
    return token


def api(token: str, method: str, path: str, payload=None):
    request = urllib.request.Request(
        f"https://api.supabase.com/v1{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = response.read().decode()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:800]
    except urllib.error.URLError as exc:
        return 0, f"network error: {exc.reason}"


def split_sql(sql: str) -> list[str]:
    """Split a script at top-level semicolons, honouring quotes and comments."""
    statements: list[str] = []
    buf: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            end = n if end == -1 else end
            buf.append(sql[i:end])
            i = end
        elif sql.startswith("/*", i):
            depth, end = 1, i + 2
            while end < n and depth:
                if sql.startswith("/*", end):
                    depth += 1
                    end += 2
                elif sql.startswith("*/", end):
                    depth -= 1
                    end += 2
                else:
                    end += 1
            buf.append(sql[i:end])
            i = end
        elif ch == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if match:
                tag = match.group(0)
                end = sql.find(tag, i + len(tag))
                if end == -1:
                    raise ValueError(f"unterminated dollar quote {tag!r} at offset {i}")
                end += len(tag)
                buf.append(sql[i:end])
                i = end
            else:
                buf.append(ch)
                i += 1
        elif ch == "'":
            end = i + 1
            while end < n:
                if sql[end] == "'":
                    if end + 1 < n and sql[end + 1] == "'":
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            else:
                raise ValueError(f"unterminated string at offset {i}")
            buf.append(sql[i:end])
            i = end
        elif ch == '"':
            end = sql.find('"', i + 1)
            if end == -1:
                raise ValueError(f"unterminated quoted identifier at offset {i}")
            buf.append(sql[i : end + 1])
            i = end + 1
        elif ch == ";":
            statement = "".join(buf).strip()
            if statement and not all(
                line.startswith("--") or not line.strip() for line in statement.splitlines()
            ):
                statements.append(statement)
            buf = []
            i += 1
        else:
            buf.append(ch)
            i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


TABLE_ORDER = ["dataset_sources", "questions", "flashcards", "question_keys"]
INSERT_RE = re.compile(r"INSERT\s+INTO\s+public\.(\w+)", re.IGNORECASE)


def table_of(statement: str) -> str:
    match = INSERT_RE.search(statement)
    return match.group(1).lower() if match else ""


def order_statements(statements: list[str]) -> list[str]:
    """Parents first. A dependent table must never share a batch with its parent:
    a failed batch rolls back every statement in it, which previously lost the
    questions that shared the failing question_keys batch."""
    rank = {name: index for index, name in enumerate(TABLE_ORDER)}
    return sorted(statements, key=lambda statement: rank.get(table_of(statement), len(TABLE_ORDER)))


def batches(statements: list[str]) -> list[list[str]]:
    out: list[list[str]] = []
    current: list[str] = []
    size = 0
    table = None
    for statement in statements:
        length = len(statement) + 2
        statement_table = table_of(statement)
        if current and (
            len(current) >= BATCH_STATEMENTS
            or size + length > BATCH_BYTES
            or statement_table != table
        ):
            out.append(current)
            current, size = [], 0
        current.append(statement)
        table = statement_table
        size += length
    if current:
        out.append(current)
    return out


def sql_count(token: str, table: str) -> int | None:
    """Count as the owner. PostgREST cannot read question_keys (RLS by design)."""
    status, result = api(
        token,
        "POST",
        f"/projects/{PROJECT_REF}/database/query",
        {"query": f"SELECT count(*)::int AS n FROM public.{table}"},
    )
    if status not in OK or not isinstance(result, list) or not result:
        return None
    row = result[0]
    if isinstance(row, dict):
        return int(row.get("n", row.get("count", 0)))
    return int(row[0]) if isinstance(row, list) and row else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show the batch plan only")
    parser.add_argument("--verify-only", action="store_true", help="check live row counts only")
    parser.add_argument(
        "--seed",
        default=str(SEED),
        help="seed file to apply (default: the full generated seed)",
    )
    args = parser.parse_args()

    statements = order_statements(
        [
            statement
            for statement in split_sql(pathlib.Path(args.seed).read_text(encoding="utf-8"))
            if statement.upper() not in {"BEGIN", "COMMIT"}
        ]
    )
    plan = batches(statements)
    inserts = sum(1 for statement in statements if statement.upper().startswith("INSERT INTO"))
    print(f"seed statements: {len(statements)} ({inserts} inserts), batches: {len(plan)}")
    for index, batch in enumerate(plan, 1):
        print(f"  batch {index:02d}: {len(batch)} statements, {sum(len(s) for s in batch):,} bytes")
    if args.dry_run:
        return

    token = load_token()
    if args.verify_only:
        plan = []
    for index, batch in enumerate(plan, 1):
        sql = ";\n".join(batch) + ";"
        status, result = api(
            token, "POST", f"/projects/{PROJECT_REF}/database/query", {"query": sql}
        )
        if status not in OK:
            sys.exit(f"batch {index} failed (HTTP {status}): {result}")
        print(f"  batch {index:02d}/{len(plan)} applied")

    failures = []
    print("live verification:")
    for table in ("questions", "flashcards", "question_keys"):
        minimum = sum(1 for statement in statements if table_of(statement) == table)
        count = sql_count(token, table)
        good = count is not None and count >= minimum
        print(f"  [{'PASS' if good else 'FAIL'}] {table} = {count} (expected at least {minimum})")
        if not good:
            failures.append(table)
    if failures:
        sys.exit(f"seed verification failed: {', '.join(failures)}")
    print("SEED VERIFIED" if args.verify_only else "SEED APPLIED AND VERIFIED")


if __name__ == "__main__":
    main()

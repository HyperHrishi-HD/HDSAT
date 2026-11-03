#!/usr/bin/env python3
"""Retire live question ids that are no longer in the 10,000-item bundle.

The bundle is the catalogue. Older seed batches left 511 ids in Supabase that
the current bundle no longer contains. Deleting those rows is safe only when no
student record points at them; a referenced row is archived instead of being
cascaded away, so no attempt, progress, saved item, test response or report is
lost.

Usage:
    python tools/cleanup_stale_questions.py
    python tools/cleanup_stale_questions.py --apply
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import sync_live_bank as sync  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
REFERENCE_TABLES = (
    "question_attempts",
    "user_question_progress",
    "saved_questions",
    "test_responses",
    "question_reports",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    local = {
        question["id"]
        for question in json.loads(BANK.read_text(encoding="utf-8"))["questions"]
    }
    url, key = sync.credentials()
    client = sync.Client(url, key)
    rows = client.fetch("questions", "id,status", "id")
    extras = sorted(str(row["id"]) for row in rows if str(row["id"]) not in local)
    print(f"bundle: {len(local):,}; live: {len(rows):,}; stale: {len(extras):,}")

    references: dict[str, int] = {}
    for table in REFERENCE_TABLES:
        try:
            records = client.fetch(table, "question_id", "question_id")
        except Exception as error:  # an older deployment may lack one table
            print(f"  {table}: skipped ({str(error)[:120]})")
            continue
        for record in records:
            question_id = str(record.get("question_id") or "")
            if question_id in extras:
                references[question_id] = references.get(question_id, 0) + 1
    referenced = sorted(set(references))
    unused = sorted(set(extras) - set(referenced))
    print(f"  referenced (will archive): {len(referenced)}")
    print(f"  unused (will delete):      {len(unused)}")
    if referenced:
        print("  referenced ids: " + ", ".join(referenced[:20]))
    if not extras:
        print("NO STALE ROWS")
        return 0
    if not args.apply:
        print("dry run: rerun with --apply")
        return 0

    failures: list[str] = []

    def delete(question_id: str) -> None:
        client.request(
            "DELETE",
            f"questions?id=eq.{urllib.parse.quote(question_id, safe='')}",
        )

    def archive(question_id: str) -> None:
        client.request(
            "PATCH",
            f"questions?id=eq.{urllib.parse.quote(question_id, safe='')}",
            {"status": "archived"},
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(delete, question_id): question_id for question_id in unused}
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as error:
                failures.append(f"delete {futures[future]}: {error}")
        futures = {pool.submit(archive, question_id): question_id for question_id in referenced}
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as error:
                failures.append(f"archive {futures[future]}: {error}")

    if failures:
        print(f"FAILED operations: {len(failures)}")
        for failure in failures[:10]:
            print("  " + failure)
        return 1

    rows = client.fetch("questions", "id,status", "id")
    active = [row for row in rows if row.get("status") == "active"]
    archived = [row for row in rows if row.get("status") == "archived"]
    print(f"after: total {len(rows):,}; active {len(active):,}; archived {len(archived):,}")
    if len(active) != 10_000:
        print("ACTIVE COUNT IS NOT 10,000")
        return 1
    if archived:
        print("archived ids: " + ", ".join(str(row["id"]) for row in archived))
    print("LIVE CATALOGUE CLEAN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

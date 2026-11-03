#!/usr/bin/env python3
"""Make the live database agree with the bundled question bank.

`src/data/questionBank.json` is the source of truth: it is what the student
sees and what `tools/fix_bank.py` repairs. `public.questions` and
`public.question_keys` are the server's copy, and `submit_question_attempt`
grades against `question_keys`. When the two drift apart, a correct answer can
be marked wrong on a signed-in account even though the app showed the right
key. This tool closes that gap.

Only the fields that affect grading and display are written:

  questions      choices, difficulty, stimulus, prompt, format
  question_keys  correct_answer, acceptable_answers, explanation,
                 distractor_rationales

Usage:
    python tools/sync_live_bank.py            # report the differences
    python tools/sync_live_bank.py --apply    # write them and verify

Reads the project URL and service key from .pa/supabase_url and
.pa/supabase_service_key (both git-ignored). Never prints the key.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"
QUESTION_FIELDS = ("choices", "difficulty", "stimulus", "prompt", "format")
KEY_FIELDS = (
    "correct_answer",
    "acceptable_answers",
    "explanation",
    "distractor_rationales",
)
PAGE = 1000


def credentials() -> tuple[str, str]:
    url_file = ROOT / ".pa" / "supabase_url"
    key_file = ROOT / ".pa" / "supabase_service_key"
    if not url_file.exists() or not key_file.exists():
        sys.exit("missing .pa/supabase_url or .pa/supabase_service_key")
    return url_file.read_text().strip().rstrip("/"), key_file.read_text().strip()


class Client:
    def __init__(self, url: str, key: str) -> None:
        self.url = url
        self.key = key

    def request(self, method: str, path: str, payload=None, retries: int = 4):
        last: Exception | None = None
        for attempt in range(retries):
            request = urllib.request.Request(
                f"{self.url}/rest/v1/{path}",
                data=json.dumps(payload).encode() if payload is not None else None,
                method=method,
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    body = response.read().decode()
                    return response.status, json.loads(body) if body else None
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode()[:300]
                if exc.code in (429, 500, 502, 503, 504):
                    last = RuntimeError(f"HTTP {exc.code}: {detail}")
                    continue
                raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}")
            except OSError as exc:  # transient network failure
                last = exc
        raise RuntimeError(f"{method} {path} failed: {last}")

    def fetch(self, table: str, select: str, order: str) -> list[dict]:
        rows: list[dict] = []
        offset = 0
        while True:
            status, page = self.request(
                "GET", f"{table}?select={select}&order={order}&offset={offset}&limit={PAGE}"
            )
            if status != 200 or not page:
                break
            rows.extend(page)
            if len(page) < PAGE:
                break
            offset += PAGE
        return rows


def normal(value):
    """JSON from PostgREST and from the bundle differ in key order and nulls."""
    if value is None:
        return ""
    if isinstance(value, list):
        return [normal(entry) for entry in value]
    if isinstance(value, dict):
        return {key: normal(value[key]) for key in sorted(value)}
    return value


def diff_fields(local: dict, remote: dict, fields) -> dict:
    out = {}
    for field in fields:
        if normal(local.get(field)) != normal(remote.get(field)):
            out[field] = local.get(field)
    return out


def ensure_sources(client: "Client", bank: dict, apply: bool) -> None:
    """Create or refresh dataset_sources before any question insert.

    A question has a foreign key to its source. The first 10,000-item sync
    failed with 868 inserts because the Wikipedia source existed in the bundle
    but not in the live table. Sources are written first, including a
    recomputed record_count, so a question cannot arrive before its provenance
    row.
    """
    sources = [source for source in (bank.get("sources") or []) if source.get("source_id")]
    if not sources:
        return
    counts: dict[str, int] = {}
    for question in bank.get("questions") or []:
        source_id = str(question.get("source_id") or "")
        counts[source_id] = counts.get(source_id, 0) + 1
    remote = {
        str(row.get("source_id")): row
        for row in client.fetch(
            "dataset_sources",
            "source_id,name,license,license_url,provenance_summary,"
            "is_released_practice_set,is_official_college_board,record_count",
            "source_id",
        )
    }
    missing = [source for source in sources if str(source["source_id"]) not in remote]
    if not apply:
        print(f"sources: {len(missing)} missing, {len(sources) - len(missing)} present (dry run)")
        return
    created = 0
    updated = 0
    for source in sources:
        source_id = str(source["source_id"])
        payload = {
            "source_id": source_id,
            "name": source.get("name"),
            "license": source.get("license"),
            "license_url": source.get("license_url"),
            "provenance_summary": source.get("provenance_summary"),
            "is_released_practice_set": bool(source.get("is_released_practice_set")),
            "is_official_college_board": bool(source.get("is_official_college_board")),
            "record_count": counts.get(source_id, 0),
        }
        existing = remote.get(source_id)
        if existing is None:
            client.request("POST", "dataset_sources", payload)
            created += 1
        elif any(normal(existing.get(key)) != normal(value) for key, value in payload.items()):
            patch = {key: value for key, value in payload.items() if key != "source_id"}
            client.request(
                "PATCH",
                f"dataset_sources?source_id=eq.{urllib.parse.quote(source_id, safe='')}",
                patch,
            )
            updated += 1
    print(f"sources: {created} created, {updated} refreshed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the differences")
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()

    url, key = credentials()
    client = Client(url, key)
    payload = json.loads(BANK.read_text(encoding="utf-8"))
    bank = payload["questions"]
    local = {question["id"]: question for question in bank}
    print(f"bundle: {len(local):,} questions")
    ensure_sources(client, payload, apply=args.apply)

    remote_questions = client.fetch(
        "questions", "id,choices,difficulty,stimulus,prompt,format", "id"
    )
    remote_keys = client.fetch(
        "question_keys",
        "question_id,correct_answer,acceptable_answers,explanation,distractor_rationales",
        "question_id",
    )
    print(f"live:   {len(remote_questions):,} questions, {len(remote_keys):,} keys")

    by_id = {row["id"]: row for row in remote_questions}
    keys = {row["question_id"]: row for row in remote_keys}
    missing_questions = sorted(set(local) - set(by_id))
    missing_keys = sorted(set(local) - set(keys))
    if missing_questions:
        print(f"MISSING live question rows: {len(missing_questions)}")
        print("  " + ", ".join(missing_questions[:10]))
    if missing_keys:
        print(f"MISSING live key rows: {len(missing_keys)}")
        print("  " + ", ".join(missing_keys[:10]))

    inserts = [local[question_id] for question_id in missing_questions]
    insert_keys = [local[question_id] for question_id in missing_keys]

    question_patches: list[dict] = []
    for question_id, question in local.items():
        remote = by_id.get(question_id)
        if remote is None:
            continue
        changes = diff_fields(question, remote, QUESTION_FIELDS)
        if changes:
            question_patches.append({"id": question_id, **changes})

    key_patches: list[dict] = []
    for question_id, question in local.items():
        remote = keys.get(question_id)
        if remote is None:
            continue
        changes = diff_fields(question, remote, KEY_FIELDS)
        if changes:
            key_patches.append({"question_id": question_id, **changes})

    print(f"questions needing a write: {len(question_patches):,}")
    print(f"keys needing a write:      {len(key_patches):,}")
    print(f"missing rows to insert:    {len(inserts):,}")
    if not question_patches and not key_patches and not missing_keys:
        print("LIVE BANK ALREADY MATCHES")
        return 0
    if not args.apply:
        for field in QUESTION_FIELDS + KEY_FIELDS:
            count = sum(1 for patch in question_patches + key_patches if field in patch)
            if count:
                print(f"  {field}: {count:,}")
        return 0

    question_columns = (
        "id",
        "external_id",
        "assessments",
        "section",
        "domain",
        "skill",
        "difficulty",
        "format",
        "stimulus",
        "prompt",
        "choices",
        "figure_metadata",
        "source_id",
        "source_name",
        "license",
        "attribution",
        "is_released_practice_set",
    )

    def write(question_patch: dict) -> None:
        payload = {k: v for k, v in question_patch.items() if k != "id"}
        client.request("PATCH", f"questions?id=eq.{question_patch['id']}", payload)

    def insert_question(question: dict) -> None:
        payload = {column: question.get(column) for column in question_columns}
        client.request("POST", "questions", payload)

    def insert_key(question: dict) -> None:
        payload = {
            "question_id": question["id"],
            **{field: question.get(field) for field in KEY_FIELDS},
        }
        client.request("POST", "question_keys", payload)

    def write_key(key_patch: dict) -> None:
        payload = {k: v for k, v in key_patch.items() if k != "question_id"}
        client.request(
            "PATCH", f"question_keys?question_id=eq.{key_patch['question_id']}", payload
        )

    failures: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(insert_question, row): row["id"] for row in inserts}
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as exc:
                failures.append(f"insert {futures[future]}: {exc}")
        futures = {pool.submit(insert_key, row): row["id"] for row in insert_keys}
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as exc:
                failures.append(f"insert key {futures[future]}: {exc}")
        if inserts:
            print(f"  inserted {len(inserts):,} questions and {len(insert_keys):,} keys")
        futures = {pool.submit(write, patch): patch["id"] for patch in question_patches}
        for done, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                future.result()
            except Exception as exc:  # keep going; report at the end
                failures.append(f"{futures[future]}: {exc}")
            if done % 500 == 0:
                print(f"  questions {done:,}/{len(question_patches):,}")
        futures = {
            pool.submit(write_key, patch): patch["question_id"] for patch in key_patches
        }
        for done, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                future.result()
            except Exception as exc:
                failures.append(f"{futures[future]}: {exc}")
            if done % 500 == 0:
                print(f"  keys {done:,}/{len(key_patches):,}")

    if failures:
        print(f"FAILED writes: {len(failures)}")
        for line in failures[:10]:
            print("  " + line)
        return 1

    print("verifying the live copy…")
    remote_questions = client.fetch(
        "questions", "id,choices,difficulty,stimulus,prompt,format", "id"
    )
    remote_keys = client.fetch(
        "question_keys",
        "question_id,correct_answer,acceptable_answers,explanation,distractor_rationales",
        "question_id",
    )
    by_id = {row["id"]: row for row in remote_questions}
    keys = {row["question_id"]: row for row in remote_keys}
    left_questions = sum(
        1
        for question_id, question in local.items()
        if question_id in by_id
        and diff_fields(question, by_id[question_id], QUESTION_FIELDS)
    )
    left_keys = sum(
        1
        for question_id, question in local.items()
        if question_id in keys
        and diff_fields(question, keys[question_id], KEY_FIELDS)
    )
    missing_keys = sorted(set(local) - set(keys))
    print(f"remaining question differences: {left_questions}")
    print(f"remaining key differences:      {left_keys}")
    print(f"remaining missing key rows:     {len(missing_keys)}")
    if left_questions or left_keys or missing_keys:
        return 1
    print("LIVE BANK IN SYNC")
    return 0


if __name__ == "__main__":
    sys.exit(main())

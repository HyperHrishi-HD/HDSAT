#!/usr/bin/env python3
"""Harvest the public College Board SAT question bank locally.

The API is the public endpoint used by the College Board Educator Question
Bank. No account or key is required. This script deliberately keeps every
question payload under ``tools/.collegeboard`` (gitignored); no question
content is embedded in this file or written into the repository's tracked
bank files.

Usage
-----
    python tools/collegeboard_harvest.py
    python tools/collegeboard_harvest.py --index-only
    python tools/collegeboard_harvest.py --refresh-index
    python tools/collegeboard_harvest.py --limit 20

The content pass is resumable: completed external IDs in ``contents.jsonl``
are skipped on the next run. Requests are capped at six workers and retried
with the plan's 1.5s / 3s / 6s / 12s backoff.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "tools" / ".collegeboard"
BASE = "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank"
ORIGIN = "https://satsuiteeducatorquestionbank.collegeboard.org"
HEADERS = {
    "Accept": "application/json",
    "Origin": ORIGIN,
    "Referer": f"{ORIGIN}/",
    "User-Agent": "HDSAT-CollegeBoard-Importer/1.0 (local practice-bank importer)",
}
BACKOFF = (1.5, 3.0, 6.0, 12.0)
ASMT_EVENT_ID = 99
TESTS = {1: "Reading and Writing", 2: "Math"}


def request_json(path: str, payload: dict | None = None) -> object:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = dict(HEADERS)
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=body,
        headers=headers,
        method="GET" if body is None else "POST",
    )
    last_error = ""
    for attempt, delay in enumerate((0.0, *BACKOFF)):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                raw = response.read()
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code}: {exc.read()[:500].decode('utf-8', 'replace')}"
            if exc.code not in (429, 500, 502, 503, 504) and exc.code < 500:
                raise RuntimeError(last_error) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        print(f"  retry {attempt + 1}/5 for {path}: {last_error}", file=sys.stderr)
    raise RuntimeError(f"giving up on {path} after 5 attempts: {last_error}")


def domain_codes(lookup: dict, test: int) -> str:
    key = "R&W" if test == 1 else "Math"
    domains = (lookup.get("lookupData") or {}).get("domain", {}).get(key, [])
    codes = [str(item.get("primaryClassCd") or "").strip() for item in domains]
    codes = [code for code in codes if code]
    if not codes:
        raise RuntimeError(f"lookup returned no domain codes for {key}")
    return ",".join(codes)


def load_lookup(out: Path, refresh: bool) -> dict:
    path = out / "lookup.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    print("GET /lookup")
    lookup = request_json("/lookup")
    if not isinstance(lookup, dict) or "lookupData" not in lookup:
        raise RuntimeError(f"unexpected lookup payload: {str(lookup)[:500]}")
    out.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(lookup, ensure_ascii=False, indent=2), encoding="utf-8")
    return lookup


def load_stubs(out: Path, lookup: dict, refresh: bool) -> list[dict]:
    path = out / "stubs.json"
    if path.exists() and not refresh:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(cached, list) and cached:
            print(f"using cached index: {len(cached)} stubs")
            return cached
    stubs: list[dict] = []
    for test, label in TESTS.items():
        domains = domain_codes(lookup, test)
        print(f"POST /digital/get-questions test={test} ({label}) domains={domains}")
        rows = request_json(
            "/digital/get-questions",
            {"asmtEventId": ASMT_EVENT_ID, "test": test, "domain": domains},
        )
        if not isinstance(rows, list):
            raise RuntimeError(f"unexpected get-questions payload for test {test}: {str(rows)[:500]}")
        kept = 0
        for row in rows:
            if not isinstance(row, dict) or not row.get("external_id"):
                continue
            kept += 1
            stubs.append({**row, "_test": test, "_section": label})
        print(f"  {len(rows)} rows, {kept} with external_id")
    if not stubs:
        raise RuntimeError("index returned no stubs with external_id")
    out.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(stubs, ensure_ascii=False, indent=2), encoding="utf-8")
    return stubs


def existing_content_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            external_id = row.get("external_id")
            if isinstance(external_id, str) and external_id:
                ids.add(external_id)
    return ids


def fetch_content(stub: dict) -> tuple[str, dict | None, str | None]:
    external_id = str(stub["external_id"])
    try:
        content = request_json("/digital/get-question", {"external_id": external_id})
    except Exception as exc:  # one bad question must not kill the run
        return external_id, None, f"{type(exc).__name__}: {exc}"
    if not isinstance(content, dict):
        return external_id, None, f"non-object payload: {str(content)[:300]}"
    if not content.get("stem"):
        return external_id, None, "payload has no stem"
    return external_id, content, None


def harvest_content(out: Path, stubs: list[dict], workers: int, limit: int | None) -> tuple[list[dict], list[dict]]:
    contents_path = out / "contents.jsonl"
    existing = existing_content_ids(contents_path)
    pending = [stub for stub in stubs if str(stub["external_id"]) not in existing]
    if limit is not None:
        pending = pending[:limit]
    print(f"content pass: {len(existing)} cached, {len(pending)} pending, workers={workers}")
    failures: list[dict] = []
    downloaded = 0
    with contents_path.open("a", encoding="utf-8", newline="\n") as handle:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fetch_content, stub): stub for stub in pending}
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                stub = futures[future]
                external_id, content, error = future.result()
                if content is None:
                    failures.append({"external_id": external_id, "error": error})
                else:
                    handle.write(
                        json.dumps({"external_id": external_id, "content": content}, ensure_ascii=False) + "\n"
                    )
                    handle.flush()
                    downloaded += 1
                if index % 100 == 0 or index == len(pending):
                    print(
                        f"  {index}/{len(pending)} complete; downloaded={downloaded}; failures={len(failures)}"
                    )
    # Merge by ID; a rerun can leave an older duplicate line, so later lines win.
    merged: dict[str, dict] = {}
    with contents_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            external_id = row.get("external_id")
            content = row.get("content")
            if isinstance(external_id, str) and isinstance(content, dict):
                merged[external_id] = content
    questions = []
    for stub in stubs:
        external_id = str(stub["external_id"])
        content = merged.get(external_id)
        if content is not None:
            questions.append({"stub": stub, "content": content})
    return questions, failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--refresh-index", action="store_true")
    parser.add_argument("--index-only", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    if args.workers > 6:
        parser.error("the plan caps College Board concurrency at 6")
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    lookup = load_lookup(out, args.refresh_index)
    practice_ids = sorted(set(lookup.get("readingLiveItems", [])) | set(lookup.get("mathLiveItems", [])))
    stubs = load_stubs(out, lookup, args.refresh_index)
    by_test = {test: sum(1 for stub in stubs if stub.get("_test") == test) for test in TESTS}
    print(f"indexed: {len(stubs)} stubs ({by_test}); practice-test overlap IDs: {len(practice_ids)}")
    report: dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "api": BASE,
        "asmt_event_id": ASMT_EVENT_ID,
        "stubs_total": len(stubs),
        "stubs_by_test": {str(key): value for key, value in by_test.items()},
        "practice_test_ids": len(practice_ids),
        "content_downloaded": 0,
        "content_failures": [],
    }
    (out / "practice_ids.json").write_text(json.dumps(practice_ids, indent=2), encoding="utf-8")
    if not args.index_only:
        questions, failures = harvest_content(out, stubs, args.workers, args.limit)
        report["content_downloaded"] = len(questions)
        report["content_failures"] = failures
        payload = {
            "harvested_at": report["generated_at"],
            "lookup": lookup,
            "practice_ids": practice_ids,
            "questions": questions,
        }
        (out / "cb_sat_bank.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8", newline="\n"
        )
        print(f"wrote {out / 'cb_sat_bank.json'} with {len(questions)} complete questions")
    (out / "harvest_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2)[:4000])


if __name__ == "__main__":
    main()

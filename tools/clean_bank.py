#!/usr/bin/env python3
"""Bank hygiene: remove exact duplicate items and dangling figure references.

Two defects accumulated while the bank grew through several generated batches:

  1. **Exact duplicates.** A later batch re-emitted an older item under a new
     id, so the same equation and the same question appeared twice. Students
     drilling a skill could meet the identical item twice in one session, and
     `tools/content_qa.py` counts each repeat as a `duplicate_stem` error.
     This script keeps the first occurrence (the older, usually hand-checked
     row) and drops later copies.

  2. **Dangling figure references.** Some generated text-only items still said
     "(Series 1.)" or "(Table 2.)" after their figure was removed. The reader
     is asked to consult something that is not on the page. The parenthetical
     is stripped when the item has no `figure_metadata`; anything with a real
     figure is left untouched.

Both operations are idempotent. Run without `--write` for a report.

    python tools/clean_bank.py
    python tools/clean_bank.py --write --version 2026.11.01-open-core-7
"""

import argparse
import collections
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
BANK = ROOT / "src" / "data" / "questionBank.json"
sys.path.insert(0, str(ROOT / "tools"))

import content_qa  # noqa: E402  (same normalisation the QA gate uses)

# "(Series 1.)", "(Table 2)", "(Chart)", "(Figure 3.)" — only these, so ordinary
# parentheses in prose survive.
DANGLING = re.compile(
    r"\s*\((?:Series|Table|Figure|Graph|Chart)\s*\d*\.?\)", re.IGNORECASE
)


def stem_key(question):
    """Match the QA gate exactly: punctuation and case are not differences."""
    return (question.get("section") or "", content_qa.stem_of(question))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write the cleaned bank")
    parser.add_argument("--version", help="bank_version to stamp when writing")
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]
    print(f"bank {bank['bank_version']}: {len(questions)} items")

    seen = set()
    kept = []
    removed = []
    for question in questions:
        key = stem_key(question)
        if key in seen:
            removed.append(question["id"])
            continue
        seen.add(key)
        kept.append(question)

    by_skill = collections.Counter(
        q["skill"] for q in questions if q["id"] in set(removed)
    )
    print(f"exact duplicates: {len(removed)}")
    for skill, count in by_skill.most_common():
        print(f"  {skill}: {count}")

    fixed = []
    for question in kept:
        if question.get("figure_metadata"):
            continue
        changed = False
        for field in ("stimulus", "prompt"):
            text = question.get(field)
            if not text:
                continue
            cleaned = DANGLING.sub("", text)
            cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
            if cleaned != text:
                question[field] = cleaned
                changed = True
        if changed:
            fixed.append(question["id"])
    print(f"dangling figure references stripped: {len(fixed)}")

    result = {**bank, "questions": kept}
    if args.version:
        result["bank_version"] = args.version
    result["generated_at"] = datetime.now(timezone.utc).isoformat()
    counts = collections.Counter(q["source_id"] for q in kept)
    result["sources"] = [
        {**source, "record_count": counts.get(source["source_id"], 0)}
        for source in bank["sources"]
    ]

    if not args.write:
        print("dry run: nothing written")
        return

    BANK.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {BANK} ({len(kept)} items, {BANK.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

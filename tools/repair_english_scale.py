#!/usr/bin/env python3
"""Repair the 50 malformed items from the scale generator.

The first scale run emitted ungrammatical stimuli and throwaway distractors
("modern electronic sensors"). The templates in generate_bank_scale.py now
produce grammatical prose and credible, longer wrong choices. This script
regenerates only the affected IDs and writes them into the bundled bank while
preserving every other row.
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "supabase" / "import"))

from generate_bank_scale import gen_cid_scaled  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
TARGET = {f"RW-INF-{number}" for number in range(88601, 88651)}
SOURCE_FIELDS = ("source_id", "source_name", "license", "attribution")


def main() -> None:
    with BANK.open(encoding="utf-8") as handle:
        bank = json.load(handle)

    repaired = {item["id"]: item for item in gen_cid_scaled() if item["id"] in TARGET}
    if set(repaired) != TARGET:
        raise SystemExit(f"generator returned {len(repaired)} of {len(TARGET)} repaired items")

    replaced = 0
    for index, old in enumerate(bank["questions"]):
        new = repaired.get(old["id"])
        if new is None:
            continue
        if old.get("section") != "Reading and Writing":
            raise SystemExit(f"{old['id']} changed section unexpectedly")
        # Regeneration replaces the prose, not the provenance. Preserve the
        # item's original license and attribution so content QA can trace it.
        new = dict(new)
        for field in SOURCE_FIELDS:
            if old.get(field):
                new[field] = old[field]
        # Older runs had already stripped the provenance fields before this
        # script learned to preserve them. Rebuild from the bank's own source
        # registry so a re-run remains correct even on that intermediate bank.
        source = next(
            (s for s in bank.get("sources", []) if s.get("source_id") == new.get("source_id")),
            {},
        )
        if source:
            new.setdefault("source_name", source.get("name"))
            new.setdefault("license", source.get("license"))
            new.setdefault("attribution", f"{source.get('name')} ({source.get('license')})")
        bank["questions"][index] = new
        replaced += 1

    if replaced != len(TARGET):
        raise SystemExit(f"replaced {replaced} of {len(TARGET)} items")
    if len(bank["questions"]) != 10024:
        raise SystemExit(f"bank size changed to {len(bank['questions'])}")

    with BANK.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(bank, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"repaired {replaced} English items; bank still has {len(bank['questions'])} items")


if __name__ == "__main__":
    main()

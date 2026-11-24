#!/usr/bin/env python3
"""Verify the normalized official College Board bank without changing it."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BANK = ROOT / "public" / "collegeBoardBank.json"
EXPECTED_TOTAL = 3663
EXPECTED_RW = 2030
EXPECTED_MATH = 1633
EXPECTED_PRACTICE = 2019
FIGURE_PHRASE = re.compile(
    r"(?:"
    r"\bin the figure above\b|"
    r"\bthe figure above\b|"
    r"\bshown in the figure\b|"
    r"\bas shown in the figure\b|"
    r"\brefer to the figure\b|"
    r"\bthe graph shown\b|"
    r"\bshown in the graph\b|"
    r"\brefer to the table\b|"
    r"\bthe table above\b|"
    r"\bthe following table\b|"
    r"\btable shown\b|"
    r"\bfigure below\b|"
    r"\bshown below\b"
    r")",
    re.IGNORECASE,
)
MEDIA = re.compile(r"<(?:img|svg|table|figure)\b", re.IGNORECASE)


def fail(message: str) -> None:
    raise SystemExit(f"FAIL {message}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    args = parser.parse_args()
    document = json.loads(args.bank.read_text(encoding="utf-8"))
    questions = document.get("questions") or []
    sources = {source["source_id"]: source for source in document.get("sources") or []}

    if len(questions) != EXPECTED_TOTAL:
        fail(f"expected {EXPECTED_TOTAL} questions, got {len(questions)}")
    if len({q.get("id") for q in questions}) != len(questions):
        fail("duplicate question ids")
    if len({q.get("external_id") for q in questions}) != len(questions):
        fail("duplicate external ids")
    if source := sources.get("collegeboard-sat"):
        if not source.get("is_official_college_board"):
            fail("official source missing is_official_college_board")
        if source.get("record_count") != len(questions):
            fail("source record_count does not match bank")
    else:
        fail("collegeboard-sat source missing")

    section_counts = Counter(q.get("section") for q in questions)
    if section_counts != {"Reading and Writing": EXPECTED_RW, "Math": EXPECTED_MATH}:
        fail(f"unexpected section counts {section_counts}")
    practice = sum(bool(q.get("in_practice_test")) for q in questions)
    if practice != EXPECTED_PRACTICE:
        fail(f"expected {EXPECTED_PRACTICE} practice-overlap rows, got {practice}")

    for q in questions:
        qid = q.get("id", "?")
        if q.get("source_id") != "collegeboard-sat":
            fail(f"{qid}: wrong source")
        if not q.get("prompt", "").strip():
            fail(f"{qid}: empty prompt")
        if not q.get("explanation", "").strip():
            fail(f"{qid}: empty explanation")
        if q.get("section") not in {"Reading and Writing", "Math"}:
            fail(f"{qid}: bad section")
        if q.get("difficulty") not in {"Easy", "Medium", "Hard"}:
            fail(f"{qid}: bad difficulty")
        if q.get("format") == "multiple_choice":
            choices = q.get("choices") or []
            if len(choices) != 4:
                fail(f"{qid}: expected 4 choices")
            if q.get("correct_answer") not in {"A", "B", "C", "D"}:
                fail(f"{qid}: bad MCQ key")
        elif q.get("format") == "spr":
            if not q.get("acceptable_answers"):
                fail(f"{qid}: SPR has no acceptable answers")
        else:
            fail(f"{qid}: bad format")
        if q.get("score_band") is not None and not 1 <= int(q["score_band"]) <= 7:
            fail(f"{qid}: score_band outside 1-7")
        html = q.get("prompt", "") + "\n" + (q.get("stimulus") or "")
        if "<mfenced" in html:
            fail(f"{qid}: unresolved mfenced")
        if q.get("unusable") and MEDIA.search(html):
            fail(f"{qid}: marked unusable but contains media")
        if FIGURE_PHRASE.search(html) and not MEDIA.search(html):
            # A phrase-only reference is only unusable when no answer choice
            # carries the missing table/figure either.
            choices = "\n".join(choice.get("text", "") for choice in q.get("choices") or [])
            if not MEDIA.search(choices):
                fail(f"{qid}: references a figure/table with no media")

    print(
        f"PASS official bank: {len(questions)} unique questions "
        f"({section_counts['Reading and Writing']} R&W, {section_counts['Math']} Math), "
        f"{practice} practice-overlap, "
        f"{sum(bool(q.get('unusable')) for q in questions)} unusable, "
        f"{sum(q.get('format') == 'spr' for q in questions)} SPR"
    )


if __name__ == "__main__":
    main()

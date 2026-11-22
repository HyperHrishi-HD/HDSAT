"""Keep only answers that are actually equal to the key.

Numeric-entry questions carried a list of accepted strings, and the list had
drifted: 1/12 was accepted as 0.08 (0.0833 is right) and 1/8 as 0.12 (0.125 is
right). Two different values grading as correct is the same failure as two
correct choices on a multiple-choice item.

The rule now: keep the key, keep any entry whose *value* equals the key (so
"1/2", "0.5" and ".5" all survive), and keep decimal forms within 0.001 of the
key, which is the width of the rounding the SAT itself allows. Anything else is
dropped.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deep_audit import choice_value  # noqa: E402

BANK = Path(__file__).resolve().parents[1] / "src" / "data" / "questionBank.json"
TOLERANCE = 1e-3


def main() -> None:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    changed = 0
    dropped = 0
    for question in bank["questions"]:
        if question.get("format") != "spr":
            continue
        key = str(question.get("correct_answer") or "").strip()
        if not key:
            continue
        key_value = choice_value(key)
        accepted = [str(a).strip() for a in (question.get("acceptable_answers") or [])]
        kept: list[str] = []
        for entry in [key, *accepted]:
            if not entry or entry in kept:
                continue
            if entry == key:
                kept.append(entry)
                continue
            value = choice_value(entry)
            if key_value is None:
                # Non-numeric key: only an identical string is the same answer.
                continue
            if value is None:
                continue
            if abs(value - key_value) <= TOLERANCE or abs(value - key_value) <= abs(key_value) * 1e-9:
                kept.append(entry)
            else:
                dropped += 1
        if kept != accepted:
            question["acceptable_answers"] = kept
            changed += 1
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"rewrote {changed} answer lists; removed {dropped} values that were not the key")


if __name__ == "__main__":
    main()

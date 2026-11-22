#!/usr/bin/env python3
"""Point every polynomial-zero distractor rationale at its own choice.

`generate_bank_scale.py` used to write all three rationales with
`wrongs[0]`, so the sentence shown after picking A said "Substituting $x = 2$"
even when A was 1 — and when 2 was one of the factors, the sentence claimed a
zero was not a zero. The generators are fixed; this repairs the bank that was
already generated from them.
"""

from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"

FACTOR = re.compile(r"\(x\s*[-+]\s*\d+\)")
NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
SUB = re.compile(r"Substituting \$x = -?\d+\$")


def value_of(text: str) -> int | None:
    match = NUMBER.search(str(text).replace("$", ""))
    return int(float(match.group())) if match else None


def main() -> int:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    changed = 0
    for question in bank["questions"]:
        if question.get("format") != "multiple_choice":
            continue
        if "zero" not in question.get("prompt", "").lower():
            continue
        if len(FACTOR.findall(question.get("stimulus", ""))) != 3:
            continue
        rationales = question.get("distractor_rationales") or {}
        for choice in question.get("choices", []):
            if choice["id"] == question.get("correct_answer"):
                continue
            text = rationales.get(choice["id"])
            if not text or not SUB.search(text):
                continue
            own = value_of(choice["text"])
            if own is None:
                continue
            fixed = SUB.sub(f"Substituting $x = {own}$", text)
            if fixed != text:
                rationales[choice["id"]] = fixed
                changed += 1
        explanation = question.get("explanation", "")
        if "remaining roots" in explanation:
            question["explanation"] = re.sub(
                r"\s*The other listed values are the remaining roots\.", "", explanation
            )
            changed += 1
    if changed:
        BANK.write_text(
            json.dumps(bank, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print(f"rationales repaired: {changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

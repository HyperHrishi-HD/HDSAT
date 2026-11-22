"""Repair the defects the audit still reports after the bulk fix pass.

Two kinds of damage are left, and both are one-off, so they are named
explicitly instead of pattern-matched:

* Fifteen questions carry two choices with the same value (the generator
  emitted a duplicate and a later pass labelled it "(variant 1)" instead of
  removing it). Two identical choices mean two correct answers, which is the
  worst failure a practice bank can have.
* M-ALG-103 has a stray question inside its stimulus ("Which equation gives its
  depth 6 meters after 6 minutes?") that contradicts its own answer.

Every rewrite keeps the correct answer untouched; only wrong distractors change,
and each new distractor is a value a student can actually arrive at by making
the usual mistake (doubling, dropping the angle, mixing up radius and diameter).
"""

from __future__ import annotations

import json
from pathlib import Path

BANK = Path(__file__).resolve().parents[1] / "src" / "data" / "questionBank.json"

# question id -> {choice id: replacement text}
CHOICE_TEXT: dict[str, dict[str, str]] = {
    # 23-7 over 12-4 is 2; 8 is the denominator left unreduced.
    "M-LIF-118": {"D": "$8$"},
    # 60/360 of pi(6)^2 is 6pi; 18pi is the full circle times three.
    "M-GEO-159": {"C": "$18\\pi$"},
    # 90/360 of pi(2)^2 is 1pi; 4pi forgets the angle.
    "M-GEO-56104": {"B": "$4\\pi$"},
    "M13-GEO-C000": {"B": "18\\pi"},
    "M13-GEO-C001": {"C": "32\\pi"},
    "M13-GEO-C002": {"C": "50\\pi"},
    "M13-GEO-C003": {"D": "72\\pi"},
    "M13-GEO-C004": {"D": "98\\pi"},
    "M13-GEO-C005": {"B": "128\\pi"},
    "M13-GEO-C006": {"A": "162\\pi"},
    "M13-GEO-C007": {"A": "200\\pi"},
    "M13-GEO-C008": {"C": "288\\pi"},
    # pi(2)^2 = 4pi. 8pi is the diameter error, 16pi squares the diameter,
    # 2pi drops the exponent.
    "M13-GEO-C009": {"A": "16\\pi", "B": "2\\pi"},
    "M13-GEO-C010": {"D": "242\\pi"},
    "M13-GEO-C011": {"B": "192\\pi"},
}

STIMULUS: dict[str, str] = {
    "M-ALG-103": (
        "A submarine resting at a depth of 15 meters begins to descend at a "
        "constant rate. After 6 minutes it is at a depth of 57 meters."
    ),
}

PROMPT: dict[str, str] = {
    "M-ALG-103": "At what rate does the submarine descend, in meters per minute?",
}


def main() -> None:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    by_id = {question["id"]: question for question in bank["questions"]}
    changed = 0

    for qid, mapping in CHOICE_TEXT.items():
        question = by_id.get(qid)
        if question is None:
            raise SystemExit(f"missing question {qid}")
        existing = {choice["text"] for choice in question["choices"]}
        for cid, text in mapping.items():
            choice = next(c for c in question["choices"] if c["id"] == cid)
            if choice["text"] == text:
                continue
            if text in existing:
                raise SystemExit(f"{qid}: {text} already used")
            existing.discard(choice["text"])
            existing.add(text)
            choice["text"] = text
            changed += 1
        # The answer list must still describe the correct choice only.
        answer = question["correct_answer"]
        question["acceptable_answers"] = [
            value for value in question.get("acceptable_answers", [answer]) if value == answer
        ] or [answer]
        values = [c["text"] for c in question["choices"]]
        if len(set(values)) != len(values):
            raise SystemExit(f"{qid}: still has duplicate choices: {values}")

    for qid, text in STIMULUS.items():
        by_id[qid]["stimulus"] = text
        changed += 1
    for qid, text in PROMPT.items():
        by_id[qid]["prompt"] = text
        changed += 1

    BANK.write_text(
        json.dumps(bank, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"repaired {changed} field(s) across {len(CHOICE_TEXT)} questions")


if __name__ == "__main__":
    main()

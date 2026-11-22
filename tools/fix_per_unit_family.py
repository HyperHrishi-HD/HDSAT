"""Repair the per-unit-rate word problems.

Three of them were written before the pattern was settled, and they are the ones
the audit flags: the stem states the rate and then asks for it, and the totals
do not follow from the numbers given (M-ALG-106 adds a monthly fee in dollars to
an overage total in cents). They are rewritten so the rate is what the reader has
to work out.

The nineteen "flat fee plus N dollars per passenger" items are consistent but
answer themselves the same way, so their rate phrase becomes "the same amount"
and the group size is stated, which keeps the arithmetic and removes the
giveaway. Only items whose totals divide exactly are touched.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deep_audit import choice_value  # noqa: E402

BANK = Path(__file__).resolve().parents[1] / "src" / "data" / "questionBank.json"

EXPLANATIONS: dict[str, str] = {
    "M-ALG-102": (
        "The flat fee is $18$ and the total was $66$, so the passengers paid "
        "$66 - 18 = 48$ dollars between them. Eight passengers paid $48$, so each "
        "paid $48 \\div 8 = 6$ dollars."
    ),
    "M-ALG-104": (
        "Subtract the processing fee first: $51 - 24 = 27$ dollars is what the late "
        "days cost. Three late days at $27$ dollars total come to $27 \\div 3 = 9$ "
        "dollars per day."
    ),
    "M-ALG-106": (
        "The monthly fee is not part of the overage, so divide the overage by the "
        "megabytes: $72 \\div 9 = 8$ cents per megabyte."
    ),
}

REWRITES: dict[str, str] = {
    "M-ALG-102": (
        "A ferry charges a flat boarding fee of 18 dollars plus the same amount for every "
        "passenger. A group of 8 passengers paid 66 dollars in total. How much is charged "
        "per passenger?"
    ),
    "M-ALG-104": (
        "A library charges 24 dollars for a lost-item processing fee plus the same amount for "
        "every day a book is late. Maya returned a book 3 days late and paid 51 dollars in "
        "fees. What is the charge per late day?"
    ),
    "M-ALG-106": (
        "A phone plan costs 30 dollars a month plus the same amount for every megabyte used "
        "over the data cap. A customer who went 9 megabytes over the cap owes 72 cents for "
        "that overage. What is the charge per megabyte, in cents?"
    ),
}


def main() -> None:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    rewritten = 0
    giveaway = 0
    for question in bank["questions"]:
        qid = question["id"]
        if qid in REWRITES:
            question["stimulus"] = REWRITES[qid]
            question["explanation"] = EXPLANATIONS[qid]
            rewritten += 1
            continue
        if "per-unit rate" not in (question.get("prompt") or ""):
            continue
        stimulus = question.get("stimulus") or ""
        # "plus 6 dollars per passenger": consistent, but states the answer.
        m = re.search(
            r"flat (?:boarding )?fee of (\d+(?:\.\d+)?) dollars plus (\d+(?:\.\d+)?) dollars per passenger"
            r".{0,90}?paid (\d+(?:\.\d+)?) dollars",
            stimulus,
            re.S,
        )
        if not m:
            continue
        fee, rate, total = float(m.group(1)), float(m.group(2)), float(m.group(3))
        if rate <= 0:
            continue
        count = (total - fee) / rate
        if abs(count - round(count)) > 1e-9 or count <= 0:
            continue
        new_text = (
            f"A ferry charges a flat boarding fee of {m.group(1)} dollars plus the same amount "
            f"for every passenger. A group of {int(round(count))} passengers paid "
            f"{m.group(3)} dollars in total. How much is charged per passenger?"
        )
        question["stimulus"] = new_text
        question["explanation"] = (
            f"The flat fee is ${m.group(1)}$ dollars and the total was ${m.group(3)}$ dollars, "
            f"so the fares came to ${m.group(3)} - {m.group(1)} = {int(round(total - fee))}$ dollars. "
            f"Split across ${int(round(count))}$ passengers, that is "
            f"${int(round(total - fee))} \\div {int(round(count))} = {m.group(2)}$ dollars each."
        )
        giveaway += 1

    # Every rewritten stem must still agree with its key: the rate has to be one
    # of the choices, and the arithmetic in the new sentence has to hold.
    by_id = {q["id"]: q for q in bank["questions"]}
    for qid in REWRITES:
        question = by_id[qid]
        key = next(c for c in question["choices"] if c["id"] == question["correct_answer"])
        value = choice_value(key["text"])
        nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", question["stimulus"])]
        holds = any(
            abs(a + value * c - d) < 1e-9 for c in nums for d in nums for a in [*nums, 0.0]
        )
        if value is None or not holds:
            raise SystemExit(f"{qid}: rewritten stem no longer fits its key")

    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"rewrote {rewritten} legacy stems and {giveaway} self-answering ones")


if __name__ == "__main__":
    main()

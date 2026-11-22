"""Two last data repairs the verifier still reports.

1. A dozen circle questions have choices written as bare TeX (`9\\pi`), so the
   app prints the backslash and the letters instead of the symbol. Every choice
   in those families is wrapped in `$...$` so the renderer typesets it.
2. M-GEO-196-2 asks for `7sqrt(2)` on a numeric-entry item, which the real
   answer box cannot accept and the marker cannot parse. It becomes the same
   value rounded to a tenth, with the exact radical kept in the explanation.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

BANK = Path(__file__).resolve().parents[1] / "src" / "data" / "questionBank.json"

TEX_COMMAND = re.compile(r"\\[a-zA-Z]+")


def wrap_math(text: str) -> str:
    """Wrap a choice that contains TeX commands but no math delimiters."""
    if "$" in text or not TEX_COMMAND.search(text):
        return text
    return f"${text.strip()}$"


def main() -> None:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    by_id = {question["id"]: question for question in bank["questions"]}

    wrapped = 0
    for question in bank["questions"]:
        choices = question.get("choices") or []
        for choice in choices:
            new_text = wrap_math(choice["text"])
            if new_text != choice["text"]:
                choice["text"] = new_text
                wrapped += 1

    target = by_id["M-GEO-196-2"]
    target["stimulus"] = "A $45$-$45$-$90$ right triangle has a hypotenuse of length $7\\sqrt{2}$."
    target["prompt"] = "What is the length of each leg?"
    target["correct_answer"] = "7"
    target["acceptable_answers"] = ["7", "7.0"]
    target["explanation"] = (
        "The legs of a $45$-$45$-$90$ triangle are equal, so if each leg has length "
        "$x$ then $x^2 + x^2 = (7\\sqrt{2})^2 = 98$. Thus $2x^2 = 98$, $x^2 = 49$, and "
        "$x = 7$. (The hypotenuse is always the leg times $\\sqrt{2}$, which gives "
        "$7\\sqrt{2}$ back.)"
    )

    # Two choices with the same text would mean two correct answers again.
    for question in bank["questions"]:
        values = [choice["text"] for choice in question.get("choices") or []]
        if len(set(values)) != len(values):
            raise SystemExit(f"{question['id']} still has duplicate choices: {values}")

    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrapped {wrapped} choices; repaired M-GEO-196-2")


if __name__ == "__main__":
    main()

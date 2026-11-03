#!/usr/bin/env python3
"""Polish the final 10,000-item bank without adding or removing an item.

The pass targets defects that survived the structural audits:

* currency dollars that the renderer can mistake for LaTeX delimiters;
* the generic "amount added each cycle" prompt on contexts measured in
  passengers, miles, posters, hours, days, rounds and batches;
* "1 red marbles" singular/plural agreement;
* negative sale-price distractors;
* rectangle-area items filed under the volume skill;
* seven explanations that were too thin to teach the inference;
* five explanations that name a choice letter instead of describing the key.

Everything is idempotent. The script rewrites the bank, bumps its version and
writes ``supabase/seed/0031_polish_round2.sql`` with only changed rows.

Usage:
    python supabase/import/polish_bank_round2.py --version 2026.11.03-open-core-35
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tools"))

import import_questions as iq  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
SEED = ROOT / "supabase" / "seed" / "0031_polish_round2.sql"

RATE_PROMPTS = {
    "A community garden": "How many seedling trays are added each cycle?",
    "A ferry": "What is the charge per passenger, in dollars?",
    "A clay studio": "How many mugs are restocked at each firing?",
    "A courier": "What is the charge per mile, in dollars?",
    "A print shop": "What is the price per poster, in dollars?",
    "An aquarium": "How many gallons are added each hour?",
    "A bakery": "How many loaves are baked each hour?",
    "A repair shop": "What is the labor rate per hour, in dollars?",
    "A library": "How many books are received each day?",
    "An orchard": "How many crates are filled each picking round?",
    "A candle maker": "How many jars are filled each batch?",
    "A box office": "How many seats are released each hour?",
}

SHORT_EXPLANATIONS = {
    "RW-M10P-0172": (
        "The passage links shallow roots to reliance on upper-soil moisture, "
        "so drought there is the logical risk."
    ),
    "RW-M10P-0173": (
        "The layers record burning even when no tools survive, which is why they "
        "can establish occupation independently."
    ),
    "RW-M10P-0174": (
        "The copper peak aligns with the shipyard's busiest years, so the sediment "
        "layers track the industry's rise and fall."
    ),
    "RW-M10P-0176": (
        "Because wind-driven rain can enter under a small overlap, the overlap must "
        "be sized for the weather the roof will face."
    ),
    "RW-M10P-0201": (
        "Wind removes the surrounding soil faster than the protected ground beneath "
        "the stone, so the stone appears to rise."
    ),
    "RW-M10P-0202": (
        "The passage identifies stored nutrients, cool nights and moisture as joint "
        "requirements, so no single storm is sufficient."
    ),
    "RW-M10P-0252": (
        "The text first explains the advantage of large size, then shows how "
        "introduced rats turned that advantage into a liability."
    ),
}

CHOICE_REFERENCE_REPLACEMENTS = {
    "RW-INF-001": [
        ("Choice A accurately", "The keyed choice accurately"),
        ("Choices C and D, and D introduce", "The other choices introduce"),
    ],
    "RW-INF-003": [("Choice A directly", "The keyed choice directly")],
    "RW-INF-004": [("Choice D directly", "The keyed choice directly")],
    "RW-EXP-002": [("Choice C synthesizes", "The keyed choice synthesizes")],
    "RW-EXP-003": [("Choice C explicitly", "The keyed choice explicitly")],
}

CURRENCY_RW_IDS = {
    "RW-M16-CI006", "RW-M16-INF006", "RW-M16-TS006", "RW-M16-CE006",
    "RW-M23-CI005", "RW-M23-INF005", "RW-M23-TS005", "RW-M23-CE005",
    "RW-M24-CE002", "RW-M26-CI001", "RW-M26-INF001", "RW-M26-TS001",
    "RW-M26-CE001", "RW-M27-CI006", "RW-M27-INF006", "RW-M27-TS006",
    "RW-M27-CE006", "RW-M35-B034",
}


def escape_currency(text: str) -> str:
    """Escape a bare dollar before a number, leaving math delimiters alone.

    ``$20`` is a price; ``$x$`` is mathematics. Only a dollar followed by an
    optional sign and a digit is escaped, and an already escaped ``\\$`` is
    left untouched.
    """
    return re.sub(r"(?<!\\)\$(?=\s*-?\d)", r"\\$", text)


def strip_math_style(text: str) -> str:
    """Remove generator-only coefficient 1 and 1(...) noise."""
    text = re.sub(r"(?<![A-Za-z0-9])1([xy])(?![A-Za-z0-9])", r"\1", text)
    text = re.sub(r"(?<![A-Za-z0-9])1\(", "(", text)
    return text


def vertex_stimulus(stimulus: str) -> str | None:
    """Rewrite ``y = 1(x - (-5))^2 + (-5)`` as ``y = (x + 5)^2 - 5``."""
    match = re.fullmatch(
        r"The equation \$y = (-?\d+)\(x - \((-?\d+)\)\)\^2 \+ \((-?\d+)\)\$ "
        r"is graphed in the coordinate plane\.",
        stimulus,
    )
    if not match:
        return None
    a, h, k = (int(value) for value in match.groups())
    coefficient = "" if a == 1 else ("-" if a == -1 else str(a))
    inner = "x"
    if h > 0:
        inner += f" - {h}"
    elif h < 0:
        inner += f" + {abs(h)}"
    constant = ""
    if k > 0:
        constant = f" + {k}"
    elif k < 0:
        constant = f" - {abs(k)}"
    return (
        f"The equation $y = {coefficient}({inner})^2{constant}$ is graphed in "
        "the coordinate plane."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]
    if len(questions) != 10_000:
        raise SystemExit(f"refusing to polish: expected 10,000 items, found {len(questions)}")
    by_id = {question["id"]: question for question in questions}
    changes: list[tuple[str, str, str, object]] = []

    def set_question(question: dict, field: str, value: object) -> None:
        if question.get(field) != value:
            changes.append(("questions", field, question["id"], value))
            question[field] = value

    def set_key(question: dict, field: str, value: object) -> None:
        if question.get(field) != value:
            changes.append(("question_keys", field, question["id"], value))
            question[field] = value

    # 1. Currency in the percent family and the affected R&W passages.
    for question in questions:
        if question["id"].startswith("M-TOP-") and question["skill"] == "Percentages":
            set_question(question, "stimulus", escape_currency(question.get("stimulus") or ""))
            set_key(question, "explanation", escape_currency(question.get("explanation") or ""))
            choices = question.get("choices") or []
            for choice in choices:
                choice["text"] = escape_currency(choice.get("text") or "")
            set_question(question, "choices", choices)
        if question["id"] in CURRENCY_RW_IDS:
            for field in ("stimulus", "prompt"):
                set_question(question, field, escape_currency(question.get(field) or ""))
            set_key(question, "explanation", escape_currency(question.get("explanation") or ""))
            choices = question.get("choices") or []
            for choice in choices:
                choice["text"] = escape_currency(choice.get("text") or "")
            set_question(question, "choices", choices)

    # 2. Context-correct prompts for the 280 linear-rate items.
    for question in questions:
        if not question["id"].startswith("M-TOP-"):
            continue
        stimulus = question.get("stimulus") or ""
        for prefix, prompt in RATE_PROMPTS.items():
            if stimulus.startswith(prefix):
                set_question(question, "prompt", prompt)
                explanation = question.get("explanation") or ""
                explanation = explanation.replace(
                    "The model is start plus rate times cycles:",
                    "The total equals the starting value plus the repeated amount "
                    "times the number of periods:",
                )
                set_key(question, "explanation", explanation)
                break

    # 3. Singular agreement in the probability family.
    for question in questions:
        if not question["id"].startswith("M-TOP-"):
            continue
        if question["skill"] != "Probability and conditional probability":
            continue
        stimulus = question.get("stimulus") or ""
        stimulus = re.sub(r"\b1 (red|blue) marbles\b", r"1 \1 marble", stimulus)
        stimulus = re.sub(r"\bThere are 1 (red|blue) marble\b", r"There is 1 \1 marble", stimulus)
        set_question(question, "stimulus", stimulus)
        explanation = question.get("explanation") or ""
        explanation = re.sub(r"\b1 (red|blue) marbles\b", r"1 \1 marble", explanation)
        explanation = re.sub(r"\bThere are 1 (red|blue) marble\b", r"There is 1 \1 marble", explanation)
        set_key(question, "explanation", explanation)

    # 4. Nonnegative sale-price distractors. Collisions are resolved by adding
    # five dollars until the value is distinct from every other choice.
    for question in questions:
        if not question["id"].startswith("M-TOP-") or question["skill"] != "Percentages":
            continue
        choices = question.get("choices") or []
        values = []
        for choice in choices:
            raw = (choice.get("text") or "").replace("\\$", "$")
            match = re.search(r"-?\d+(?:\.\d+)?", raw)
            if match:
                values.append(float(match.group(0)))
        for choice in choices:
            raw = (choice.get("text") or "").replace("\\$", "$")
            if not re.fullmatch(r"\$-?\d+(?:\.\d+)?", raw.strip()):
                continue
            if not raw.strip().startswith("$-"):
                continue
            old_value = abs(float(raw.strip()[2:]))
            candidate = old_value
            while candidate in values:
                candidate += 5
            values.append(candidate)
            choice["text"] = f"\\${candidate:g}"
            rationales = question.get("distractor_rationales") or {}
            rationales[choice["id"]] = (
                "This value does not equal the original price minus the discount."
            )
            set_key(question, "distractor_rationales", rationales)
        set_question(question, "choices", choices)

    # 5. A rectangle's area belongs to the area skill, not the volume skill.
    for question in questions:
        if question["id"].startswith("M-TOP-") and (question.get("stimulus") or "").startswith(
            "A rectangle has length"
        ):
            set_question(question, "skill", "Area and volume")

    # 6. Seven explanations that stated the conclusion without explaining it.
    for question_id, explanation in SHORT_EXPLANATIONS.items():
        question = by_id.get(question_id)
        if not question:
            raise SystemExit(f"missing short-rationale item {question_id}")
        set_key(question, "explanation", explanation)

    # 7. Replace brittle "Choice A/C/D" references with a description of the key.
    for question_id, replacements in CHOICE_REFERENCE_REPLACEMENTS.items():
        question = by_id.get(question_id)
        if not question:
            raise SystemExit(f"missing choice-reference item {question_id}")
        explanation = question.get("explanation") or ""
        for old, new in replacements:
            explanation = explanation.replace(old, new)
        set_key(question, "explanation", explanation)

    # 8. Remove generator-only coefficient 1 from top-up algebra and rewrite the
    # vertex-form stems with ordinary signs.
    for question in questions:
        if not question["id"].startswith("M-TOP-"):
            continue
        if question["skill"] == "Quadratic functions: vertex and symmetry":
            rewritten = vertex_stimulus(question.get("stimulus") or "")
            if rewritten:
                set_question(question, "stimulus", rewritten)
        for field in ("stimulus", "prompt"):
            set_question(question, field, strip_math_style(question.get(field) or ""))
        set_key(question, "explanation", strip_math_style(question.get("explanation") or ""))
        choices = question.get("choices") or []
        for choice in choices:
            choice["text"] = strip_math_style(choice.get("text") or "")
        set_question(question, "choices", choices)

    bank["bank_version"] = args.version
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lines = [
        "-- Second question-quality polish pass",
        f"-- bank_version: {args.version}",
        f"-- generated_at: {bank['generated_at']}",
        "",
        "BEGIN;",
        "",
    ]
    for table, field, question_id, value in changes:
        if table == "questions":
            if field in {"choices", "figure_metadata"}:
                sql_value = iq._sql_json(value)
            else:
                sql_value = iq._sql_str(value)
            lines.append(
                f"UPDATE public.questions SET {field} = {sql_value}, updated_at = NOW() "
                f"WHERE id = {iq._sql_str(question_id)};"
            )
        else:
            if field == "distractor_rationales":
                sql_value = iq._sql_json(value)
            elif field == "acceptable_answers":
                sql_value = iq._sql_array(value)
            else:
                sql_value = iq._sql_str(value)
            lines.append(
                f"UPDATE public.question_keys SET {field} = {sql_value}, updated_at = NOW() "
                f"WHERE question_id = {iq._sql_str(question_id)};"
            )
    lines.extend(["", "COMMIT;", ""])
    SEED.write_text("\n".join(lines), encoding="utf-8")

    print(f"items: {len(questions)}")
    print(f"changed rows: {len(changes)}")
    print(f"changed questions: {len({row[2] for row in changes})}")
    print(f"wrote: {SEED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

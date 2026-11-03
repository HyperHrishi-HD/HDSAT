#!/usr/bin/env python3
"""Replace the one top-up item that duplicated an existing algebra item.

M-TOP-0480 reproduced M-ALG-65202's equation with different math delimiters.
The item is rewritten with a distinct equation and a fresh explanation, and a
repair seed updates the shipped row. The night-time prompt is also reworded so
it routes as a Text Structure and Purpose item.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import import_questions as iq  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
SEED = ROOT / "supabase" / "seed" / "0030_repair_topup_duplicate.sql"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    by_id = {question["id"]: question for question in bank["questions"]}
    target = by_id["M-TOP-0480"]

    stimulus = "Solve for $x$: $5x + 23 = 2x + 47$"
    prompt = "What is the value of $x$?"
    collisions = [
        question["id"] for question in bank["questions"]
        if question["id"] != target["id"]
        and question["stimulus"] == stimulus and question["prompt"] == prompt
    ]
    if collisions:
        raise SystemExit(f"replacement equation collides with {collisions}")

    target["stimulus"] = stimulus
    target["prompt"] = prompt
    target["choices"] = [
        {"id": "A", "text": "$12$"},
        {"id": "B", "text": "$8$"},
        {"id": "C", "text": "$5$"},
        {"id": "D", "text": "$7$"},
    ]
    target["correct_answer"] = "B"
    target["acceptable_answers"] = ["B"]
    target["explanation"] = (
        "Subtract $2x$ from both sides: $3x + 23 = 47$, so $3x = 24$ and "
        "$x = 8$. Substitution gives $5(8) + 23 = 63$ and $2(8) + 47 = 63$, "
        "so the two sides agree."
    )
    target["distractor_rationales"] = {
        "A": "Substituting 12 gives $5(12) + 23 = 83$, while $2(12) + 47 = 71$.",
        "C": "Substituting 5 gives $5(5) + 23 = 48$, while $2(5) + 47 = 57$.",
        "D": "Substituting 7 gives $5(7) + 23 = 58$, while $2(7) + 47 = 61$.",
    }

    prompt_item = by_id["RW-M10P-0077"]
    prompt_item["prompt"] = (
        "Which choice best describes the function of the night-time measurements "
        "in the text?"
    )

    bank["bank_version"] = args.version
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lines = [
        "-- Repair the one duplicated top-up equation and one prompt route",
        f"-- generated_at: {datetime.now(timezone.utc).isoformat()}",
        "",
        "BEGIN;",
        "",
        "UPDATE public.questions SET "
        f"stimulus = {iq._sql_str(target['stimulus'])}, "
        f"prompt = {iq._sql_str(target['prompt'])}, "
        f"choices = {iq._sql_json(target['choices'])}, "
        f"correct_answer = {iq._sql_str(target['correct_answer'])}, "
        f"acceptable_answers = {iq._sql_array(target['acceptable_answers'])} "
        "WHERE id = 'M-TOP-0480';",
        "UPDATE public.question_keys SET "
        f"correct_answer = {iq._sql_str(target['correct_answer'])}, "
        f"acceptable_answers = {iq._sql_array(target['acceptable_answers'])}, "
        f"explanation = {iq._sql_str(target['explanation'])}, "
        f"distractor_rationales = {iq._sql_json(target['distractor_rationales'])} "
        "WHERE question_id = 'M-TOP-0480';",
        "UPDATE public.questions SET "
        f"prompt = {iq._sql_str(prompt_item['prompt'])} "
        "WHERE id = 'RW-M10P-0077';",
        "",
        "COMMIT;",
        "",
    ]
    SEED.write_text("\n".join(lines), encoding="utf-8")
    print(f"rewrote M-TOP-0480 and RW-M10P-0077; wrote {SEED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

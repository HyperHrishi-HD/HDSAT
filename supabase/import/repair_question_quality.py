#!/usr/bin/env python3
"""Repair the remaining question-quality defects in place.

Two narrow defects survived the earlier passes:

* 34 Reading & Writing rationales were still under the audit's word floor once
  the per-choice notes were counted. Each gets a skill-specific closing
  sentence that states why the key is the only supportable choice.
* Nine quantitative prompts carried a duplicated article ("countries' the
  adult literacy rate"). The extra "the" is removed.

The script rewrites the bank, bumps its version, and emits an idempotent seed
with only the changed rows so the live catalogue can be repaired too.

Usage:
    python supabase/import/repair_question_quality.py --version 2026.11.03-open-core-33
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
sys.path.insert(0, str(ROOT / "tools"))

import import_questions as iq  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
SEED = ROOT / "supabase" / "seed" / "0029_repair_rationales_prompts.sql"

CLOSERS = {
    "Inferences": (
        "The keyed choice follows from the passage's stated relationship, while "
        "the other options either contradict it or go beyond what the text supports."
    ),
    "Text Structure and Purpose": (
        "The keyed choice matches the passage's actual movement and purpose, while "
        "the other options describe content or functions the text does not contain."
    ),
    "Command of Evidence (Textual)": (
        "The keyed quotation directly supports the claim, while the other quotations "
        "address different points or leave the claim unsupported."
    ),
}


def rationale_words(question: dict) -> int:
    text = str(question.get("explanation") or "")
    for note in (question.get("distractor_rationales") or {}).values():
        text += " " + str(note or "")
    return len(text.split())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    changed: list[tuple[str, str, str]] = []

    for question in bank["questions"]:
        if question.get("section") != "Reading and Writing":
            continue
        if rationale_words(question) < 25:
            closer = CLOSERS.get(question.get("skill"))
            if closer:
                question["explanation"] = (
                    str(question.get("explanation") or "").rstrip() + " " + closer
                )
                changed.append(("explanation", question["id"], question["explanation"]))

        prompt = str(question.get("prompt") or "")
        fixed = prompt.replace("countries' the ", "countries' ")
        if fixed != prompt:
            question["prompt"] = fixed
            changed.append(("prompt", question["id"], fixed))

    bank["bank_version"] = args.version
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lines = [
        "-- Question-quality repairs (rationale length, duplicated article)",
        f"-- generated_at: {datetime.now(timezone.utc).isoformat()}",
        "",
        "BEGIN;",
        "",
    ]
    for field, qid, value in changed:
        if field == "prompt":
            lines.append(
                f"UPDATE public.questions SET prompt = {iq._sql_str(value)} "
                f"WHERE id = {iq._sql_str(qid)};"
            )
        else:
            lines.append(
                f"UPDATE public.question_keys SET explanation = {iq._sql_str(value)} "
                f"WHERE question_id = {iq._sql_str(qid)};"
            )
    lines.extend(["", "COMMIT;", ""])
    SEED.write_text("\n".join(lines), encoding="utf-8")

    print(f"changed {len(changed)} rows; wrote {SEED}")
    for field, qid, _ in changed:
        print(f"  {field}: {qid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

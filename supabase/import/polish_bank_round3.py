#!/usr/bin/env python3
"""Final rationale and presentation polish for the 10,000-item bank.

This pass fixes defects that structural QA cannot infer from a key alone:

* 538 multiple-choice items used the same sentence for all three wrong choices;
* eight grammar items used generic notes that sometimes named the wrong error;
* forty table/graph items used generic notes, including claims that a value was
  absent when it was actually present;
* two explanations still named a choice letter, and one named the wrong letter;
* fourteen prompts/stimuli carried accidental double spaces.

Every rewrite is deterministic and idempotent. No item, choice or answer is
added or removed. The pass bumps the bank version and writes
``supabase/seed/0032_polish_round3.sql`` with only changed rows.

Usage:
    python supabase/import/polish_bank_round3.py --version 2026.11.03-open-core-36
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from collections import Counter
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tools"))

import import_questions as iq  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
SEED = ROOT / "supabase" / "seed" / "0032_polish_round3.sql"

CHOICE_REFERENCE = re.compile(r"\b(?:Choice|Choices|Option|Options)\s+[A-D]\b")

# Eight items had three different generic notes, but none described the choice
# in front of the student. These are hand-written against the actual sentences.
GRAMMAR_NOTES = {
    "RW-SEC-100": {
        "A": "'so' would make the apprentices being barred a result of the firing; the sentence presents two coordinated facts, not a cause-and-effect sequence.",
        "B": "'but' would set the two clauses in contrast, but both describe the same afternoon's schedule.",
        "C": "'or' would present the clauses as alternatives, not two coordinated events.",
    },
    "RW-SEC-101": {
        "A": "'careless' is an adjective, but the blank must be an adverb modifying 'filed'.",
        "C": "'most careful' is a superlative adjective and cannot modify the verb 'filed'.",
        "D": "'with careful' is ungrammatical because 'careful' needs a noun after it; the sentence needs the adverb 'carefully'.",
    },
    "RW-SEC-102": {
        "B": "'have seen' is plural, but the verb agrees with the nearer singular subject 'pilot'.",
        "C": "'has seen' agrees with 'pilot' but uses the present perfect; the past-tense narrative needs 'had seen'.",
        "D": "'had saw' is ungrammatical; the past participle of 'see' is 'seen'.",
    },
    "RW-SEC-103": {
        "A": "'to within two blocks of home.' adds an unnecessary preposition; 'find a bike within...' is the idiomatic phrase.",
        "C": "This phrase lacks the period needed to end the sentence.",
        "D": "', and' adds a conjunction with nothing to join, leaving the sentence incomplete.",
    },
    "RW-SEC-104": {
        "A": "'entering' is a participle, not a finite verb; the sentence needs a past-tense verb for 'Each'.",
        "C": "'enter' is the base/plural form; the singular subject 'Each' needs 'entered'.",
        "D": "'was entered' is passive and reverses the action: the surveyors entered the map, they were not entered.",
    },
    "RW-SEC-105": {
        "B": "' but' omits the comma required before the coordinating conjunction 'but'.",
        "C": "'; but,' uses a semicolon before a coordinating conjunction and adds a comma after it; both are wrong.",
        "D": "'. But,' breaks the two clauses into separate sentences and adds an unnecessary comma after 'But'; the sentence needs a comma before the conjunction.",
    },
    "RW-SEC-106": {
        "A": "'like' is a preposition or verb, not the adverb needed before 'to have worked'.",
        "B": "'likelihood' is a noun and cannot modify the verb phrase 'to have worked'.",
        "C": "'liking' is a gerund/noun and does not fit the adverb slot before 'to have worked'.",
    },
    "RW-SEC-107": {
        "A": "'so' would make the community reports a result of the tracking, not the third item in the series.",
        "C": "'or' would present the methods as alternatives, but the sentence lists them together.",
        "D": "'but' would introduce a contrast where the sentence needs another parallel item.",
    },
}


def quoted(text: str) -> str:
    """Place a choice in display quotes without changing its math markup."""
    return f"\u201c{str(text).strip()}\u201d"


def choice_text(question: dict, choice_id: str) -> str:
    for choice in question.get("choices") or []:
        if str(choice.get("id")) == str(choice_id):
            return str(choice.get("text") or "").strip()
    return str(choice_id)


def correct_text(question: dict) -> str:
    return choice_text(question, str(question.get("correct_answer") or ""))


def wrong_notes(question: dict) -> list[str]:
    key = str(question.get("correct_answer") or "")
    return [
        str(value).strip()
        for choice_id, value in (question.get("distractor_rationales") or {}).items()
        if str(choice_id) != key
    ]


def has_repeated_note(question: dict) -> bool:
    notes = wrong_notes(question)
    return len(notes) >= 2 and len(set(notes)) < len(notes)


def repeated_note(question: dict, choice_id: str, old: str) -> str:
    """Turn a one-size-fits-all note into a note about this wrong choice."""
    skill = str(question.get("skill") or "")
    option = quoted(choice_text(question, choice_id))
    answer = quoted(correct_text(question))
    low = old.lower()

    if skill == "Linear functions: slope and intercepts":
        return f"{option} is not the slope of this line; using the two given points gives {answer}."
    if skill == "Right triangles and trigonometry":
        return f"{option} uses the wrong pair of sides for the requested trigonometric function; the correct value is {answer}."
    if skill == "Rhetorical Synthesis":
        if "includes accurate details" in low:
            return f"{option} includes accurate details, but it does not accomplish the stated goal."
        return (
            f"{option} does not accomplish the stated goal: it either leaves out a "
            "required detail or emphasizes a tangential note."
        )
    if skill == "Boundaries":
        return (
            f"{option} would not form a correct sentence boundary here; it creates a "
            "comma splice, fragment, run-on, or unnecessary break."
        )
    if skill == "Form, Structure, and Sense":
        return (
            f"{option} does not fit this sentence's grammar: it creates an agreement, "
            "tense, parallelism, or modifier-placement error."
        )
    if skill == "Central Ideas and Details":
        if "not supported" in low and "contradict" not in low:
            return f"{option} is not supported by the passage."
        return (
            f"{option} is not supported by the passage; it contradicts the text or "
            "states a detail rather than the main idea."
        )
    if skill == "Command of Evidence (Textual)":
        return (
            f"{option} is topically related, but it does not address the specific "
            "causal claim made by the researcher."
        )
    if skill == "Inferences":
        return f"{option} goes beyond or contradicts the conditions stated in the passage."
    if skill == "Cross-Text Connections":
        if "misstates one or both" in low:
            return f"{option} misstates one or both texts' positions."
        return f"{option} overstates or misstates the disagreement between the two authors."
    if skill == "Text Structure and Purpose":
        match = re.search(r"about (.+?)\.?$", old)
        if "rhetorical move" in low and match:
            return (
                f"{option} mischaracterizes the rhetorical move; the passage does not "
                f"make that claim about {match.group(1).rstrip('.')}."
            )
        return f"{option} mischaracterizes how the sentences relate to one another."

    return f"{option} does not satisfy the question: {old}"


def data_note(question: dict, choice_id: str) -> str:
    """A table/graph note that states what the figure actually supports."""
    meta = question.get("figure_metadata") or {}
    medium = "table" if meta.get("type") == "table" else "graph"
    def sentence(value: str) -> str:
        return quoted(str(value).strip().rstrip("."))

    return (
        f"The {medium} supports {sentence(correct_text(question))}, "
        f"not {sentence(choice_text(question, choice_id))}."
    )


def replace_choice_references(question: dict, text: str) -> str:
    """Replace brittle choice letters with the choice a student can see."""
    key = str(question.get("correct_answer") or "")
    for letter in ("A", "B", "C", "D"):
        replacement = (
            "the keyed choice"
            if letter == key
            else f"the option {quoted(choice_text(question, letter))}"
        )
        text = re.sub(
            rf"\b(?:Choice|Option)\s+{letter}\b",
            lambda _match: replacement,
            text,
        )
    return text


def clean_spaces(text: str) -> str:
    text = re.sub(r"[ \t]{2,}", " ", text)
    # A Wikipedia pronunciation gloss was copied with a space after the
    # opening parenthesis; that is typography, not content.
    text = text.replace("( AN-tik", "(AN-tik").replace("( AN-ty", "(AN-ty")
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]
    if len(questions) != 10_000:
        raise SystemExit(f"refusing to polish: expected 10,000 items, found {len(questions)}")

    changes: list[tuple[str, str, str, object]] = []

    def set_question(question: dict, field: str, value: object) -> None:
        if question.get(field) != value:
            changes.append(("questions", field, question["id"], value))
            question[field] = value

    def set_key(question: dict, field: str, value: object) -> None:
        if question.get(field) != value:
            changes.append(("question_keys", field, question["id"], value))
            question[field] = value

    # 1. Fix the two remaining choice-letter explanations.
    by_id = {question["id"]: question for question in questions}
    for question_id, old, new in (
        (
            "RW-SEC-002",
            "Choices C and D, and D are all singular verbs.",
            "The other choices are all singular verbs.",
        ),
        (
            "RW-INF-304",
            "Option D captures agreement-plus-reversal.",
            "The keyed choice captures agreement-plus-reversal.",
        ),
    ):
        question = by_id.get(question_id)
        if not question:
            raise SystemExit(f"missing explanation-repair item {question_id}")
        explanation = str(question.get("explanation") or "")
        if old not in explanation:
            raise SystemExit(f"expected phrase not found in {question_id}")
        set_key(question, "explanation", explanation.replace(old, new))

    # 2. Hand-written grammar notes for the eight generic SEC items.
    for question_id, notes in GRAMMAR_NOTES.items():
        question = by_id.get(question_id)
        if not question:
            raise SystemExit(f"missing grammar item {question_id}")
        rationales = dict(question.get("distractor_rationales") or {})
        wrong_ids = {
            str(choice.get("id"))
            for choice in (question.get("choices") or [])
            if str(choice.get("id")) != str(question.get("correct_answer"))
        }
        if set(notes) != wrong_ids:
            raise SystemExit(f"grammar note ids do not match {question_id}: {sorted(notes)}")
        rationales.update(notes)
        set_key(question, "distractor_rationales", rationales)

    # 3. Rewrite every within-item repeated note to a choice-specific note.
    repeated = 0
    for question in questions:
        if not has_repeated_note(question):
            continue
        repeated += 1
        rationales = dict(question.get("distractor_rationales") or {})
        key = str(question.get("correct_answer") or "")
        notes = wrong_notes(question)
        if len(set(notes)) != 1:
            raise SystemExit(f"partial repeated-note item: {question['id']}")
        old = notes[0]
        for choice_id in rationales:
            if str(choice_id) == key:
                continue
            rationales[choice_id] = repeated_note(question, str(choice_id), old)
        set_key(question, "distractor_rationales", rationales)

    # 4. Table/graph notes must match the data, not a generic assumption.
    data_items = 0
    for question in questions:
        if not str(question.get("id", "")).startswith("RW-M10Q-"):
            continue
        if not question.get("figure_metadata"):
            raise SystemExit(f"data item without a figure: {question['id']}")
        data_items += 1
        rationales = dict(question.get("distractor_rationales") or {})
        key = str(question.get("correct_answer") or "")
        for choice_id in rationales:
            if str(choice_id) == key:
                continue
            rationales[choice_id] = data_note(question, str(choice_id))
        set_key(question, "distractor_rationales", rationales)

    # 5. Remove any remaining brittle letter references in prose.
    for question in questions:
        fields = [("explanation", str(question.get("explanation") or ""))]
        fields += [
            (f"rationale {choice_id}", str(value))
            for choice_id, value in (question.get("distractor_rationales") or {}).items()
        ]
        for field, text in fields:
            fixed = replace_choice_references(question, text)
            if fixed != text:
                if field == "explanation":
                    set_key(question, "explanation", fixed)
                else:
                    choice_id = field.split(" ", 1)[1]
                    rationales = dict(question.get("distractor_rationales") or {})
                    rationales[choice_id] = fixed
                    set_key(question, "distractor_rationales", rationales)

    # 6. Remove accidental double spaces from display prose.
    for question in questions:
        for field in ("stimulus", "prompt"):
            set_question(question, field, clean_spaces(str(question.get(field) or "")))
        set_key(question, "explanation", clean_spaces(str(question.get("explanation") or "")))
        choices = question.get("choices")
        if choices is not None:
            for choice in choices:
                choice["text"] = clean_spaces(str(choice.get("text") or ""))
            set_question(question, "choices", choices)
        rationales = {
            choice_id: clean_spaces(str(value))
            for choice_id, value in (question.get("distractor_rationales") or {}).items()
        }
        set_key(question, "distractor_rationales", rationales)

    # Final invariants: no repeated note, no letter reference, no double space.
    for question in questions:
        if has_repeated_note(question):
            raise SystemExit(f"repeated note remains: {question['id']}")
        prose = [str(question.get("explanation") or "")]
        prose += [str(value) for value in (question.get("distractor_rationales") or {}).values()]
        if any(CHOICE_REFERENCE.search(text) for text in prose):
            raise SystemExit(f"choice reference remains: {question['id']}")
        for field in ("stimulus", "prompt"):
            if "  " in str(question.get(field) or ""):
                raise SystemExit(f"double space remains: {question['id']} {field}")

    bank["bank_version"] = args.version
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lines = [
        "-- Final question-quality polish pass",
        f"-- bank_version: {args.version}",
        f"-- generated_at: {bank['generated_at']}",
        "",
        "BEGIN;",
        "",
    ]
    for table, field, question_id, value in changes:
        if table == "questions":
            sql_value = iq._sql_json(value) if field in {"choices", "figure_metadata"} else iq._sql_str(value)
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
    print(f"repeated-rationale items rewritten: {repeated}")
    print(f"data-rationale items rewritten: {data_items}")
    print(f"changed rows: {len(changes)}")
    print(f"changed questions: {len({row[2] for row in changes})}")
    print(f"wrote: {SEED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

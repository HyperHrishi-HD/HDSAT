#!/usr/bin/env python3
"""Generate the report-repair SQL artifacts from the repaired bank.

The bank is the source of truth.  These artifacts are deliberately generated
from the difference between the pre-repair backup and the current bank, so a
stale field in either artifact is a generation error rather than a manual edit.

Usage:
    python tools/generate_report_sql.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src/data/questionBank.json"
BACKUP = ROOT / "tools/.bank.before-report-fix-20261123.json"
MIGRATION = ROOT / "supabase/migrations/20261123000100_question_report_repairs.sql"
SEED = ROOT / "supabase/seed/0099_question_report_repairs.sql"
TAG = "hdsat_report_fix"

QUESTION_COLUMNS = [
    "id",
    "external_id",
    "assessments",
    "section",
    "domain",
    "skill",
    "difficulty",
    "format",
    "stimulus",
    "prompt",
    "choices",
    "figure_metadata",
    "source_id",
    "source_name",
    "license",
    "attribution",
    "is_released_practice_set",
    "status",
]
KEY_COLUMNS = [
    "question_id",
    "correct_answer",
    "acceptable_answers",
    "explanation",
    "distractor_rationales",
]


def text(value: object) -> str:
    raw = "" if value is None else str(value)
    if f"${TAG}$" in raw:
        raise ValueError("content contains the SQL dollar-quote tag")
    return f"${TAG}${raw}${TAG}$"


def array(values: list[object]) -> str:
    return "ARRAY[" + ", ".join(text(value) for value in values) + "]::TEXT[]"


def jsonb(value: object) -> str:
    if value is None:
        return "NULL"
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if f"${TAG}$" in raw:
        raise ValueError("JSON contains the SQL dollar-quote tag")
    return f"${TAG}${raw}${TAG}$::jsonb"


def write_sql(path: Path, content: str) -> None:
    """Write LF exactly; Windows newline translation must not enter SQL text."""
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def changed_rows() -> tuple[dict, dict[str, dict], list[str]]:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    before = json.loads(BACKUP.read_text(encoding="utf-8"))
    old = {question["id"]: question for question in before["questions"]}
    new = {question["id"]: question for question in bank["questions"]}
    if set(old) - set(new):
        raise ValueError(f"bank rows disappeared: {sorted(set(old) - set(new))[:5]}")
    changed = [question_id for question_id in new if old.get(question_id) != new[question_id]]
    return bank, new, changed


def header(bank: dict, changed_count: int, artifact: str) -> list[str]:
    return [
        f"-- HDSAT question-bank report repairs ({artifact}).",
        f"-- bank_version: {bank['bank_version']}",
        f"-- generated_at: {bank['generated_at']}",
        f"-- question_count: {len(bank['questions'])}",
        f"-- changed_question_count: {changed_count}",
        "-- Generated from src/data/questionBank.json; do not hand-edit.",
    ]


def migration(bank: dict, rows: dict[str, dict], changed: list[str]) -> str:
    lines = header(bank, len(changed), "live migration")
    lines.append("BEGIN;")
    for question_id in changed:
        question = rows[question_id]
        question_fields = [
            f"stimulus = {text(question.get('stimulus'))}",
            f"prompt = {text(question.get('prompt'))}",
            f"choices = {jsonb(question.get('choices'))}",
            f"figure_metadata = {jsonb(question.get('figure_metadata'))}",
            f"skill = {text(question.get('skill'))}",
            f"domain = {text(question.get('domain'))}",
            f"difficulty = {text(question.get('difficulty'))}",
            f"format = {text(question.get('format'))}",
            f"assessments = {array(question.get('assessments') or [])}",
            "updated_at = NOW()",
        ]
        lines.append(
            "UPDATE public.questions SET "
            + ", ".join(question_fields)
            + f" WHERE id = {text(question_id)};"
        )
        key_fields = [
            f"correct_answer = {text(question.get('correct_answer'))}",
            f"acceptable_answers = {array(question.get('acceptable_answers') or [])}",
            f"explanation = {text(question.get('explanation'))}",
            f"distractor_rationales = {jsonb(question.get('distractor_rationales') or {})}",
            "updated_at = NOW()",
        ]
        lines.append(
            "UPDATE public.question_keys SET "
            + ", ".join(key_fields)
            + f" WHERE question_id = {text(question_id)};"
        )
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def seed(bank: dict, rows: dict[str, dict], changed: list[str]) -> str:
    lines = header(bank, len(changed), "idempotent seed patch")
    values = []
    for question_id in changed:
        question = rows[question_id]
        values.append(
            "("
            + ", ".join(
                [
                    text(question_id),
                    text(question.get("external_id") or f"HDSAT-{question_id}"),
                    array(question.get("assessments") or []),
                    text(question.get("section")),
                    text(question.get("domain")),
                    text(question.get("skill")),
                    text(question.get("difficulty")),
                    text(question.get("format")),
                    text(question.get("stimulus")),
                    text(question.get("prompt")),
                    jsonb(question.get("choices")),
                    jsonb(question.get("figure_metadata")),
                    text(question.get("source_id")),
                    text(question.get("source_name")),
                    text(question.get("license")),
                    text(question.get("attribution")),
                    "TRUE" if question.get("is_released_practice_set") else "FALSE",
                    "'active'",
                ]
            )
            + ")"
        )
    lines.append(
        "INSERT INTO public.questions ("
        + ", ".join(QUESTION_COLUMNS)
        + ") VALUES\n"
        + ",\n".join(values)
        + "\nON CONFLICT (id) DO UPDATE SET "
        + ", ".join(f"{column} = EXCLUDED.{column}" for column in QUESTION_COLUMNS if column != "id")
        + ";"
    )

    values = []
    for question_id in changed:
        question = rows[question_id]
        values.append(
            "("
            + ", ".join(
                [
                    text(question_id),
                    text(question.get("correct_answer")),
                    array(question.get("acceptable_answers") or []),
                    text(question.get("explanation")),
                    jsonb(question.get("distractor_rationales") or {}),
                ]
            )
            + ")"
        )
    lines.append(
        "INSERT INTO public.question_keys ("
        + ", ".join(KEY_COLUMNS)
        + ") VALUES\n"
        + ",\n".join(values)
        + "\nON CONFLICT (question_id) DO UPDATE SET "
        + ", ".join(f"{column} = EXCLUDED.{column}" for column in KEY_COLUMNS if column != "question_id")
        + ";"
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    bank, rows, changed = changed_rows()
    write_sql(MIGRATION, migration(bank, rows, changed))
    write_sql(SEED, seed(bank, rows, changed))
    print(
        f"{MIGRATION}: {len(changed)} rows, {MIGRATION.stat().st_size} bytes; "
        f"{SEED}: {len(changed)} rows, {SEED.stat().st_size} bytes"
    )


if __name__ == "__main__":
    main()

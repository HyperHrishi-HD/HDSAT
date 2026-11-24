#!/usr/bin/env python3
"""Generate the local SQL seed for the official College Board bank.

The question content is written under the gitignored ``supabase/import/
collegeboard`` directory. The accompanying schema migration is source code and
contains no question text.

Usage:
    python tools/collegeboard_sql.py
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BANK = ROOT / "public" / "collegeBoardBank.json"
DEFAULT_OUT = ROOT / "supabase" / "import" / "collegeboard" / "0100_collegeboard_sat.sql"
TAG = "hdsat_cb"


def text(value: object) -> str:
    raw = "" if value is None else str(value)
    if f"${TAG}$" in raw:
        raise ValueError("content contains the SQL dollar-quote tag")
    return f"${TAG}${raw}${TAG}$"


def nullable_text(value: object) -> str:
    return "NULL" if value is None else text(value)


def array(values: list[object] | None) -> str:
    values = values or []
    return "ARRAY[" + ", ".join(text(value) for value in values) + "]::TEXT[]"


def jsonb(value: object) -> str:
    if value is None:
        return "NULL"
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if f"${TAG}$" in raw:
        raise ValueError("JSON contains the SQL dollar-quote tag")
    return f"${TAG}${raw}${TAG}$::jsonb"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    bank = json.loads(args.bank.read_text(encoding="utf-8"))
    questions = bank["questions"]
    source = bank["sources"][0]
    lines = [
        "-- HDSAT official College Board SAT question-bank seed.",
        f"-- bank_version: {bank['bank_version']}",
        f"-- generated_at: {datetime.now(timezone.utc).isoformat()}",
        f"-- question_count: {len(questions)}",
        "-- Contains third-party question content; keep this file out of git.",
        "BEGIN;",
        "INSERT INTO public.dataset_sources (source_id, name, license, license_url, provenance_summary, is_released_practice_set, is_official_college_board, record_count)",
        "VALUES ("
        + ", ".join(
            [
                text(source["source_id"]),
                text(source["name"]),
                text(source["license"]),
                text(source.get("license_url")),
                text(source.get("provenance_summary")),
                "FALSE",
                "TRUE",
                str(len(questions)),
            ]
        )
        + ") ON CONFLICT (source_id) DO UPDATE SET "
        + "name = EXCLUDED.name, license = EXCLUDED.license, license_url = EXCLUDED.license_url, "
        + "provenance_summary = EXCLUDED.provenance_summary, is_official_college_board = TRUE, record_count = EXCLUDED.record_count;",
    ]

    columns = [
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
        "in_practice_test",
        "unusable",
        "score_band",
        "status",
    ]
    values: list[str] = []
    for q in questions:
        values.append(
            "("
            + ", ".join(
                [
                    text(q["id"]),
                    text(q["external_id"]),
                    array(q.get("assessments")),
                    text(q["section"]),
                    text(q["domain"]),
                    text(q["skill"]),
                    text(q["difficulty"]),
                    text(q["format"]),
                    nullable_text(q.get("stimulus")),
                    text(q["prompt"]),
                    jsonb(q.get("choices")),
                    jsonb(q.get("figure_metadata")),
                    text(q["source_id"]),
                    text(q["source_name"]),
                    text(q["license"]),
                    text(q["attribution"]),
                    "FALSE",
                    "TRUE" if q.get("in_practice_test") else "FALSE",
                    "TRUE" if q.get("unusable") else "FALSE",
                    "NULL" if q.get("score_band") is None else str(int(q["score_band"])),
                    "'active'",
                ]
            )
            + ")"
        )
    conflict = " ON CONFLICT (id) DO UPDATE SET " + ", ".join(
        f"{column} = EXCLUDED.{column}" for column in columns if column != "id"
    ) + ";"
    for start in range(0, len(values), 25):
        lines.append(
            "INSERT INTO public.questions ("
            + ", ".join(columns)
            + ") VALUES\n"
            + ",\n".join(values[start : start + 25])
            + conflict
        )

    key_columns = [
        "question_id",
        "correct_answer",
        "acceptable_answers",
        "explanation",
        "distractor_rationales",
    ]
    values = []
    for q in questions:
        values.append(
            "("
            + ", ".join(
                [
                    text(q["id"]),
                    text(q["correct_answer"]),
                    array(q.get("acceptable_answers")),
                    text(q["explanation"]),
                    jsonb(q.get("distractor_rationales") or {}),
                ]
            )
            + ")"
        )
    key_conflict = " ON CONFLICT (question_id) DO UPDATE SET " + ", ".join(
        f"{column} = EXCLUDED.{column}"
        for column in key_columns
        if column != "question_id"
    ) + ";"
    for start in range(0, len(values), 25):
        lines.append(
            "INSERT INTO public.question_keys ("
            + ", ".join(key_columns)
            + ") VALUES\n"
            + ",\n".join(values[start : start + 25])
            + key_conflict
        )
    lines.append("COMMIT;")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"{args.out}: {len(questions)} questions and {len(questions)} keys, {args.out.stat().st_size} bytes")


if __name__ == "__main__":
    main()

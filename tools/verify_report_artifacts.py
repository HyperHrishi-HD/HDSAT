#!/usr/bin/env python3
"""Prove that the report SQL artifacts write exactly the repaired bank rows.

No database is required.  This check parses the SQL with the same statement
splitter used by supabase/import/apply_seed.py, independently reconstructs
every written question row and answer-key row, and compares it field-for-field
with src/data/questionBank.json.  It also checks the artifact headers, exact
changed-row set, and idempotent write shape.

Usage:
    python tools/verify_report_artifacts.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "supabase/import"))
from apply_seed import split_sql  # noqa: E402  (shared SQL statement splitter)

BANK = ROOT / "src/data/questionBank.json"
BACKUP = ROOT / "tools/.bank.before-report-fix-20261123.json"
MIGRATION = ROOT / "supabase/migrations/20261123000100_question_report_repairs.sql"
SEED = ROOT / "supabase/seed/0099_question_report_repairs.sql"
TAG = "hdsat_report_fix"

QUESTION_MIGRATION_FIELDS = {
    "stimulus",
    "prompt",
    "choices",
    "figure_metadata",
    "skill",
    "domain",
    "difficulty",
    "format",
    "assessments",
}
KEY_MIGRATION_FIELDS = {
    "correct_answer",
    "acceptable_answers",
    "explanation",
    "distractor_rationales",
}
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


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def strip_leading_comments(statement: str) -> str:
    lines = statement.splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith("--")):
        lines.pop(0)
    return "\n".join(lines).strip()


def split_top_level(value: str) -> list[str]:
    """Split commas outside dollar quotes, strings and brackets."""
    parts: list[str] = []
    start = 0
    depth = 0
    i = 0
    while i < len(value):
        char = value[i]
        if value.startswith("--", i):
            end = value.find("\n", i)
            i = len(value) if end == -1 else end
            continue
        if char == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", value[i:])
            if match:
                tag = match.group(0)
                end = value.find(tag, i + len(tag))
                if end == -1:
                    raise ValueError(f"unterminated dollar quote {tag!r}")
                i = end + len(tag)
                continue
        if char == "'":
            end = i + 1
            while end < len(value):
                if value[end] == "'":
                    if end + 1 < len(value) and value[end + 1] == "'":
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            i = end
            continue
        if char == '"':
            end = value.find('"', i + 1)
            if end == -1:
                raise ValueError("unterminated quoted identifier")
            i = end + 1
            continue
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(value[start:i].strip())
            start = i + 1
        i += 1
    parts.append(value[start:].strip())
    return [part for part in parts if part]


def find_keyword(value: str, keyword: str, start: int = 0) -> int:
    """Find a top-level SQL keyword outside quotes and brackets."""
    depth = 0
    i = start
    while i < len(value):
        char = value[i]
        if value.startswith("--", i):
            end = value.find("\n", i)
            i = len(value) if end == -1 else end
            continue
        if char == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", value[i:])
            if match:
                tag = match.group(0)
                end = value.find(tag, i + len(tag))
                if end == -1:
                    raise ValueError(f"unterminated dollar quote {tag!r}")
                i = end + len(tag)
                continue
        if char == "'":
            end = i + 1
            while end < len(value):
                if value[end] == "'":
                    if end + 1 < len(value) and value[end + 1] == "'":
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            i = end
            continue
        if char == '"':
            end = value.find('"', i + 1)
            if end == -1:
                raise ValueError("unterminated quoted identifier")
            i = end + 1
            continue
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif depth == 0 and value.startswith(keyword, i):
            before_ok = i == 0 or not (value[i - 1].isalnum() or value[i - 1] == "_")
            after = i + len(keyword)
            after_ok = after == len(value) or not (value[after].isalnum() or value[after] == "_")
            if before_ok and after_ok:
                return i
        i += 1
    return -1


def parse_scalar(raw: str) -> object:
    value = raw.strip().rstrip(";").strip()
    if value == "NULL":
        return None
    if value == "TRUE":
        return True
    if value == "FALSE":
        return False
    if value == "NOW()":
        return "NOW()"
    if value.startswith("ARRAY["):
        if not value.endswith("]::TEXT[]"):
            raise ValueError(f"unexpected array suffix: {value[-20:]}")
        inner = value[len("ARRAY[") : -len("]::TEXT[]")]
        if not inner.strip():
            return []
        return [parse_scalar(item) for item in split_top_level(inner)]
    match = re.match(rf"\${TAG}\$(.*?)\${TAG}\$", value, re.DOTALL)
    if match:
        content = match.group(1)
        suffix = value[match.end() :].strip()
        if suffix == "::jsonb":
            return json.loads(content)
        if suffix:
            raise ValueError(f"unexpected dollar-quoted suffix: {suffix}")
        return content
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    raise ValueError(f"cannot parse SQL value: {value[:80]!r}")


def parse_update(statement: str, table: str) -> tuple[str, dict[str, object]] | None:
    code = strip_leading_comments(statement)
    prefix = f"UPDATE public.{table} SET "
    if not code.startswith(prefix):
        return None
    body_start = len(prefix)
    where_at = find_keyword(code, "WHERE", body_start)
    if where_at == -1:
        raise ValueError(f"missing WHERE in {table} update")
    body = code[body_start:where_at].strip()
    id_clause = code[where_at + len("WHERE") :].strip()
    if table == "questions":
        if not id_clause.startswith("id = "):
            raise ValueError(f"unexpected questions WHERE: {id_clause[:40]!r}")
        question_id = parse_scalar(id_clause[len("id = ") :])
    else:
        if not id_clause.startswith("question_id = "):
            raise ValueError(f"unexpected keys WHERE: {id_clause[:40]!r}")
        question_id = parse_scalar(id_clause[len("question_id = ") :])
    if not isinstance(question_id, str):
        raise ValueError(f"non-string id: {question_id!r}")
    fields: dict[str, object] = {}
    for assignment in split_top_level(body):
        if " = " not in assignment:
            raise ValueError(f"bad assignment: {assignment[:80]!r}")
        name, raw = assignment.split(" = ", 1)
        fields[name.strip()] = parse_scalar(raw)
    return question_id, fields


def parse_seed_insert(statement: str, table: str) -> dict[str, dict[str, object]]:
    code = strip_leading_comments(statement)
    prefix = f"INSERT INTO public.{table} ("
    if not code.startswith(prefix):
        raise ValueError(f"expected {table} insert")
    open_at = len(prefix) - 1
    close_at = find_matching(code, open_at, "(", ")")
    columns = [item.strip() for item in code[open_at + 1 : close_at].split(",")]
    values_at = find_keyword(code, "VALUES", close_at + 1)
    if values_at == -1:
        raise ValueError(f"missing VALUES in {table} insert")
    conflict_at = find_keyword(code, "ON CONFLICT", values_at + len("VALUES"))
    if conflict_at == -1:
        raise ValueError(f"missing ON CONFLICT in {table} insert")
    rows = split_top_level(code[values_at + len("VALUES") : conflict_at].strip())
    result: dict[str, dict[str, object]] = {}
    for row in rows:
        if not (row.startswith("(") and row.endswith(")")):
            raise ValueError(f"bad row tuple: {row[:40]!r}")
        values = [parse_scalar(value) for value in split_top_level(row[1:-1])]
        if len(values) != len(columns):
            raise ValueError(f"{table} row has {len(values)} values for {len(columns)} columns")
        record = dict(zip(columns, values))
        identifier = record.get("id") or record.get("question_id")
        if not isinstance(identifier, str):
            raise ValueError(f"{table} row has no string id")
        if identifier in result:
            raise ValueError(f"duplicate {table} row {identifier}")
        result[identifier] = record
    return result


def find_matching(value: str, start: int, opening: str, closing: str) -> int:
    depth = 0
    i = start
    while i < len(value):
        char = value[i]
        if char == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", value[i:])
            if match:
                tag = match.group(0)
                end = value.find(tag, i + len(tag))
                if end == -1:
                    raise ValueError(f"unterminated dollar quote {tag!r}")
                i = end + len(tag)
                continue
        if char == "'":
            end = i + 1
            while end < len(value):
                if value[end] == "'":
                    if end + 1 < len(value) and value[end + 1] == "'":
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            i = end
            continue
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unmatched {opening!r}")


def read_exact(path: Path) -> str:
    """Read without universal-newline translation so CRLF in SQL is visible."""
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def header_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in read_exact(path).splitlines()[:10]:
        match = re.match(r"--\s*(bank_version|generated_at|question_count|changed_question_count):\s*(.+)$", line)
        if match:
            values[match.group(1)] = match.group(2).strip()
    return values


def compare_fields(
    identifier: str,
    parsed: dict[str, object],
    expected: dict[str, object],
    fields: set[str],
    failures: list[str],
    *,
    allow_updated_at: bool = False,
    allowed_extra: set[str] | None = None,
) -> None:
    for field in fields:
        if field not in parsed:
            failures.append(f"{identifier}: missing field {field}")
        elif parsed[field] != expected.get(field):
            failures.append(f"{identifier}: {field} differs")
    extra = (
        set(parsed)
        - fields
        - ({"updated_at"} if allow_updated_at else set())
        - (allowed_extra or set())
    )
    if extra:
        failures.append(f"{identifier}: unexpected fields {sorted(extra)}")


def main() -> None:
    bank = json.loads(read_exact(BANK))
    before = json.loads(read_exact(BACKUP))
    old = {question["id"]: question for question in before["questions"]}
    new = {question["id"]: question for question in bank["questions"]}
    if set(old) - set(new):
        fail(f"bank rows disappeared: {sorted(set(old) - set(new))[:5]}")
    changed = [question_id for question_id in new if old.get(question_id) != new[question_id]]
    expected = {question_id: new[question_id] for question_id in changed}
    expected_key_fields = set(KEY_MIGRATION_FIELDS)

    # Header metadata is the only place a question-bank version can be stored
    # without inventing a non-existent production metadata table.
    for path in (MIGRATION, SEED):
        metadata = header_values(path)
        expected_header = {
            "bank_version": bank["bank_version"],
            "generated_at": bank["generated_at"],
            "question_count": str(len(new)),
            "changed_question_count": str(len(changed)),
        }
        if metadata != expected_header:
            fail(f"{path.name} header {metadata!r} != {expected_header!r}")

    migration_statements = [
        statement for statement in split_sql(read_exact(MIGRATION))
        if strip_leading_comments(statement)
    ]
    migration_questions: dict[str, dict[str, object]] = {}
    migration_keys: dict[str, dict[str, object]] = {}
    for statement in migration_statements:
        code = strip_leading_comments(statement)
        if code in {"BEGIN", "COMMIT"}:
            continue
        if code.startswith("UPDATE public.questions"):
            parsed = parse_update(statement, "questions")
            assert parsed is not None
            identifier, fields = parsed
            if identifier in migration_questions:
                fail(f"duplicate migration question {identifier}")
            migration_questions[identifier] = fields
        elif code.startswith("UPDATE public.question_keys"):
            parsed = parse_update(statement, "question_keys")
            assert parsed is not None
            identifier, fields = parsed
            if identifier in migration_keys:
                fail(f"duplicate migration key {identifier}")
            migration_keys[identifier] = fields
        else:
            fail(f"unexpected migration statement: {code[:60]!r}")

    seed_statements = [
        statement for statement in split_sql(read_exact(SEED))
        if strip_leading_comments(statement)
    ]
    seed_questions: dict[str, dict[str, object]] = {}
    seed_keys: dict[str, dict[str, object]] = {}
    for statement in seed_statements:
        code = strip_leading_comments(statement)
        if code.startswith("INSERT INTO public.questions "):
            for identifier, record in parse_seed_insert(statement, "questions").items():
                if identifier in seed_questions:
                    fail(f"duplicate seed question {identifier}")
                seed_questions[identifier] = record
        elif code.startswith("INSERT INTO public.question_keys "):
            for identifier, record in parse_seed_insert(statement, "question_keys").items():
                if identifier in seed_keys:
                    fail(f"duplicate seed key {identifier}")
                seed_keys[identifier] = record
        else:
            fail(f"unexpected seed statement: {code[:60]!r}")

    if set(migration_questions) != set(expected):
        fail(
            "migration question id set differs: "
            f"missing={sorted(set(expected) - set(migration_questions))[:5]} "
            f"extra={sorted(set(migration_questions) - set(expected))[:5]}"
        )
    if set(migration_keys) != set(expected):
        fail(
            "migration key id set differs: "
            f"missing={sorted(set(expected) - set(migration_keys))[:5]} "
            f"extra={sorted(set(migration_keys) - set(expected))[:5]}"
        )
    if set(seed_questions) != set(expected):
        fail(
            "seed question id set differs: "
            f"missing={sorted(set(expected) - set(seed_questions))[:5]} "
            f"extra={sorted(set(seed_questions) - set(expected))[:5]}"
        )
    if set(seed_keys) != set(expected):
        fail(
            "seed key id set differs: "
            f"missing={sorted(set(expected) - set(seed_keys))[:5]} "
            f"extra={sorted(set(seed_keys) - set(expected))[:5]}"
        )

    failures: list[str] = []
    changed_fields: set[str] = set()
    for identifier, question in expected.items():
        for field in set(question) | set(old[identifier]):
            if question.get(field) != old[identifier].get(field):
                changed_fields.add(field)
        compare_fields(
            identifier,
            migration_questions[identifier],
            question,
            QUESTION_MIGRATION_FIELDS,
            failures,
            allow_updated_at=True,
        )
        compare_fields(identifier, migration_keys[identifier], question, KEY_MIGRATION_FIELDS, failures, allow_updated_at=True)
        seed_question = seed_questions[identifier]
        compare_fields(
            identifier,
            seed_question,
            question,
            set(QUESTION_COLUMNS) - {"status"},
            failures,
            allowed_extra={"status"},
        )
        if seed_question.get("status") != "active":
            failures.append(f"{identifier}: status is not active")
        compare_fields(
            identifier,
            seed_keys[identifier],
            question,
            set(KEY_COLUMNS) - {"question_id"},
            failures,
            allowed_extra={"question_id"},
        )
        if seed_keys[identifier].get("question_id") != identifier:
            failures.append(f"{identifier}: seed key question_id differs")

    if changed_fields - QUESTION_MIGRATION_FIELDS - KEY_MIGRATION_FIELDS:
        failures.append(f"changed fields not carried by migration: {sorted(changed_fields - QUESTION_MIGRATION_FIELDS - KEY_MIGRATION_FIELDS)}")
    if changed_fields - (set(QUESTION_COLUMNS) | set(KEY_COLUMNS)):
        failures.append(
            "changed fields not carried by seed: "
            f"{sorted(changed_fields - (set(QUESTION_COLUMNS) | set(KEY_COLUMNS)))}"
        )

    if not any("ON CONFLICT (id) DO UPDATE" in line for line in seed_statements):
        failures.append("seed questions insert is not an upsert")
    if not any("ON CONFLICT (question_id) DO UPDATE" in line for line in seed_statements):
        failures.append("seed keys insert is not an upsert")
    if any(strip_leading_comments(statement).startswith("INSERT") for statement in migration_statements):
        failures.append("migration unexpectedly inserts rows")
    if not all(
        strip_leading_comments(statement).startswith(("UPDATE", "BEGIN", "COMMIT"))
        for statement in migration_statements
    ):
        failures.append("migration contains a non-update/non-transaction statement")

    if failures:
        for failure in failures[:20]:
            print(f"FAIL: {failure}")
        print(f"FAIL: {len(failures)} comparison failures")
        raise SystemExit(1)

    print(f"PASS bank rows: {len(new)} total, {len(changed)} changed")
    print(f"PASS migration: {len(migration_questions)} questions, {len(migration_keys)} keys")
    print(f"PASS seed: {len(seed_questions)} questions, {len(seed_keys)} keys")
    print(f"PASS changed fields: {', '.join(sorted(changed_fields))}")
    print("PASS metadata headers match bank_version, generated_at and counts")
    print("PASS id sets are exact; upserts/updates are idempotent in shape")
    print("PASS field-for-field comparison against src/data/questionBank.json")


if __name__ == "__main__":
    main()

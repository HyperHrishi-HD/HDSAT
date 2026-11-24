#!/usr/bin/env python3
"""Normalize the locally harvested College Board bank for HDSAT.

This reads ``tools/.collegeboard/cb_sat_bank.json``, applies the Plan's
normalization rules, and writes ``public/collegeBoardBank.json``. The output is
gitignored: question content is local/deployment data, not repository source.

Usage:
    python tools/collegeboard_normalize.py
"""

from __future__ import annotations

import argparse
import html
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HARVEST = ROOT / "tools" / ".collegeboard" / "cb_sat_bank.json"
DEFAULT_OUT = ROOT / "public" / "collegeBoardBank.json"
DEFAULT_REPORT = ROOT / "tools" / ".collegeboard" / "normalize_report.json"
SOURCE_ID = "collegeboard-sat"
SOURCE_NAME = "College Board Official SAT Question Bank"
SOURCE_LICENSE = "College Board public question bank"
SOURCE_URL = "https://satsuiteeducatorquestionbank.collegeboard.org/"
LETTERS = list("ABCDEFGH")

FIGURE_PHRASE = re.compile(
    r"(?:"
    r"\bin the figure above\b|"
    r"\bthe figure above\b|"
    r"\bshown in the figure\b|"
    r"\bas shown in the figure\b|"
    r"\brefer to the figure\b|"
    r"\bthe graph shown\b|"
    r"\bshown in the graph\b|"
    r"\brefer to the table\b|"
    r"\bthe table above\b|"
    r"\bthe following table\b|"
    r"\btable shown\b|"
    r"\bfigure below\b|"
    r"\bshown below\b"
    r")",
    re.I,
)
MEDIA_TAG = re.compile(r"<\s*(?:img|svg|table|figure)\b", re.I)
MFENCED_OPEN = re.compile(r"<mfenced\b([^>]*)>", re.I)
ATTR_RE = re.compile(r"([A-Za-z_:][\w:.-]*)\s*=\s*(['\"])(.*?)\2", re.S)
TAG_TOKEN = re.compile(r"<[^>]+>|[^<]+", re.S)


def attrs(raw: str) -> dict[str, str]:
    return {match.group(1).lower(): html.unescape(match.group(3)) for match in ATTR_RE.finditer(raw)}


def split_top_level_elements(content: str) -> list[str]:
    """Split MathML content into top-level element chunks, keeping text."""
    chunks: list[str] = []
    current = ""
    depth = 0
    for token in TAG_TOKEN.findall(content):
        if token.startswith("</"):
            if depth > 0:
                depth -= 1
            current += token
            if depth == 0 and current.strip():
                chunks.append(current)
                current = ""
            continue
        if token.startswith("<"):
            self_closing = token.rstrip().endswith("/>")
            if depth == 0:
                if current.strip():
                    chunks.append(current)
                current = token
            else:
                current += token
            if not self_closing and not token.startswith(("<!", "<?")):
                depth += 1
            if self_closing and depth == 0 and current.strip():
                chunks.append(current)
                current = ""
            continue
        current += token
    if current.strip():
        chunks.append(current)
    return chunks


def normalize_mfenced(value: str) -> str:
    """Rewrite every <mfenced> to explicit <mo> fences; never drop its children."""
    if not value or "<mfenced" not in value.lower():
        return value
    for _ in range(8):
        updated = rewrite_mfenced_pass(value)
        if updated == value:
            break
        value = updated
    return value


def rewrite_mfenced_pass(value: str) -> str:
    """One balanced pass over <mfenced> elements, preserving all other markup."""
    output: list[str] = []
    cursor = 0
    while True:
        opening = re.search(r"<mfenced\b([^>]*)>", value[cursor:], re.I)
        if not opening:
            output.append(value[cursor:])
            break
        start = cursor + opening.start()
        output.append(value[cursor:start])
        parsed = attrs(opening.group(1))
        position = cursor + opening.end()
        depth = 1
        while depth and position < len(value):
            next_open = re.search(r"<mfenced\b", value[position:], re.I)
            next_close = re.search(r"</mfenced\s*>", value[position:], re.I)
            if not next_close:
                output.append(value[start:])
                return "".join(output)
            close_at = position + next_close.start()
            open_at = position + next_open.start() if next_open else None
            if open_at is not None and open_at < close_at:
                depth += 1
                position = open_at + len("<mfenced")
            else:
                depth -= 1
                if depth == 0:
                    inner = value[cursor + opening.end() : close_at]
                    chunks = split_top_level_elements(rewrite_mfenced_pass(inner))
                    separators = parsed.get("separators", ",")
                    if separators and len(chunks) > 1:
                        inner = f"<mo>{html.escape(separators[0])}</mo>".join(chunks)
                    else:
                        inner = "".join(chunks)
                    output.append(
                        f"<mrow><mo>{html.escape(parsed.get('open', '('))}</mo>"
                        f"{inner}<mo>{html.escape(parsed.get('close', ')'))}</mo></mrow>"
                    )
                    cursor = close_at + next_close.group(0).__len__()
                    break
                position = close_at + len("</mfenced>")
        else:
            output.append(value[start:])
            break
    return "".join(output)


def normalize_html(value: str | None) -> str:
    if not value:
        return ""
    return normalize_mfenced(value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def lookup_names(lookup: dict) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    domains: dict[str, str] = {}
    skills: dict[str, str] = {}
    codes: dict[str, str] = {}
    for section in (lookup.get("lookupData") or {}).get("domain", {}).values():
        for domain in section:
            name = str(domain.get("text") or "").strip()
            code = str(domain.get("primaryClassCd") or "").strip()
            if name:
                domains[name.lower()] = name
                if code:
                    codes[code] = name
            for skill in domain.get("skill", []):
                skill_name = str(skill.get("text") or "").strip()
                if skill_name:
                    skills[skill_name.lower()] = skill_name
    return domains, skills, codes


def canonical_name(raw: str | None, mapping: dict[str, str]) -> str:
    value = (raw or "").strip()
    return mapping.get(value.lower(), value)


def is_unusable(stem: str, stimulus: str) -> bool:
    text = f"{stimulus}\n{stem}"
    return bool(FIGURE_PHRASE.search(text) and not MEDIA_TAG.search(text))


def choice_records(content: dict) -> tuple[list[dict] | None, str | None]:
    options = content.get("answerOptions")
    if not isinstance(options, list) or not options:
        return None, "mcq has no answerOptions"
    choices: list[dict] = []
    for index, option in enumerate(options):
        if not isinstance(option, dict):
            return None, "answerOptions contains a non-object"
        text = normalize_html(option.get("content"))
        if not text:
            return None, "answerOptions contains an empty choice"
        choices.append({"id": LETTERS[index], "text": text})
    return choices, None


def normalize_record(item: dict, practice_ids: set[str], domains: dict[str, str], skills: dict[str, str]) -> tuple[dict | None, str | None]:
    stub = item.get("stub") or {}
    content = item.get("content") or {}
    external_id = str(content.get("externalid") or stub.get("external_id") or "").strip()
    if not external_id:
        return None, "missing external id"
    test = int(stub.get("_test") or 0)
    section = "Reading and Writing" if test == 1 else "Math" if test == 2 else ""
    if not section:
        return None, "missing test section"
    stem = normalize_html(content.get("stem"))
    stimulus = normalize_html(content.get("stimulus"))
    if not stem:
        return None, "empty stem"
    qtype = str(content.get("type") or "").strip().lower()
    if qtype == "mcq":
        choices, error = choice_records(content)
        if error:
            return None, error
        answer = content.get("correct_answer")
        if not isinstance(answer, list) or len(answer) != 1:
            return None, "mcq must have exactly one correct letter"
        correct = str(answer[0]).strip().upper()
        if correct not in {choice["id"] for choice in choices}:
            return None, "mcq correct letter is not a choice"
        acceptable = [correct]
        format_name = "multiple_choice"
    elif qtype == "spr":
        choices = None
        raw_answers = content.get("correct_answer")
        if not isinstance(raw_answers, list):
            raw_answers = []
        accepted = [str(answer).strip() for answer in raw_answers if str(answer).strip()]
        # Some payloads expose accepted forms in keys as well; UUID keys are not answers.
        for key in content.get("keys") or []:
            key = str(key).strip()
            if key and not re.fullmatch(r"[0-9a-fA-F-]{32,36}", key) and key not in accepted:
                accepted.append(key)
        if not accepted:
            return None, "spr has no accepted answer forms"
        correct = accepted[0]
        acceptable = accepted
        format_name = "spr"
    else:
        return None, f"unsupported type {qtype!r}"

    domain = canonical_name(stub.get("primary_class_cd_desc"), domains)
    skill = canonical_name(stub.get("skill_desc"), skills)
    if not domain or not skill:
        return None, "missing domain or skill"
    difficulty = str(stub.get("difficulty") or "").strip()
    difficulty = {"E": "Easy", "M": "Medium", "H": "Hard"}.get(difficulty, difficulty)
    if difficulty not in {"Easy", "Medium", "Hard"}:
        return None, f"unsupported difficulty {difficulty!r}"
    band = stub.get("score_band_range_cd")
    try:
        score_band = int(band) if band is not None else None
    except (TypeError, ValueError):
        score_band = None
    rationale = normalize_html(content.get("rationale")) or "Correct answer: " + correct
    return (
        {
            "id": f"cb-{external_id}",
            "external_id": external_id,
            "assessments": ["SAT"],
            "section": section,
            "domain": domain,
            "skill": skill,
            "difficulty": difficulty,
            "format": format_name,
            "stimulus": stimulus or None,
            "prompt": stem,
            "choices": choices,
            "figure_metadata": None,
            "source_id": SOURCE_ID,
            "source_name": SOURCE_NAME,
            "license": SOURCE_LICENSE,
            "attribution": f"{SOURCE_NAME} ({SOURCE_URL})",
            "is_released_practice_set": False,
            "in_practice_test": external_id in practice_ids,
            "unusable": is_unusable(stem, stimulus),
            "score_band": score_band,
            "correct_answer": correct,
            "acceptable_answers": acceptable,
            "explanation": rationale,
            "distractor_rationales": {},
        },
        None,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harvest", type=Path, default=DEFAULT_HARVEST)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    harvested = json.loads(args.harvest.read_text(encoding="utf-8"))
    lookup = harvested.get("lookup") or {}
    practice_ids = set(harvested.get("practice_ids") or [])
    domains, skills, _ = lookup_names(lookup)
    questions: list[dict] = []
    rejects: list[dict] = []
    duplicates: list[str] = []
    seen_ids: set[str] = set()
    for item in harvested.get("questions") or []:
        stub = item.get("stub") or {}
        external_id = str((item.get("content") or {}).get("externalid") or stub.get("external_id") or "")
        if external_id and external_id in seen_ids:
            duplicates.append(external_id)
            continue
        if external_id:
            seen_ids.add(external_id)
        record, error = normalize_record(item, practice_ids, domains, skills)
        if record is None:
            rejects.append(
                {
                    "external_id": (item.get("stub") or {}).get("external_id"),
                    "error": error,
                }
            )
        else:
            questions.append(record)
    # IDs are derived from the unique external id; assert instead of silently
    # emitting duplicates if College Board ever changes that contract.
    ids = [record["id"] for record in questions]
    if len(ids) != len(set(ids)):
        raise RuntimeError("normalized external IDs are not unique")

    counts = Counter((record["section"], record["domain"], record["difficulty"]) for record in questions)
    practice = sum(1 for record in questions if record["in_practice_test"])
    unusable = sum(1 for record in questions if record["unusable"])
    mfenced = sum(
        "<mfenced" in json.dumps(record)
        for record in questions
    )
    bank = {
        "bank_version": f"2026.11.24-collegeboard-{len(questions)}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "licensing_note": (
            "Official College Board SAT questions retrieved from the public Educator "
            "Question Bank API. Preserve attribution; do not commit the content bundle "
            "to source control. Availability is subject to College Board's terms."
        ),
        "sources": [
            {
                "source_id": SOURCE_ID,
                "name": SOURCE_NAME,
                "license": SOURCE_LICENSE,
                "license_url": SOURCE_URL,
                "provenance_summary": (
                    "Official SAT questions and rationales retrieved from College Board's "
                    "public Educator Question Bank API. Difficulty is College Board's "
                    "E/M/H rating; score_band is College Board's 1-7 band."
                ),
                "is_released_practice_set": False,
                "is_official_college_board": True,
                "record_count": len(questions),
            }
        ],
        "questions": questions,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(bank, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
        newline="\n",
    )
    report = {
        "generated_at": bank["generated_at"],
        "harvested": len(harvested.get("questions") or []),
        "normalized": len(questions),
        "duplicate_external_ids": duplicates,
        "rejects": rejects,
        "practice_test_overlap": practice,
        "unusable": unusable,
        "mfenced_remaining": mfenced,
        "counts": {
            f"{section}|{domain}|{difficulty}": count
            for (section, domain, difficulty), count in sorted(counts.items())
        },
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(
        f"Wrote {args.out} with {len(questions)} questions "
        f"({practice} practice-test overlap, {unusable} unusable, "
        f"{len(rejects)} rejects, {len(duplicates)} duplicate external IDs skipped)"
    )
    print(json.dumps(report["counts"], indent=2))
    if rejects:
        print(f"rejects report: {args.report}")


if __name__ == "__main__":
    main()

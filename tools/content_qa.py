#!/usr/bin/env python3
"""Content QA gate for the HDSAT question bank.

Runs before items enter the bank so a bad key, a duplicated stem or an
unrenderable figure never reaches a student. Every check is offline: it reads
the generated bank JSON and nothing else.

Usage:
    python tools/content_qa.py                              # report, gate on errors
    python tools/content_qa.py --json                       # machine report
    python tools/content_qa.py --fail-on warn               # stricter gate
    python tools/content_qa.py --sample 2 --max-near-duplicates 20

Exit codes: 0 clean enough, 1 fail threshold met, 2 unreadable input.

The same functions are importable so an importer can refuse to write rows:

    from content_qa import check_bank, exit_code_for
    report = check_bank(bank)
    if exit_code_for(report, "error"):
        raise SystemExit("bank failed content QA")

Console output is intentionally plain ASCII: the operator runs this on a
Windows console whose default code page is cp1252, and a decorative glyph
must never replace the report or crash the run.
"""
from __future__ import annotations

import argparse
import difflib
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict

DEFAULT_BANK = pathlib.Path(__file__).resolve().parent.parent / "src" / "data" / "questionBank.json"

VALID_SECTIONS = {"Reading and Writing", "Math"}
VALID_DIFFICULTIES = {"Easy", "Medium", "Hard"}
VALID_FORMATS = {"multiple_choice", "spr"}
VALID_ASSESSMENTS = {"SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"}

# Keep in step with parseFigureMeta() in src/components/FigureView.tsx.
FIGURE_TYPES = {"table", "bar_chart", "line_chart", "coordinate_plane", "geometry_figure"}
GEOMETRY_SHAPES = {"right_triangle", "triangle", "rectangle", "circle"}

# Stems are compared as character sequences: one or two edited words in an
# otherwise identical stem still score above 0.9, while two passages on
# different topics score far below it.
NEAR_DUPLICATE_THRESHOLD = 0.9
# Blocking: sort each section+skill group by the stem (and by its tail) and only
# compare neighbours. Near-duplicates necessarily sort close together, so this
# keeps the scan linear instead of 6193-squared.
NEIGHBOUR_WINDOW = 10
MIN_STEM_CHARS = 60
MAX_NEAR_DUPLICATE_SCAN = 5000

# A natural-language prompt at least this long is distinctive enough that an
# An identical stimulus+prompt is the duplicate check; a shared prompt template
# over different passages is normal in a real bank, so it is not flagged.

EXPLANATION_HARD_MIN = 20
EXPLANATION_WARN_MIN = 40

KEY_BIAS_MIN_ITEMS = 20
KEY_BIAS_SHARE = 0.45


def ascii_text(value: object) -> str:
    """Return text that is safe on a cp1252 console and through a UTF-8 pipe."""
    return str(value).encode("ascii", "replace").decode("ascii")


def normalise(text: object) -> str:
    """Lowercase, strip markup punctuation and collapse whitespace."""
    raw = ascii_text(text or "").lower()
    raw = raw.replace("\\(", " ").replace("\\)", " ").replace("$", " ")
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def choice_key(text: object) -> str:
    """Comparable choice text that keeps operators and punctuation.

    Stripping every symbol would make "3n + 2p" and "3n - 2p" look identical,
    which is the opposite of what this check is for. The same applies to a
    Boundaries item, where ", but", "but" and "; but" are three different
    choices that all collapse to "but" if the marks are discarded.
    """
    raw = ascii_text(text or "").lower()
    raw = raw.replace("\\(", " ").replace("\\)", " ").replace("$", " ")
    raw = re.sub(r"[^a-z0-9+\-*/=<>^.,;:!?\u2014\u2013]", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def similarity(left: str, right: str) -> float:
    """Character-sequence similarity of two normalised stems, 0.0 to 1.0."""
    if not left or not right:
        return 0.0
    matcher = difflib.SequenceMatcher(None, left, right, autojunk=False)
    if matcher.real_quick_ratio() < NEAR_DUPLICATE_THRESHOLD:
        return 0.0
    if matcher.quick_ratio() < NEAR_DUPLICATE_THRESHOLD:
        return 0.0
    return matcher.ratio()


def stem_of(question: dict) -> str:
    """One comparable string for an item: its stimulus plus its prompt."""
    parts = [question.get("stimulus") or "", question.get("prompt") or ""]
    return normalise(" ".join(part for part in parts if part))


class Report:
    """Collected issues plus the bank-level counts a gate needs."""

    def __init__(self, bank_path: str, version: str, total: int, sources: int):
        self.bank_path = bank_path
        self.version = version
        self.total = total
        self.sources = sources
        self.issues: list[dict] = []

    def add(
        self,
        category: str,
        severity: str,
        message: str,
        ids: list[str] | tuple[str, ...] = (),
        count: int | None = None,
        sample: int = 5,
    ) -> None:
        sample_ids = [ascii_text(item) for item in list(ids)[: max(0, sample)]]
        self.issues.append(
            {
                "category": category,
                "severity": severity,
                "message": ascii_text(message),
                "count": int(count if count is not None else max(1, len(sample_ids))),
                "ids": sample_ids,
            }
        )

    @property
    def errors(self) -> int:
        return sum(issue["count"] for issue in self.issues if issue["severity"] == "error")

    @property
    def warnings(self) -> int:
        return sum(issue["count"] for issue in self.issues if issue["severity"] == "warn")

    def by_category(self) -> dict[str, int]:
        totals: dict[str, int] = defaultdict(int)
        for issue in self.issues:
            totals[issue["category"]] += issue["count"]
        return dict(sorted(totals.items()))


def _figure_problem(meta: object) -> str | None:
    """Return a short reason string when a figure cannot be rendered, else None."""
    if not meta:
        return None
    if not isinstance(meta, dict):
        return "not an object"
    kind = meta.get("type")
    if kind not in FIGURE_TYPES:
        return f"unknown type {kind!r}"

    if kind == "table":
        headers = meta.get("headers")
        rows = meta.get("rows")
        if not isinstance(headers, list) or not headers:
            return "table has no headers"
        if not isinstance(rows, list) or not rows:
            return "table has no rows"
        for row in rows:
            if not isinstance(row, list) or len(row) != len(headers):
                return "table row width does not match headers"
        return None

    if kind in {"bar_chart", "line_chart"}:
        series = meta.get("series")
        if not isinstance(series, list) or not series:
            return "chart has no series"
        for point in series:
            if not isinstance(point, dict) or not isinstance(point.get("value"), (int, float)):
                return "chart point without a numeric value"
        return None

    if kind == "coordinate_plane":
        for low_key, high_key in (("x_min", "x_max"), ("y_min", "y_max")):
            low, high = meta.get(low_key), meta.get(high_key)
            if isinstance(low, (int, float)) and isinstance(high, (int, float)) and low >= high:
                return f"{low_key} is not below {high_key}"
        return None

    shape = meta.get("shape")
    if shape not in GEOMETRY_SHAPES:
        return f"unsupported geometry shape {shape!r}"
    return None


def near_duplicate_pairs(
    questions: list[dict],
    threshold: float = NEAR_DUPLICATE_THRESHOLD,
    scan_limit: int = MAX_NEAR_DUPLICATE_SCAN,
    window: int = NEIGHBOUR_WINDOW,
) -> tuple[list[tuple[str, str, float]], bool]:
    """Similar stems inside the same section and skill.

    Returns the pairs found (ids ordered) and whether the scan stopped early.
    Two blockings -- by the whole stem and by its tail -- make sure a shared
    ending still finds its neighbours when the openings differ.
    """
    prepared: list[tuple[dict, str]] = []
    for question in questions:
        stem = stem_of(question)
        if len(stem) >= MIN_STEM_CHARS:
            prepared.append((question, stem))
    if len(prepared) < 2:
        return [], False

    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for position, (question, _) in enumerate(prepared):
        groups[(str(question.get("section")), str(question.get("skill")))].append(position)

    candidates: set[tuple[int, int]] = set()
    for blocking in (lambda stem: stem, lambda stem: stem[-MIN_STEM_CHARS:]):
        for positions in groups.values():
            ordered = sorted(positions, key=lambda index: blocking(prepared[index][1]))
            for offset, first in enumerate(ordered):
                for second in ordered[offset + 1 : offset + 1 + window]:
                    candidates.add((min(first, second), max(first, second)))

    found: list[tuple[str, str, float]] = []
    seen: set[tuple[int, int]] = set()
    for first, second in sorted(candidates):
        left_question, left_stem = prepared[first]
        right_question, right_stem = prepared[second]
        if left_question.get("section") != right_question.get("section"):
            continue
        if left_question.get("skill") != right_question.get("skill"):
            continue
        if left_stem == right_stem:
            # Exact repeats belong to the duplicate-stem check, not here.
            continue
        score = similarity(left_stem, right_stem)
        if score < threshold:
            continue
        pair = (first, second)
        if pair in seen:
            continue
        seen.add(pair)
        found.append(
            (
                str(left_question.get("id")),
                str(right_question.get("id")),
                round(score, 3),
            )
        )
        if len(found) >= scan_limit:
            return found, True
    return found, False


def check_bank(
    bank: dict,
    bank_path: str = "<memory>",
    sample: int = 5,
    max_near_duplicates: int = 50,
) -> Report:
    """Run every check and return a Report. Never raises on bad item content."""
    questions = bank.get("questions") or []
    if not isinstance(questions, list):
        questions = []
    sources = {
        str(source.get("source_id")): source
        for source in (bank.get("sources") or [])
        if isinstance(source, dict)
    }
    report = Report(
        bank_path=bank_path,
        version=str(bank.get("bank_version") or ""),
        total=len(questions),
        sources=len(sources),
    )

    # --- Source-level checks -------------------------------------------------
    for source_id, source in sources.items():
        if not str(source.get("license") or "").strip():
            report.add("source.missing_license", "error", f"{source_id} has no licence", [source_id])
        if not str(source.get("name") or "").strip():
            report.add("source.missing_name", "error", f"{source_id} has no display name", [source_id])
        if not str(source.get("license_url") or "").strip():
            report.add(
                "source.missing_license_url",
                "warn",
                f"{source_id} has no licence URL",
                [source_id],
            )
        if not str(source.get("provenance_summary") or "").strip():
            report.add(
                "source.missing_provenance",
                "warn",
                f"{source_id} has no provenance summary",
                [source_id],
            )
        # A separate official dataset is allowed, but it must be auditable:
        # attribution and licence travel with the content.
        if source.get("is_official_college_board") and not str(source.get("license_url") or "").strip():
            report.add(
                "source.official_without_license_url",
                "error",
                f"official source {source_id} needs a licence URL before import",
                [source_id],
            )

    # --- Per-item checks -----------------------------------------------------
    id_counts: Counter[str] = Counter()
    stem_counts: dict[tuple[str, str], list[str]] = defaultdict(list)

    metadata_problems: dict[str, list[str]] = defaultdict(list)
    metadata_messages: dict[str, str] = {}
    key_problems: dict[str, list[str]] = defaultdict(list)
    key_messages: dict[str, str] = {}
    explanation_hard: list[str] = []
    explanation_soft: list[str] = []
    rationale_missing: list[str] = []
    rationale_orphan: list[str] = []
    figure_problems: dict[str, list[str]] = defaultdict(list)
    figure_messages: dict[str, str] = defaultdict(str)

    key_letters: dict[tuple[str, str, str], Counter[str]] = defaultdict(Counter)
    key_group_sizes: Counter[tuple[str, str, str]] = Counter()

    for question in questions:
        if not isinstance(question, dict):
            metadata_problems["metadata.not_an_object"].append("?")
            continue
        qid = str(question.get("id") or "").strip()
        label = qid or "<missing id>"
        id_counts[qid] += 1

        field = lambda name: str(question.get(name) or "").strip()  # noqa: E731

        if not qid:
            metadata_problems["metadata.missing_id"].append(label)
        section = field("section")
        if section not in VALID_SECTIONS:
            metadata_problems["metadata.unknown_section"].append(label)
            metadata_messages.setdefault(
                "metadata.unknown_section", f"section must be one of {sorted(VALID_SECTIONS)}"
            )
        if not field("domain"):
            metadata_problems["metadata.missing_domain"].append(label)
        if not field("skill"):
            metadata_problems["metadata.missing_skill"].append(label)
        if field("difficulty") not in VALID_DIFFICULTIES:
            metadata_problems["metadata.unknown_difficulty"].append(label)
            metadata_messages.setdefault(
                "metadata.unknown_difficulty",
                f"difficulty must be one of {sorted(VALID_DIFFICULTIES)}",
            )
        fmt = field("format")
        if fmt not in VALID_FORMATS:
            metadata_problems["metadata.unknown_format"].append(label)
            metadata_messages.setdefault(
                "metadata.unknown_format", f"format must be one of {sorted(VALID_FORMATS)}"
            )

        assessments = question.get("assessments") or []
        if (
            not isinstance(assessments, list)
            or not assessments
            or any(str(item) not in VALID_ASSESSMENTS for item in assessments)
        ):
            metadata_problems["metadata.unknown_assessment"].append(label)
            metadata_messages.setdefault(
                "metadata.unknown_assessment",
                f"assessments must be a non-empty subset of {sorted(VALID_ASSESSMENTS)}",
            )

        source_id = field("source_id")
        if not source_id or source_id not in sources:
            metadata_problems["metadata.unknown_source"].append(label)
            metadata_messages.setdefault(
                "metadata.unknown_source", "source_id is missing or not listed in bank sources"
            )
        if not field("license"):
            metadata_problems["source.missing_item_license"].append(label)
        if not field("attribution"):
            metadata_problems["source.missing_item_attribution"].append(label)
        elif source_id in sources and sources[source_id].get("is_official_college_board"):
            # Official items must name their owner, not just inherit the bank note.
            if "college board" not in field("attribution").lower():
                metadata_problems["source.official_attribution"].append(label)
                metadata_messages.setdefault(
                    "source.official_attribution",
                    "official College Board items must name College Board in their attribution",
                )

        stem = stem_of(question)
        prompt = normalise(question.get("prompt"))
        if stem:
            stem_counts[(section, stem)].append(label)

        # --- Answer key ------------------------------------------------------
        key = str(question.get("correct_answer") or "").strip()
        acceptable = question.get("acceptable_answers") or []
        if fmt == "multiple_choice":
            choices = question.get("choices") or []
            if not isinstance(choices, list) or not choices:
                key_problems["answer_key.no_choices"].append(label)
                key_messages.setdefault("answer_key.no_choices", "multiple-choice item has no choices")
            else:
                choice_ids = []
                seen_text: set[str] = set()
                duplicate_choice = False
                for choice in choices:
                    if not isinstance(choice, dict):
                        key_problems["answer_key.malformed_choice"].append(label)
                        continue
                    choice_id = str(choice.get("id") or "").strip()
                    choice_ids.append(choice_id)
                    # Emptiness is about the raw text; a punctuation-only choice
                    # (a colon, a semicolon) is a legitimate English-grammar option.
                    raw_text = ascii_text(choice.get("text") or "").strip()
                    text = choice_key(raw_text)
                    if not raw_text:
                        key_problems["answer_key.empty_choice"].append(label)
                    if text and text in seen_text:
                        duplicate_choice = True
                    if text:
                        seen_text.add(text)
                if not key:
                    key_problems["answer_key.missing"].append(label)
                elif key not in choice_ids:
                    key_problems["answer_key.not_in_choices"].append(label)
                    key_messages.setdefault(
                        "answer_key.not_in_choices",
                        "correct_answer is not the id of any choice",
                    )
                if duplicate_choice:
                    key_problems["answer_key.duplicate_choice_text"].append(label)
                if any(re.search(r"\b(all|none) of the above\b", normalise(c.get("text")) if isinstance(c, dict) else "") for c in choices):
                    key_problems["answer_key.above_style_choice"].append(label)
                    key_messages.setdefault(
                        "answer_key.above_style_choice",
                        "'all/none of the above' makes the key ambiguous",
                    )
                if key in choice_ids:
                    group = (section or "?", field("domain") or "?", field("skill") or "?")
                    key_group_sizes[group] += 1
                    key_letters[group][key] += 1
                # Rationales for every wrong choice.
                rationales = question.get("distractor_rationales") or {}
                if not isinstance(rationales, dict):
                    rationale_missing.append(label)
                else:
                    missing = [cid for cid in choice_ids if cid and cid != key and cid not in rationales]
                    if missing:
                        rationale_missing.append(label)
                    if any(str(cid) not in choice_ids for cid in rationales):
                        rationale_orphan.append(label)
        else:
            if not key:
                key_problems["answer_key.missing"].append(label)
            if not isinstance(acceptable, list) or not acceptable:
                key_problems["answer_key.no_acceptable_answers"].append(label)
                key_messages.setdefault(
                    "answer_key.no_acceptable_answers",
                    "SPR item has no acceptable_answers",
                )
            elif key and key not in [str(value).strip() for value in acceptable]:
                key_problems["answer_key.key_not_accepted"].append(label)
                key_messages.setdefault(
                    "answer_key.key_not_accepted",
                    "correct_answer is not listed in acceptable_answers",
                )

        # --- Explanation -----------------------------------------------------
        explanation = str(question.get("explanation") or "").strip()
        if len(explanation) < EXPLANATION_HARD_MIN:
            explanation_hard.append(label)
        elif len(explanation) < EXPLANATION_WARN_MIN:
            explanation_soft.append(label)

        # --- Figures ---------------------------------------------------------
        problem = _figure_problem(question.get("figure_metadata"))
        if problem:
            category = (
                "figure.unknown_type"
                if "unknown type" in problem or "unsupported geometry" in problem
                else "figure.invalid"
            )
            figure_problems[category].append(label)
            figure_messages[category] = problem

    # --- Aggregate item findings --------------------------------------------
    for qid, count in id_counts.items():
        if qid and count > 1:
            report.add("duplicate_id", "error", f"id {qid} appears {count} times", [qid], count=count)

    duplicate_stems = 0
    duplicate_examples: list[str] = []
    for (_, _), ids in stem_counts.items():
        if len(ids) > 1:
            duplicate_stems += len(ids) - 1
            if len(duplicate_examples) < sample:
                duplicate_examples.append(" = ".join(ids[:4]))
    if duplicate_stems:
        report.add(
            "duplicate_stem",
            "error",
            f"{duplicate_stems} item(s) repeat an identical stimulus+prompt",
            duplicate_examples,
            count=duplicate_stems,
        )

    pairs, scan_truncated = near_duplicate_pairs(questions)
    if pairs:
        shown = pairs[: max(0, max_near_duplicates)]
        examples = [f"{left} ~ {right} ({score:.2f})" for left, right, score in shown]
        note = ""
        if scan_truncated or len(pairs) > len(shown):
            note = " (examples capped; count may be partial for very large families)"
        report.add(
            "near_duplicate_stem",
            "warn",
            f"{len(pairs)} pair(s) of stems are at least {int(NEAR_DUPLICATE_THRESHOLD * 100)}% similar within a section and skill{note}",
            examples if examples else ["<pairs found>"],
            count=len(pairs),
            sample=len(examples),
        )
    for category, ids in key_problems.items():
        if not ids:
            continue
        severity = "warn" if category in {"answer_key.duplicate_choice_text", "answer_key.above_style_choice"} else "error"
        report.add(
            category,
            severity,
            key_messages.get(category, "answer key problem"),
            ids,
            count=len(ids),
        )

    if explanation_hard:
        report.add(
            "explanation.missing_or_tiny",
            "error",
            f"explanation shorter than {EXPLANATION_HARD_MIN} characters",
            explanation_hard,
            count=len(explanation_hard),
        )
    if explanation_soft:
        report.add(
            "explanation.short",
            "warn",
            f"explanation shorter than {EXPLANATION_WARN_MIN} characters",
            explanation_soft,
            count=len(explanation_soft),
        )
    if rationale_missing:
        report.add(
            "rationale.missing",
            "warn",
            "multiple-choice item without a rationale for every wrong choice",
            rationale_missing,
            count=len(rationale_missing),
        )
    if rationale_orphan:
        report.add(
            "rationale.orphan",
            "warn",
            "rationale keyed to a choice id that does not exist",
            rationale_orphan,
            count=len(rationale_orphan),
        )

    for category, ids in metadata_problems.items():
        if not ids:
            continue
        report.add(
            category,
            "error" if category.startswith(("metadata.", "source.")) else "warn",
            metadata_messages.get(category, category),
            ids,
            count=len(ids),
        )

    for category, ids in figure_problems.items():
        if not ids:
            continue
        report.add(
            category,
            "error",
            figure_messages.get(category, "figure cannot render"),
            ids,
            count=len(ids),
        )

    # --- Key bias ------------------------------------------------------------
    for group, counts in key_letters.items():
        total = key_group_sizes[group]
        if total < KEY_BIAS_MIN_ITEMS:
            continue
        letter, hits = counts.most_common(1)[0]
        share = hits / total
        if share > KEY_BIAS_SHARE:
            section, domain, skill = group
            report.add(
                "key_bias",
                "warn",
                f"{skill} ({domain}, {section}): key {letter} is {share * 100:.0f}% of {total} items",
                [f"{section} / {skill}"],
                count=1,
            )

    return report


def exit_code_for(report: Report, fail_on: str = "error") -> int:
    if fail_on == "none":
        return 0
    if fail_on == "warn":
        return 1 if (report.errors or report.warnings) else 0
    return 1 if report.errors else 0


def render_text(report: Report) -> str:
    lines: list[str] = []
    lines.append("HDSAT content QA")
    lines.append(f"bank: {ascii_text(report.bank_path)}")
    lines.append(f"version: {ascii_text(report.version) or '(none)'}")
    lines.append(f"items: {report.total}")
    lines.append(f"sources: {report.sources}")
    lines.append("")

    ordered = sorted(
        report.issues,
        key=lambda issue: (0 if issue["severity"] == "error" else 1, issue["category"]),
    )
    if not ordered:
        lines.append("No issues found.")
    for issue in ordered:
        marker = "ERROR" if issue["severity"] == "error" else "WARN "
        lines.append(f"{marker} {issue['category']} ({issue['count']}): {issue['message']}")
        for example in issue["ids"]:
            lines.append(f"      - {example}")
    lines.append("")
    lines.append(f"Summary: {report.total} items, {report.errors} errors, {report.warnings} warnings")
    by_category = report.by_category()
    if by_category:
        lines.append("By category: " + ", ".join(f"{name}={count}" for name, count in by_category.items()))
    return "\n".join(ascii_text(line) for line in lines)


def build_json(report: Report, fail_on: str, exit_code: int) -> dict:
    return {
        "bank": ascii_text(report.bank_path),
        "version": ascii_text(report.version),
        "items": report.total,
        "sources": report.sources,
        "issues": [
            {
                "category": issue["category"],
                "severity": issue["severity"],
                "message": issue["message"],
                "count": issue["count"],
                "ids": issue["ids"],
            }
            for issue in sorted(
                report.issues,
                key=lambda issue: (0 if issue["severity"] == "error" else 1, issue["category"]),
            )
        ],
        "summary": {
            "errors": report.errors,
            "warnings": report.warnings,
            "by_category": report.by_category(),
        },
        "fail_on": fail_on,
        "exit_code": exit_code,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Content QA gate for the HDSAT question bank.")
    parser.add_argument("--bank", default=str(DEFAULT_BANK), help="path to questionBank.json")
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
    parser.add_argument("--sample", type=int, default=5, help="example ids per issue (default 5)")
    parser.add_argument(
        "--max-near-duplicates",
        type=int,
        default=50,
        help="near-duplicate pairs to list (default 50; the count is always exact unless noted)",
    )
    parser.add_argument(
        "--fail-on",
        choices=("none", "warn", "error"),
        default="error",
        help="exit 1 at this severity (default error)",
    )
    args = parser.parse_args(argv)

    path = pathlib.Path(args.bank)
    try:
        bank = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(ascii_text(f"Cannot read bank: {error}"))
        return 2
    if not isinstance(bank, dict):
        print("Cannot read bank: top level is not an object")
        return 2

    report = check_bank(
        bank,
        bank_path=str(path),
        sample=max(0, args.sample),
        max_near_duplicates=max(0, args.max_near_duplicates),
    )
    code = exit_code_for(report, args.fail_on)

    if args.json:
        print(json.dumps(build_json(report, args.fail_on, code), indent=2, ensure_ascii=True))
    else:
        print(render_text(report))
        print(f"Gate ({args.fail_on}): {'FAIL' if code else 'PASS'}")
    return code


if __name__ == "__main__":
    sys.exit(main())

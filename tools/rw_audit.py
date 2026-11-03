#!/usr/bin/env python3
"""Skill-routing and answer-integrity audit for the Reading & Writing bank.

The bank grew in batches from different pipelines, so two failure modes have
shown up before and must never reach a student again:

1. **Miscategorisation** - an item labelled `Inferences` whose prompt asks for
   the main idea, or a `Command of Evidence (Quantitative)` item with no figure.
   The label drives which skill report the student sees, so a wrong label is a
   wrong study plan.
2. **Answer errors** - a key that points at no choice, two choices that are the
   same answer written differently, a quantitative key that cites numbers the
   figure never contains, or a figure item whose key ignores the data.

This audit is deliberately structural: it never guesses at prose meaning. Every
rule is one the item itself has to satisfy, so a failure is always actionable.
It complements `tools/content_qa.py` (duplicates, LaTeX, figure rendering) and
does not replace it.

Usage:
    python tools/rw_audit.py                 # report, exit 1 on errors
    python tools/rw_audit.py --json out.json # machine-readable findings
    python tools/rw_audit.py --skill Inferences
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_BANK = ROOT / "src" / "data" / "questionBank.json"

BLANK = re.compile(r"_{3,}|\[\s*\]")
BULLET = re.compile(r"^\s*(?:[-*•]|\d+\.)\s+", re.MULTILINE)

# The prompt a skill is allowed to use. Prompts are how the runner tells the
# student what to do, so a mismatch is a labelling bug, not a style choice.
PROMPT_RULES: list[tuple[str, str]] = [
    (r"most logical and precise word", "Words in Context"),
    (r"most logical transition|which transition", "Transitions"),
    (r"student wants|student is writing|bullet", "Rhetorical Synthesis"),
    (r"relationship between (?:the two texts|text 1 and text 2)|"
     r"how would .{0,60}most likely respond|on what point do|"
     r"what implication follows|both texts|the two authors",
     "Cross-Text Connections"),
    (r"finding from the (?:data|table|graph|figure)|"
     r"data in the (?:table|graph|chart|figure)|"
     r"statement about the data|according to the (?:graph|table|chart)|"
     r"described in the (?:table|graph)|"
     r"uses data from the (?:table|graph|chart)|"
     r"supported by the (?:data|table|graph|chart)|"
     r"shown in the (?:graph|chart)|graphed change|"
     r"trend shown in the (?:graph|chart)|pattern in the graph|"
     r"highest and lowest values|values in the table",
     "Command of Evidence (Quantitative)"),
    (r"which (?:quotation|finding|empirical observation|piece of evidence)|"
     r"would most directly (?:illustrate|support)|strongest (?:direct )?evidence",
     "Command of Evidence (Textual)"),
    (r"main idea|central finding|central idea|detail that supports|"
     r"best summarizes (?:the|a) (?:text|passage|finding)|"
     r"according to the (?:text|passage)|text most directly suggest|"
     r"which detail from the text", "Central Ideas and Details"),
    (r"most logically completes|most reasonably be inferred|"
     r"can be inferred from|passage most strongly suggest|"
     r"what would most likely happen if", "Inferences"),
    (r"overall structure|describes the structure|main purpose|describes the purpose|"
     r"primary purpose|structure of the text|purpose of the text|"
     r"trend shown in|rhetorical strategy|"
     r"function of the (?:final|last) sentence|"
     r"purpose of the passage's last sentence",
     "Text Structure and Purpose"),
]

# Boundaries and Form, Structure, and Sense share the same prompt on purpose:
# the SAT asks one question and the *choices* reveal which convention is tested.
# They are told apart below, not by prompt text.
GRAMMAR_PROMPT = re.compile(
    r"conforms to (?:the conventions of )?standard english", re.IGNORECASE)

VALID_SKILLS = {
    "Words in Context", "Transitions", "Rhetorical Synthesis",
    "Cross-Text Connections", "Command of Evidence (Quantitative)",
    "Command of Evidence (Textual)", "Central Ideas and Details", "Inferences",
    "Text Structure and Purpose", "Boundaries", "Form, Structure, and Sense",
}
VALID_DOMAINS = {
    "Information and Ideas", "Craft and Structure",
    "Expression of Ideas", "Standard English Conventions",
}
# Which domain each skill belongs to, so a batch cannot file a grammar item
# under Information and Ideas and corrupt the domain report as well.
SKILL_DOMAIN = {
    "Words in Context": "Craft and Structure",
    "Text Structure and Purpose": "Craft and Structure",
    "Cross-Text Connections": "Craft and Structure",
    "Central Ideas and Details": "Information and Ideas",
    "Inferences": "Information and Ideas",
    "Command of Evidence (Textual)": "Information and Ideas",
    "Command of Evidence (Quantitative)": "Information and Ideas",
    "Transitions": "Expression of Ideas",
    "Rhetorical Synthesis": "Expression of Ideas",
    "Boundaries": "Standard English Conventions",
    "Form, Structure, and Sense": "Standard English Conventions",
}

# A choice that is a bare punctuation variant vs. a verb-form variant. Used only
# to separate the two grammar skills; both are Standard English Conventions.
VERB_FORM = re.compile(
    r"\b(?:is|are|was|were|has|have|had|do|does|did|intrigue\w*|require\w*|"
    r"appear\w*|suggest\w*|remain\w*|seem\w*|offer\w*|allow\w*|make\w*)\b",
    re.IGNORECASE)
PUNCT_ONLY = re.compile(r"^[\s,;:.!?—–]+$")


def norm_choice(text: str) -> str:
    """Collapse a choice to what the student actually compares.

    Apostrophes are kept: `researchers` and `researchers'` are different words,
    and stripping punctuation here was what produced false duplicate warnings.
    """
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    # Punctuation is frequently the answer in Standard English items, so only
    # whitespace is normalised here; stripping it produced false duplicates.
    return re.sub(r"\s+", " ", text).strip().lower()


def numbers_in(text: str) -> list[float]:
    found = []
    for raw in re.findall(r"-?\d[\d,]*\.?\d*", text):
        try:
            found.append(float(raw.replace(",", "")))
        except ValueError:
            continue
    return found


def computed_values(values: set[float]) -> set[float]:
    """Numbers an item is allowed to derive from a figure: differences, sums
    and products of two plotted values (a total, a change, a rate)."""
    out: set[float] = set()
    numbers = sorted(values)
    for i, a in enumerate(numbers):
        for b in numbers[i:]:
            out.update({round(a + b, 6), round(abs(a - b), 6), round(a * b, 6),
                        round(a / b, 6) if b else 0.0})
    return out


def figure_numbers(meta: dict) -> set[float]:
    values: set[float] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, (list, tuple)):
            for value in node:
                walk(value)
        elif isinstance(node, str):
            for number in numbers_in(node):
                values.add(round(number, 6))
        elif isinstance(node, (int, float)):
            values.add(round(float(node), 6))

    walk(meta)
    return values


def audit_item(item: dict) -> list[dict]:
    issues: list[dict] = []
    qid = item.get("id", "?")
    skill = item.get("skill", "")
    prompt = item.get("prompt", "") or ""
    stimulus = item.get("stimulus", "") or ""
    choices = item.get("choices") or []
    key = str(item.get("correct_answer", "")).strip()
    meta = item.get("figure_metadata") or {}

    def add(severity: str, category: str, message: str) -> None:
        issues.append({"id": qid, "skill": skill, "severity": severity,
                       "category": category, "message": message})

    # -- labelling ---------------------------------------------------------
    if skill not in VALID_SKILLS:
        add("error", "skill.unknown", f"unknown skill {skill!r}")
    if item.get("domain") not in VALID_DOMAINS:
        add("error", "domain.unknown", f"unknown domain {item.get('domain')!r}")
    elif skill in SKILL_DOMAIN and item["domain"] != SKILL_DOMAIN[skill]:
        add("error", "domain.mismatch",
            f"{skill} belongs in {SKILL_DOMAIN[skill]}, filed under {item['domain']}")
    if item.get("section") != "Reading and Writing":
        add("error", "section.mismatch", "not a Reading and Writing item")
    if item.get("difficulty") not in {"Easy", "Medium", "Hard"}:
        add("error", "difficulty.unknown", f"bad difficulty {item.get('difficulty')!r}")

    routed = None
    for pattern, target in PROMPT_RULES:
        if re.search(pattern, prompt, re.IGNORECASE):
            routed = target
            break
    if GRAMMAR_PROMPT.search(prompt):
        routed = "grammar"
    if routed is None:
        add("warn", "prompt.unrouted", f"prompt matches no skill pattern: {prompt[:80]!r}")
    elif routed == "grammar":
        if skill not in {"Boundaries", "Form, Structure, and Sense"}:
            add("error", "skill.prompt_mismatch",
                f"Standard English prompt on a {skill} item")
        else:
            verbish = sum(1 for c in choices if VERB_FORM.search(c.get("text", "")))
            puncish = sum(1 for c in choices if PUNCT_ONLY.match(c.get("text", "")))
            if verbish >= 3 and skill != "Form, Structure, and Sense":
                add("warn", "skill.grammar_route",
                    f"choices look like verb forms but skill is {skill}")
            if puncish >= 3 and skill != "Boundaries":
                add("warn", "skill.grammar_route",
                    f"choices look like punctuation but skill is {skill}")
    elif routed != skill:
        add("error", "skill.prompt_mismatch",
            f"prompt routes to {routed}, item is labelled {skill}")

    # -- stimulus shape ----------------------------------------------------
    if len(stimulus.split()) < 12:
        add("warn", "stimulus.too_short", f"{len(stimulus.split())} words")
    if skill in {"Words in Context", "Transitions", "Boundaries",
                 "Form, Structure, and Sense"} and not BLANK.search(stimulus):
        # Some Standard English items carry the blank in the choices instead
        # ("all summer, but the director"), so this is only fatal when no
        # choice overlaps the end of the stimulus either.
        tail = stimulus.split()[-6:]
        in_choices = any(tail and all(w in c.get("text", "")
                                      for w in tail[:-1])
                         for c in choices)
        add("warn" if in_choices else "error", "stimulus.no_blank",
            f"{skill} item without a blank")
    if skill == "Cross-Text Connections":
        if "Text 1" not in stimulus or "Text 2" not in stimulus:
            add("error", "stimulus.cross_text",
                "cross-text item missing Text 1 / Text 2")
    if skill == "Rhetorical Synthesis":
        bullets = BULLET.findall(stimulus)
        if len(bullets) < 3:
            add("error", "stimulus.bullets",
                f"rhetorical synthesis needs >=3 notes, found {len(bullets)}")
        if "notes" not in stimulus.lower():
            add("warn", "stimulus.notes_header", "no 'notes' header in the stimulus")

    # -- figure routing ----------------------------------------------------
    if skill == "Command of Evidence (Quantitative)":
        if not meta:
            add("error", "figure.missing", "quantitative item without figure_metadata")
        elif meta.get("type") not in {"table", "bar_chart", "line_chart"}:
            add("error", "figure.type",
                f"quantitative item uses {meta.get('type')!r}")
    elif meta:
        add("warn", "figure.unexpected", f"{skill} item carries a {meta.get('type')}")

    # -- answer integrity --------------------------------------------------
    if len(choices) != 4:
        add("error", "choices.count", f"{len(choices)} choices")
    ids = [c.get("id") for c in choices]
    if key not in ids:
        add("error", "answer.key_missing", f"key {key!r} is not a choice id")
    texts = [norm_choice(c.get("text", "")) for c in choices]
    if len(set(texts)) != len(texts):
        dupes = [t for t, n in Counter(texts).items() if n > 1]
        add("error", "answer.duplicate_choice", f"duplicate choices: {dupes[:2]}")
    if any(not t for t in texts):
        add("error", "answer.empty_choice", "a choice has no text")

    if skill == "Command of Evidence (Quantitative)" and key in ids and meta:
        keyed = next(c["text"] for c in choices if c.get("id") == key)
        cited = set(numbers_in(keyed))
        available = figure_numbers(meta)
        # A key may cite a computed difference, so require that it cites at
        # least one number the figure actually contains; a key that cites none
        # is usually a plain-language distractor or a mislabelled key.
        if not cited:
            add("warn", "answer.no_data_in_key",
                "quantitative key cites no number from the figure")
        else:
            allowed = available | computed_values(available)
            missing = [n for n in cited
                       if not any(abs(n - a) <= 1.0 for a in allowed)]
            if missing:
                add("error", "answer.data_not_in_figure",
                    f"key cites {missing[:3]} but the figure cannot produce it")

    # The rationale a student reads is the explanation *plus* the per-choice
    # notes. Measuring only the first paragraph flagged thousands of items whose
    # full rationale was already well over the threshold.
    answer = str(item.get("explanation", "") or "")
    for note in (item.get("distractor_rationales") or {}).values():
        answer += " " + str(note or "")
    if len(answer.split()) < 25:
        add("warn", "answer.short_rationale", f"{len(answer.split())} words")

    return issues


def audit(bank: dict, skill_filter: str | None = None) -> dict:
    items = [q for q in bank.get("questions", [])
             if q.get("section") == "Reading and Writing"]
    if skill_filter:
        items = [q for q in items if q.get("skill") == skill_filter]
    issues: list[dict] = []
    for item in items:
        issues.extend(audit_item(item))

    by_category: Counter = Counter(i["category"] for i in issues)
    by_severity: Counter = Counter(i["severity"] for i in issues)
    per_skill: dict[str, Counter] = defaultdict(Counter)
    for issue in issues:
        per_skill[issue["skill"]][issue["category"]] += 1

    return {
        "version": bank.get("bank_version"),
        "items": len(items),
        "issues": issues,
        "summary": {
            "errors": by_severity["error"],
            "warnings": by_severity["warn"],
            "by_category": dict(by_category.most_common()),
            "by_skill": {s: dict(c) for s, c in per_skill.items()},
            "skills": dict(Counter(q.get("skill", "") for q in items).most_common()),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=pathlib.Path, default=DEFAULT_BANK)
    parser.add_argument("--json", type=pathlib.Path)
    parser.add_argument("--skill")
    parser.add_argument("--fail-on", choices=["none", "error", "warn"], default="error")
    args = parser.parse_args(argv)

    try:
        bank = json.loads(args.bank.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"cannot read {args.bank}: {exc}", file=sys.stderr)
        return 2

    report = audit(bank, args.skill)
    summary = report["summary"]
    print(f"R&W items audited: {report['items']}")
    print(f"errors: {summary['errors']}  warnings: {summary['warnings']}")
    for category, count in summary["by_category"].items():
        print(f"  {count:5d}  {category}")
    if report["issues"]:
        print("\nFirst findings:")
        for issue in report["issues"][:20]:
            print(f"  [{issue['severity']}] {issue['id']} {issue['category']}: {issue['message']}")
    if args.json:
        args.json.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"\nreport: {args.json}")

    if args.fail_on == "none":
        return 0
    if args.fail_on == "warn":
        return 1 if (summary["errors"] or summary["warnings"]) else 0
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

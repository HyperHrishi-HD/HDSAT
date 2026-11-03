#!/usr/bin/env python3
"""Build a skill-targeted Reading & Writing batch from an authored spec.

The generic Wikipedia generator only emits the four article-comprehension
skills. Boundaries, Transitions and Cross-Text need a different stimulus shape,
so this builder takes a compact spec and *reconstructs* each stimulus from text
already cached under ``data/*/pages.json``. Every sentence or excerpt is checked
against the cached extract, so an item cannot drift from its source.

Spec shape::

    {
      "batch": "M35",
      "source_id": "wikipedia-cc-by-sa-4",
      "items": [
        {"skill": "Boundaries", "difficulty": "Easy",
         "source_title": "Svalbard Global Seed Vault",
         "sentence": "As of June 2025, the Seed Vault ...",
         "blank": "As of June 2025,",
         "prompt": "...", "correct": ", ",
         "wrongs": ["; ", ": ", " and "],
         "explanation": "...", "why": ["...", "...", "..."]}
      ]
    }

A Transitions item supplies ``first``/``second`` and the original ``transition``.
A Cross-Text item supplies ``sources`` with two ``{title, text}`` objects; its
stimulus becomes ``Text 1``/``Text 2`` around those verbatim excerpts.

Usage:
    python supabase/import/build_skill_batch.py --spec expansion/m35.json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "tools"))

from generate_bank_expansion import mc  # noqa: E402
import rw_audit  # noqa: E402

RETRIEVED = "2026-11-02"
CODES = {
    "Central Ideas and Details": "CI",
    "Inferences": "INF",
    "Text Structure and Purpose": "TS",
    "Command of Evidence (Textual)": "CE",
    "Command of Evidence (Quantitative)": "CEQ",
    "Words in Context": "WIC",
    "Transitions": "T",
    "Rhetorical Synthesis": "RS",
    "Cross-Text Connections": "X",
    "Boundaries": "B",
    "Form, Structure, and Sense": "F",
}


def squash(text: str) -> str:
    return " ".join(str(text).split())


def load_pages() -> dict[str, dict]:
    pages: dict[str, dict] = {}
    for path in (HERE / "data").glob("*/pages.json"):
        for title, page in json.loads(path.read_text(encoding="utf-8")).items():
            pages.setdefault(title, page)
    return pages


def attribution(pages: dict[str, dict], titles: list[str]) -> str:
    parts = []
    for title in titles:
        page = pages[title]
        parts.append(
            f'Wikipedia, "{page["title"]}", CC BY-SA 4.0, '
            f"retrieved {RETRIEVED}. {page['url']}"
        )
    return "; ".join(parts)


def verify(pages: dict[str, dict], title: str, text: str) -> str:
    page = pages.get(title)
    if page is None:
        raise SystemExit(f"source title {title!r} is not cached")
    if squash(text) not in squash(page["extract"]):
        raise SystemExit(f"text is not a verbatim substring of {title!r}: {text[:90]!r}")
    return page["url"]


def build(spec: dict) -> list[dict]:
    pages = load_pages()
    batch = spec["batch"]
    source_id = spec.get("source_id", "wikipedia-cc-by-sa-4")
    counters: dict[str, int] = {}
    built: list[dict] = []

    for index, item in enumerate(spec["items"], start=1):
        skill = item["skill"]
        if skill not in CODES:
            raise SystemExit(f"unsupported skill {skill!r}")
        if skill not in rw_audit.SKILL_DOMAIN:
            raise SystemExit(f"skill {skill!r} has no domain mapping")
        domain = rw_audit.SKILL_DOMAIN[skill]
        counters[skill] = counters.get(skill, 0) + 1
        qid = f"RW-{batch}-{CODES[skill]}{counters[skill]:03d}"

        if skill == "Cross-Text Connections":
            sources = item["sources"]
            if len(sources) != 2:
                raise SystemExit(f"{qid}: cross-text needs exactly two sources")
            for source in sources:
                verify(pages, source["title"], source["text"])
            stimulus = (
                "Text 1\n" + sources[0]["text"].strip()
                + "\n\nText 2\n" + sources[1]["text"].strip()
            )
            attribution_text = attribution(pages, [s["title"] for s in sources])
        elif "first" in item:
            for key in ("first", "second"):
                verify(pages, item["source_title"], item[key])
            transition = item["transition"]
            if not item["second"].startswith(transition):
                raise SystemExit(f"{qid}: second sentence does not start with {transition!r}")
            rest = item["second"][len(transition):].lstrip()
            stimulus = item["first"].strip() + "\n\n_______ " + rest
            attribution_text = attribution(pages, [item["source_title"]])
        else:
            sentence = item["sentence"]
            blank = item["blank"]
            if blank not in sentence:
                raise SystemExit(f"{qid}: blank {blank!r} is not in the sentence")
            verify(pages, item["source_title"], sentence)
            stimulus = sentence.replace(blank, blank[:-1] + "_______", 1)
            attribution_text = attribution(pages, [item["source_title"]])

        question = mc(
            qid,
            "Reading and Writing",
            domain,
            skill,
            item["difficulty"],
            stimulus,
            item["prompt"],
            item["correct"],
            item["wrongs"],
            item["explanation"],
            item["why"],
        )
        question["source_id"] = source_id
        question["attribution"] = item.get("attribution") or attribution_text
        built.append(question)

    return built


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()

    spec_path = pathlib.Path(args.spec)
    if not spec_path.is_absolute():
        spec_path = HERE / spec_path
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    built = build(spec)

    failures = 0
    for question in built:
        for issue in rw_audit.audit_item(question):
            if issue["severity"] == "error":
                failures += 1
                print(f"ERROR {issue['id']} {issue['category']}: {issue['message']}")
        words = len(question["explanation"].split()) + sum(
            len(str(note).split())
            for note in question["distractor_rationales"].values()
        )
        if words < 25:
            failures += 1
            print(f"ERROR {question['id']} rationale is {words} words")

    out = pathlib.Path(args.out) if args.out else spec_path.with_name(
        spec_path.stem + "_built.json"
    )
    if not out.is_absolute():
        out = HERE / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"questions": built, "sources": []}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    by_skill: dict[str, int] = {}
    for question in built:
        by_skill[question["skill"]] = by_skill.get(question["skill"], 0) + 1
    print(f"built {len(built)} items -> {out}")
    for skill, count in by_skill.items():
        print(f"  {skill}: {count}")
    if failures:
        print(f"{failures} validation error(s)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

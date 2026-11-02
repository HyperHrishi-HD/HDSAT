#!/usr/bin/env python3
"""
HDSAT M16 bank batch: Reading & Writing items over real encyclopaedia text.

The passages are copied unchanged from the MediaWiki API responses cached in
``data/m16/pages.json`` (English Wikipedia, CC BY-SA 4.0). The generator refuses
to run if an excerpt is not a verbatim substring of its article, so a paraphrase
can never be passed off as the source text. Question stems, choices and
rationales are original to HDSAT, and every item names its article and URL in
the ``attribution`` field.

The Inferences items append one short blanked sentence to the verbatim excerpt;
that sentence is item scaffolding, not source text, and is the only place the
stimulus goes beyond the attributed passage.

Run from the repository root::

    python supabase/import/generate_bank_rw_m16.py

Writes supabase/import/expansion/extra_rw_m16.json
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_bank_expansion import mc  # noqa: E402

DATA = HERE / "data" / "m16"
OUT = HERE / "expansion" / "extra_rw_m16.json"

RW = "Reading and Writing"
SOURCE_ID = "wikipedia-cc-by-sa-4"
RETRIEVED = "2026-11-02"

SKILL_DOMAIN = {
    "Central Ideas and Details": "Information and Ideas",
    "Inferences": "Information and Ideas",
    "Command of Evidence (Textual)": "Information and Ideas",
    "Text Structure and Purpose": "Craft and Structure",
}
CODES = {
    "Central Ideas and Details": "CI",
    "Inferences": "INF",
    "Text Structure and Purpose": "TS",
    "Command of Evidence (Textual)": "CE",
}

SOURCE = {
    "source_id": SOURCE_ID,
    "name": "Wikipedia (CC BY-SA 4.0)",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "provenance_summary": (
        "Verbatim introductory extracts from English Wikipedia articles, "
        "retrieved 2026-11-02 through the MediaWiki API. Every item names its "
        "article and URL in its attribution. Question stems, choices and "
        "rationales are original to HDSAT."
    ),
    "is_released_practice_set": False,
    "is_official_college_board": False,
}


def squash(text: str) -> str:
    return " ".join(str(text).split())


def load_pages() -> dict:
    return json.loads((DATA / "pages.json").read_text(encoding="utf-8"))


def load_authored() -> dict:
    """Merge the hand-authored item files, one entry per article."""
    authored: dict = {}
    for name in ("items_a", "items_b", "items_c"):
        path = DATA / f"{name}.json"
        if not path.exists():
            sys.exit(f"missing item file: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        for title, page in payload["pages"].items():
            if title in authored:
                sys.exit(f"{title} appears in more than one item file")
            authored[title] = page
    return authored


def main() -> int:
    pages = load_pages()
    authored = load_authored()
    counters = {skill: 0 for skill in CODES}
    built = []

    for title, page in authored.items():
        source = pages.get(title)
        if not source:
            sys.exit(f"{title!r} is not in pages.json")
        excerpt = squash(page["excerpt"])
        if excerpt not in squash(source["extract"]):
            sys.exit(f"excerpt for {title!r} is not a verbatim substring")
        excerpt = page["excerpt"].strip()

        for item in page["items"]:
            skill = item["skill"]
            if skill not in SKILL_DOMAIN:
                sys.exit(f"{title!r}: unknown skill {skill!r}")
            counters[skill] += 1
            qid = f"RW-M16-{CODES[skill]}{counters[skill]:03d}"
            question = mc(
                qid,
                RW,
                SKILL_DOMAIN[skill],
                skill,
                item["difficulty"],
                excerpt,
                item["prompt"],
                item["correct"],
                item["wrongs"],
                item["explanation"],
                item["why"],
            )
            question["source_id"] = SOURCE_ID
            question["attribution"] = (
                f'Wikipedia, "{source["title"]}", CC BY-SA 4.0, '
                f"retrieved {RETRIEVED}. {source['url']}"
            )
            built.append(question)

    missing = [skill for skill, count in counters.items() if count == 0]
    if missing:
        sys.exit(f"no items authored for: {', '.join(missing)}")

    payload = {"questions": built, "sources": [SOURCE]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {len(built)} items to {OUT}")
    for skill, count in counters.items():
        print(f"  {skill}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

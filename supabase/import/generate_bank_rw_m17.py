#!/usr/bin/env python3
"""
HDSAT M17 bank batch: cross-text pairs and single passages over real text.

Every stimulus is copied unchanged from the MediaWiki API responses cached in
``data/m17/pages.json`` (English Wikipedia, CC BY-SA 4.0). Paired items are
assembled as "Text 1" + article A and "Text 2" + article B; no excerpt is
retyped, so the stimulus cannot drift from the source. Single-passage items use
a hand-selected excerpt, and the generator refuses to run unless that excerpt is
a verbatim substring of its article.

Question stems, choices and rationales are original to HDSAT, and every item
names its article(s) and URL(s) in the ``attribution`` field.

Run from the repository root::

    python supabase/import/generate_bank_rw_m17.py

Writes supabase/import/expansion/extra_rw_m17.json
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_bank_expansion import mc  # noqa: E402

DATA = HERE / "data" / "m17"
OUT = HERE / "expansion" / "extra_rw_m17.json"

RW = "Reading and Writing"
SOURCE_ID = "wikipedia-cc-by-sa-4"
RETRIEVED = "2026-11-02"

SKILL_DOMAIN = {
    "Cross-Text Connections": "Craft and Structure",
    "Central Ideas and Details": "Information and Ideas",
    "Inferences": "Information and Ideas",
    "Command of Evidence (Textual)": "Information and Ideas",
    "Text Structure and Purpose": "Craft and Structure",
}
CODES = {
    "Cross-Text Connections": "CT",
    "Central Ideas and Details": "CI",
    "Inferences": "INF",
    "Command of Evidence (Textual)": "CE",
    "Text Structure and Purpose": "TS",
}


def squash(text: str) -> str:
    return " ".join(str(text).split())


def load_pages() -> dict:
    return json.loads((DATA / "pages.json").read_text(encoding="utf-8"))


def read(name: str) -> dict:
    path = DATA / name
    if not path.exists():
        sys.exit(f"missing item file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    pages = load_pages()
    pairs = read("cross_text.json")["pairs"]
    singles: dict = {}
    for name in ("singles_a.json", "singles_b.json"):
        for title, page in read(name)["pages"].items():
            if title in singles:
                sys.exit(f"{title} appears in more than one single file")
            singles[title] = page

    counters = {skill: 0 for skill in CODES}
    built = []

    def add(skill, stimulus, item, attribution):
        counters[skill] += 1
        qid = f"RW-M17-{CODES[skill]}{counters[skill]:03d}"
        question = mc(
            qid,
            RW,
            SKILL_DOMAIN[skill],
            skill,
            item["difficulty"],
            stimulus,
            item["prompt"],
            item["correct"],
            item["wrongs"],
            item["explanation"],
            item["why"],
        )
        question["source_id"] = SOURCE_ID
        question["attribution"] = attribution
        built.append(question)

    for pair in pairs:
        a, b = pair["a"], pair["b"]
        for title in (a, b):
            if title not in pages:
                sys.exit(f"pair {pair['key']!r}: {title!r} is not cached")
        stimulus = f"Text 1\n{pages[a]['extract'].strip()}\n\nText 2\n{pages[b]['extract'].strip()}"
        attribution = (
            f'Wikipedia, "{pages[a]["title"]}" and "{pages[b]["title"]}", '
            f"CC BY-SA 4.0, retrieved {RETRIEVED}. "
            f"{pages[a]['url']} ; {pages[b]['url']}"
        )
        for item in pair["items"]:
            if item["skill"] != "Cross-Text Connections":
                sys.exit(f"pair {pair['key']!r}: unexpected skill {item['skill']!r}")
            item_stimulus = stimulus
            if item.get("append"):
                item_stimulus = stimulus + chr(10) + chr(10) + item["append"]
            add(item["skill"], item_stimulus, item, attribution)

    for title, page in singles.items():
        source = pages.get(title)
        if not source:
            sys.exit(f"{title!r} is not in pages.json")
        if page.get("excerpt") is None:
            stimulus = source["extract"].strip()
        else:
            if squash(page["excerpt"]) not in squash(source["extract"]):
                sys.exit(f"excerpt for {title!r} is not a verbatim substring")
            stimulus = page["excerpt"].strip()
        attribution = (
            f'Wikipedia, "{source["title"]}", CC BY-SA 4.0, '
            f"retrieved {RETRIEVED}. {source['url']}"
        )
        for item in page["items"]:
            if item["skill"] == "Cross-Text Connections":
                sys.exit(f"{title!r}: cross-text items belong in cross_text.json")
            add(item["skill"], stimulus, item, attribution)

    empty = [skill for skill, count in counters.items() if count == 0]
    if empty:
        sys.exit(f"no items authored for: {', '.join(empty)}")

    payload = {"questions": built, "sources": []}
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

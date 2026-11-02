#!/usr/bin/env python3
"""Generate a Reading & Writing batch whose stimuli come from cached Wikipedia.

Usage::

    python supabase/import/generate_bank_rw_wiki.py --data m18 --batch M18 \
        --out expansion/extra_rw_m18.json

``data/<batch>/pages.json`` holds MediaWiki extracts and URLs.
``data/<batch>/items.json`` holds ``{"pages": {title: {excerpt, items}}}``.
An excerpt may be null to use the whole cached extract; otherwise it must be a
verbatim substring of the extract. Items may add an ``append`` sentence, which
is joined to the stimulus with a blank line.

Stems, choices and rationales are original HDSAT content; each item carries the
article's attribution under CC BY-SA 4.0.
"""

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_bank_expansion import mc  # noqa: E402

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


def squash(text: str) -> str:
    return " ".join(str(text).split())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--batch", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    data = HERE / "data" / args.data
    pages = json.loads((data / "pages.json").read_text(encoding="utf-8"))
    authored = json.loads((data / "items.json").read_text(encoding="utf-8"))["pages"]

    counters = {skill: 0 for skill in CODES}
    built = []

    for title, page in authored.items():
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
            skill = item["skill"]
            if skill not in CODES:
                sys.exit(f"{title!r}: unsupported skill {skill!r}")
            counters[skill] += 1
            qid = f"RW-{args.batch}-{CODES[skill]}{counters[skill]:03d}"
            item_stimulus = stimulus
            if item.get("append"):
                item_stimulus = stimulus + chr(10) + chr(10) + item["append"]
            question = mc(
                qid,
                RW,
                SKILL_DOMAIN[skill],
                skill,
                item["difficulty"],
                item_stimulus,
                item["prompt"],
                item["correct"],
                item["wrongs"],
                item["explanation"],
                item["why"],
            )
            question["source_id"] = SOURCE_ID
            question["attribution"] = attribution
            built.append(question)

    empty = [skill for skill, count in counters.items() if count == 0]
    if empty:
        sys.exit(f"no items authored for: {', '.join(empty)}")

    out = HERE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"questions": built, "sources": []}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {len(built)} items to {out}")
    for skill, count in counters.items():
        print(f"  {skill}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

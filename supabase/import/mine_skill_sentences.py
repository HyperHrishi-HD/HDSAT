#!/usr/bin/env python3
"""Mine real sentences that can carry Boundaries, Transitions and Form items.

The grammar and transition skills need short, self-contained sentences rather
than whole article extracts. This tool only *finds* candidates in text already
cached under ``data/*/pages.json``; it never writes items. A human (or the
batch author) still decides which blank is unambiguous, so no mined sentence
reaches the bank without review.

Usage:
    python supabase/import/mine_skill_sentences.py --out expansion/candidates.json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent

CONJUNCTIVE = (
    "however|therefore|moreover|nevertheless|consequently|furthermore|"
    "meanwhile|instead|similarly|nonetheless|hence|thus|still"
)
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")

# A semicolon plus a conjunctive adverb joins two independent clauses. Blanking
# only the semicolon leaves exactly one defensible mark, which is what a
# Boundaries item needs.
SEMICOLON_ADVERB = re.compile(rf";\s+(?:{CONJUNCTIVE}),", re.IGNORECASE)

# An introductory phrase is followed by a comma. The phrase must not contain a
# finite verb, otherwise the mark could arguably be a semicolon boundary.
INTRO = re.compile(
    r"^(?:In|During|After|Before|By|For|With|Through|Despite|Unlike|Because|"
    r"Although|When|While|As|Since|On|At|From|Over|Under|Between|Among)\b"
    r"[^,.;:]{8,70},",
)

OPENERS = (
    "However|Therefore|For example|For instance|In contrast|By contrast|"
    "Similarly|Consequently|Nevertheless|Moreover|Instead|Meanwhile|"
    "As a result|In addition|Thus|Hence|Still|Nonetheless|In practice"
)
TRANSITION = re.compile(rf"^(?:{OPENERS}),", re.IGNORECASE)
CONTRAST_CUE = re.compile(
    r"\b(?:but|although|though|yet|despite|unlike|whereas|rather than|"
    r"on the other hand|even so|nevertheless|however)\b",
    re.IGNORECASE,
)


def sentences(extract: str) -> list[str]:
    clean = re.sub(r"\s+", " ", extract).strip()
    return [s.strip() for s in SENTENCE_END.split(clean) if s.strip()]


def words(text: str) -> int:
    return len(text.split())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="expansion/candidates.json")
    parser.add_argument("--data", default=str(HERE / "data"))
    args = parser.parse_args()

    boundaries: list[dict] = []
    transitions: list[dict] = []
    seen: set[str] = set()

    for path in sorted(pathlib.Path(args.data).glob("*/pages.json")):
        pages = json.loads(path.read_text(encoding="utf-8"))
        for title, page in pages.items():
            extract = page.get("extract") or ""
            paragraph_sentences = [sentences(p) for p in re.split(r"\n\s*\n", extract)]
            for sent in sentences(extract):
                if sent in seen:
                    continue
                if not 14 <= words(sent) <= 46:
                    continue
                if SEMICOLON_ADVERB.search(sent):
                    seen.add(sent)
                    boundaries.append({
                        "kind": "semicolon_adverb",
                        "title": title,
                        "url": page.get("url"),
                        "sentence": sent,
                        "blank": SEMICOLON_ADVERB.search(sent).group(0)[0],
                    })
                elif INTRO.match(sent) and words(sent) >= 18:
                    seen.add(sent)
                    boundaries.append({
                        "kind": "intro_comma",
                        "title": title,
                        "url": page.get("url"),
                        "sentence": sent,
                        "blank": ",",
                    })

            for group in paragraph_sentences:
                for first, second in zip(group, group[1:]):
                    if not TRANSITION.match(second):
                        continue
                    if not 10 <= words(first) <= 40 or not 8 <= words(second) <= 45:
                        continue
                    if first in seen:
                        continue
                    seen.add(first)
                    transitions.append({
                        "kind": "pair",
                        "title": title,
                        "url": page.get("url"),
                        "first": first,
                        "second": second,
                        "contrast": bool(CONTRAST_CUE.search(second)),
                    })

    payload = {"boundaries": boundaries, "transitions": transitions}
    out = HERE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    print(f"boundaries: {len(boundaries)}  transitions: {len(transitions)} -> {out}")
    for kind in ("semicolon_adverb", "intro_comma"):
        print(f"  {kind}: {sum(1 for c in boundaries if c['kind'] == kind)}")
    print(f"  contrast pairs: {sum(1 for c in transitions if c['contrast'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

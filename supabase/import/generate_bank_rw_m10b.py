#!/usr/bin/env python3
"""HDSAT Reading & Writing expansion, second batch (R2-M10 continuation).

The first batch (generate_bank_rw_m10.py) proved the pipeline. This one takes
longer-form authored content:

  * Command of Evidence (Quantitative) with richer, more realistic figures:
    multi-row tables, multi-year line charts and multi-category bar charts,
    where the right answer is sometimes a difference, a percentage-point gap or
    a trend rather than "the largest bar".
  * Central Ideas, Inferences and Text Structure passages.
  * Rhetorical Synthesis note sets.
  * Transitions.
  * Boundaries (four-option punctuation items).
  * Words in Context.

Inputs live in supabase/import/data/m10b/*.json; the output is
supabase/import/expansion/extra_rw_m10b.json, merged by merge_bank_m10.py.
Every item is original prose written for this bank; no external question text
is copied.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from generate_bank_expansion import EXP_DIR, mc  # noqa: E402

DATA_DIR = os.path.join(HERE, "data", "m10b")
OUT = os.path.join(EXP_DIR, "extra_rw_m10b.json")

RW = "Reading and Writing"
CRAFT = "Craft and Structure"
INFO = "Information and Ideas"
EXPRESSION = "Expression of Ideas"
CONVENTIONS = "Standard English Conventions"
EASY, MEDIUM, HARD = "Easy", "Medium", "Hard"
DIFFICULTIES = {EASY, MEDIUM, HARD}

WIC_PROMPT = (
    "Which choice completes the text with the most logical and precise word or phrase?"
)
BOUNDARY_PROMPT = (
    "Which choice completes the text so that it conforms to the conventions of Standard English?"
)
TRANSITION_PROMPT = "Which choice completes the text with the most logical transition?"
PASSAGE_SKILLS = {"Central Ideas and Details", "Inferences", "Text Structure and Purpose"}

# The importer's deterministic shuffle seeds from the item id. One suffix here
# keeps the 22 Central Ideas keys spread across all four letters instead of
# landing 45% on D, which the QA gate flags as key bias.
PASSAGE_ID_SALTS = {0: "a"}

SKIPPED = []


def load(name):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        print(f"  (missing {name}; skipping that family)")
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def difficulty_of(row, fallback):
    value = str(row.get("difficulty") or "").strip()
    return value if value in DIFFICULTIES else fallback


def clean_list(values, count=3):
    return [str(value).strip() for value in (values or []) if str(value).strip()][:count]


def valid(row, reasons):
    wrongs = clean_list(row.get("wrongs"))
    why = clean_list(row.get("why"))
    explanation = str(row.get("explanation") or "").strip()
    if len(wrongs) != 3:
        reasons.append("needs exactly three wrongs")
    if len(why) != 3:
        reasons.append("needs exactly three rationales")
    if len(explanation) < 40:
        reasons.append("explanation under 40 characters")
    return wrongs, why, explanation


def gen_wic():
    items = []
    for index, row in enumerate(load("wic.json").get("items", [])):
        reasons = []
        sentence = str(row.get("sentence") or "").strip()
        correct = str(row.get("correct") or "").strip()
        wrongs, why, explanation = valid(row, reasons)
        if "______" not in sentence:
            reasons.append("sentence has no blank")
        if not correct:
            reasons.append("no correct word")
        if reasons:
            SKIPPED.append(("wic", index, reasons))
            continue
        items.append(
            mc(
                f"RW-M10X-W{index:04d}",
                RW,
                CRAFT,
                "Words in Context",
                difficulty_of(row, MEDIUM),
                sentence,
                WIC_PROMPT,
                correct,
                wrongs,
                explanation,
                why,
            )
        )
    return items


def gen_boundaries():
    items = []
    for index, row in enumerate(load("boundaries.json").get("items", [])):
        reasons = []
        sentence = str(row.get("sentence") or "").strip()
        correct = str(row.get("correct") or "").strip()
        wrongs, why, explanation = valid(row, reasons)
        if "______" not in sentence:
            reasons.append("sentence has no blank")
        if not correct:
            reasons.append("no correct punctuation/word")
        if reasons:
            SKIPPED.append(("boundaries", index, reasons))
            continue
        items.append(
            mc(
                f"RW-M10X-B{index:04d}",
                RW,
                CONVENTIONS,
                "Boundaries",
                difficulty_of(row, MEDIUM),
                sentence,
                str(row.get("prompt") or BOUNDARY_PROMPT).strip(),
                correct,
                wrongs,
                explanation,
                why,
            )
        )
    return items


def gen_transitions():
    items = []
    for index, row in enumerate(load("transitions.json").get("items", [])):
        reasons = []
        before = str(row.get("before") or "").strip().rstrip(".")
        after = str(row.get("after") or "").strip()
        correct = str(row.get("correct") or "").strip()
        wrongs, why, explanation = valid(row, reasons)
        if not before or not after or not correct:
            reasons.append("needs before, after and correct")
        if reasons:
            SKIPPED.append(("transitions", index, reasons))
            continue
        # The blank is the transition itself, so the comma after it belongs to
        # the stimulus.
        after = after[0:1].lower() + after[1:]
        items.append(
            mc(
                f"RW-M10X-T{index:04d}",
                RW,
                EXPRESSION,
                "Transitions",
                difficulty_of(row, MEDIUM),
                f"{before}. ______, {after}",
                str(row.get("prompt") or TRANSITION_PROMPT).strip(),
                correct,
                wrongs,
                explanation,
                why,
            )
        )
    return items


def gen_passages():
    items = []
    for index, row in enumerate(load("passages.json").get("items", [])):
        reasons = []
        skill = str(row.get("skill") or "").strip()
        passage = str(row.get("passage") or "").strip()
        prompt = str(row.get("prompt") or "").strip()
        correct = str(row.get("correct") or "").strip()
        wrongs, why, explanation = valid(row, reasons)
        if skill not in PASSAGE_SKILLS:
            reasons.append(f"unknown skill {skill!r}")
        if len(passage) < 60:
            reasons.append("passage under 60 characters")
        if not prompt or not correct:
            reasons.append("needs prompt and correct")
        if reasons:
            SKIPPED.append(("passages", index, reasons))
            continue
        items.append(
            mc(
                f"RW-M10X-P{index:04d}{PASSAGE_ID_SALTS.get(index, '')}",
                RW,
                INFO,
                skill,
                difficulty_of(row, MEDIUM),
                passage,
                prompt,
                correct,
                wrongs,
                explanation,
                why,
            )
        )
    return items


def gen_synthesis():
    items = []
    for index, row in enumerate(load("synthesis.json").get("items", [])):
        reasons = []
        notes = [str(note).strip() for note in (row.get("notes") or []) if str(note).strip()]
        goal = str(row.get("goal") or "").strip()
        correct = str(row.get("correct") or "").strip()
        wrongs, why, explanation = valid(row, reasons)
        if len(notes) < 3:
            reasons.append("needs at least three notes")
        if not goal or not correct:
            reasons.append("needs goal and correct")
        if reasons:
            SKIPPED.append(("synthesis", index, reasons))
            continue
        bullets = "\n".join(f"• {note}" for note in notes)
        items.append(
            mc(
                f"RW-M10X-S{index:04d}",
                RW,
                EXPRESSION,
                "Rhetorical Synthesis",
                difficulty_of(row, MEDIUM),
                f"While researching a topic, a student has taken the following notes:\n{bullets}",
                f"{goal}\n\nWhich choice most effectively uses relevant information from the notes to accomplish this goal?",
                correct,
                wrongs,
                explanation,
                why,
            )
        )
    return items


def gen_quantitative():
    items = []
    for index, row in enumerate(load("quant.json").get("items", [])):
        reasons = []
        scenario = str(row.get("scenario") or "").strip()
        prompt = str(row.get("prompt") or "").strip()
        correct = str(row.get("correct") or "").strip()
        figure = row.get("figure")
        wrongs, why, explanation = valid(row, reasons)
        if not scenario or not prompt or not correct:
            reasons.append("needs scenario, prompt and correct")
        if not isinstance(figure, dict) or figure.get("type") not in {
            "table",
            "bar_chart",
            "line_chart",
        }:
            reasons.append("figure must be table, bar_chart or line_chart")
        if reasons:
            SKIPPED.append(("quant", index, reasons))
            continue
        items.append(
            mc(
                f"RW-M10X-Q{index:04d}",
                RW,
                INFO,
                "Command of Evidence (Quantitative)",
                difficulty_of(row, MEDIUM),
                scenario,
                prompt,
                correct,
                wrongs,
                explanation,
                why,
                figure=figure,
            )
        )
    return items


def build():
    families = [
        ("Words in Context", gen_wic),
        ("Boundaries", gen_boundaries),
        ("Transitions", gen_transitions),
        ("Passages", gen_passages),
        ("Rhetorical Synthesis", gen_synthesis),
        ("Command of Evidence (Quantitative)", gen_quantitative),
    ]
    items = []
    for label, builder in families:
        produced = builder()
        print(f"  {label}: {len(produced)}")
        items.extend(produced)
    return items


def main():
    print("building second R&W batch")
    items = build()
    if SKIPPED:
        print(f"skipped {len(SKIPPED)} malformed item(s):")
        for family, index, reasons in SKIPPED[:20]:
            print(f"  {family}[{index}]: {'; '.join(reasons)}")
    os.makedirs(EXP_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"questions": items}, fh, ensure_ascii=False, indent=1)
    by_skill = {}
    for item in items:
        by_skill[item["skill"]] = by_skill.get(item["skill"], 0) + 1
    print(f"wrote {len(items)} R&W items to {OUT}")
    for skill, count in sorted(by_skill.items()):
        print(f"  {skill}: {count}")
    if not items:
        sys.exit("nothing produced; check the data files")


if __name__ == "__main__":
    main()

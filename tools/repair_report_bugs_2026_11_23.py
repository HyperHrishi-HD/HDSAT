#!/usr/bin/env python3
"""Repair the defects captured in QUESTION_REPORTS_2026-11-23.md.

The repair is intentionally local to the question bank. It is idempotent:
running it twice must produce the same bank. The live database is not touched;
a migration for the changed rows is generated separately.

Classes repaired:
* the three reported answer-key/validity defects in Standard English;
* inference items whose prompt asks the student to complete a text that has no
  blank;
* cross-text passages whose ``Text 2`` heading was collapsed onto Text 1;
* generated M13 table/chart items whose three-pool context sentence was
  semantically unrelated to the figure, plus the Percentages mislabel on the
  subtraction-only bar-chart family.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"

COMPLETES = re.compile(r"completes?\s+the\s+text", re.IGNORECASE)
GENERATED_CONTEXT = re.compile(
    r"^A .*?\.\s+(?=The (?:bar graph|line graph|table) shows)", re.IGNORECASE
)

# Meaningful replacements for the generated table/chart context. The old
# three-pool ctx() paired unrelated makers, objects and settings; these keep
# the prose grammatical and relevant without pretending the table has a
# real-world subject it does not have.
T_CONTEXTS = [
    "A data analyst is reviewing a table of values for a linear model.",
    "A research assistant is checking a table of measurements for a calibration report.",
    "A quality-control technician is reading a table of readings from a production trial.",
    "A planning analyst is examining a table of values from a forecasting exercise.",
    "A lab assistant is recording a table of measurements for a methods report.",
    "A systems analyst is reviewing a table of values from a simulation.",
    "A field researcher is checking a table of readings from a survey.",
    "A data coordinator is preparing a table of values for a summary report.",
]
E_CONTEXTS = [
    "A data analyst is reviewing a table of growth measurements for a biology report.",
    "A research assistant is checking a table of population counts from a field study.",
    "A lab technician is reading a table of readings from a growth trial.",
    "A planning analyst is examining a table of values from a demographic model.",
    "A field researcher is recording a table of counts for an ecology report.",
    "A systems analyst is reviewing a table of values from a growth simulation.",
    "A data coordinator is preparing a table of measurements for a summary report.",
    "A quality-control technician is checking a table of readings from a batch test.",
]


def data_context(qid: str, label: str | None = None) -> str:
    index = int(re.search(r"(\d{3})$", qid).group(1))  # type: ignore[union-attr]
    if qid.startswith("M13-DATA-T"):
        return T_CONTEXTS[index % len(T_CONTEXTS)]
    if qid.startswith("M13-DATA-E"):
        return E_CONTEXTS[index % len(E_CONTEXTS)]
    subject = label or "the values"
    if qid.startswith("M13-DATA-L"):
        return f"A program analyst is reviewing the trend in {subject} over time."
    return f"A program analyst is reviewing {subject} for a planning report."


def by_id(bank: dict) -> dict[str, dict]:
    return {question["id"]: question for question in bank["questions"]}


def set_choices(question: dict, rows: list[tuple[str, str]]) -> None:
    question["choices"] = [{"id": choice_id, "text": text} for choice_id, text in rows]


def manual_repairs(questions: dict[str, dict]) -> None:
    # P0-1: a punctuation item must have one defensible mark. A colon
    # introducing a list is unique; the semicolon needs an independent clause,
    # the comma splices, and the period would need a capitalised new sentence.
    q = questions["RW-SEC-9003"]
    q["stimulus"] = (
        "The field station lost power for six hours ______ a failed breaker, a flooded "
        "generator, and a downed line."
    )
    set_choices(q, [("A", ";"), ("B", ","), ("C", ":"), ("D", ".")])
    q["correct_answer"] = "C"
    q["explanation"] = (
        "A colon introduces the list that identifies the three causes. A semicolon must "
        "join two independent clauses, a comma cannot introduce this list, and a period "
        "would require a new sentence beginning with a capital letter."
    )
    q["distractor_rationales"] = {
        "A": "A semicolon must join two independent clauses; the list is not an independent clause.",
        "B": "A comma cannot introduce this list; it would splice the sentence together.",
        "D": "A period would end the sentence, so the list would need to begin a new capitalised sentence.",
    }

    # P0-2: the colon is the unique choice before an appositive list.
    q = questions["RW-SEC-9033"]
    q["stimulus"] = (
        "The plan rested on three assumptions ______ demand would stay flat, shipping "
        "costs would remain stable, and no competitor would enter the market."
    )
    set_choices(q, [("A", ";"), ("B", ","), ("C", ":"), ("D", ".")])
    q["correct_answer"] = "C"
    q["explanation"] = (
        "A colon introduces the list that spells out the three assumptions. The semicolon "
        "does not join independent clauses here, the comma splices, and the period would "
        "leave a lower-case sentence after it."
    )
    q["distractor_rationales"] = {
        "A": "A semicolon must join independent clauses; the list is not an independent clause.",
        "B": "A comma cannot introduce this list without creating a splice.",
        "D": "A period would require a new sentence with a capital letter.",
    }

    # P0-3: the original keyed consequence contradicted the premise (plates wear
    # out after 2,000 impressions, so a 10,000-print run needs recutting).
    q = questions["RW-SEC-89358"]
    q["choices"] = [
        {
            "id": "A",
            "text": "; so editions of ten thousand prints require the plates to be recut several times.",
        },
        {
            "id": "B",
            "text": "editions of ten thousand prints require the plates to be recut several times.",
        },
        {
            "id": "C",
            "text": "so editions of ten thousand prints require the plates to be recut several times.",
        },
        {
            "id": "D",
            "text": "and, editions of ten thousand prints require the plates to be recut several times.",
        },
    ]
    q["correct_answer"] = "C"
    q["explanation"] = (
        "The second em dash closes the parenthetical phrase. 'So' introduces the result: "
        "because a plate wears out after roughly two thousand impressions, a ten-thousand-print "
        "edition requires the plates to be recut several times."
    )
    q["distractor_rationales"] = {
        "A": "A semicolon followed by 'so' is not a standard way to join these clauses.",
        "B": "Without a conjunction or punctuation, the two clauses form a run-on.",
        "D": "The comma after 'and' is incorrectly placed and does not fix the boundary.",
    }

    # P1 follow-up: the inference key was the unique longest choice. Keep the
    # same inference but state it compactly.
    q = questions["RW-INF-002"]
    q["choices"][0]["text"] = (
        "because registries were administrative, scribes chose sheepskin's tamper resistance and lower cost."
    )
    q["explanation"] = (
        "The passage contrasts vellum (prized for decorative illumination) with sheepskin "
        "(used for administrative registries and prone to splitting if someone tried to "
        "scrape off ink). The correct completion explains why administrative use favoured "
        "the coarser, harder-to-erase sheepskin."
    )

    # P1: the cover-crop key was correct, but the explanation exposed internal
    # test-bank language and the key was the unique longest choice.
    q = questions["RW-INF-003"]
    set_choices(
        q,
        [
            (
                "A",
                "The Clover + Rye mix reached 86% suppression and retained 64 kg/ha, close to both single-crop benchmarks.",
            ),
            (
                "B",
                "Tillage Radish retained 51 kg/ha and suppressed 72% of weeds, outperforming Winter Rye in nitrogen retention.",
            ),
            (
                "C",
                "Crimson Clover retained 68 kg/ha, the highest nitrogen retention among all four treatments in the trial.",
            ),
            (
                "D",
                "Winter Rye alone suppressed 89% of weeds, whereas Crimson Clover alone suppressed only 54% of weeds.",
            ),
        ],
    )
    q["correct_answer"] = "A"
    q["explanation"] = (
        "The 50/50 mix reaches 86% weed suppression, close to Winter Rye's 89%, and retains "
        "64 kg/ha, close to Crimson Clover's 68 kg/ha. It therefore keeps most of both "
        "single-crop benefits; the other choices cite only one crop or an irrelevant treatment."
    )
    q["distractor_rationales"] = {
        "B": "Tillage Radish is neither the legume nor the cereal grass in the conclusion.",
        "C": "Cites only Crimson Clover's nitrogen retention.",
        "D": "Mentions only the single-crop extremes without citing the paired mixture.",
    }

    # P1 item-design follow-up: the blackbird evidence was the unique longest
    # choice in all three prompts on the shared passage. Keep the evidence but
    # state it compactly so length is not the cue.
    blackbird = (
        "City-park recordings average 2.4 kHz, versus 1.8 kHz in quiet rural forests 30 kilometers away."
    )
    blackbird_explanation = (
        "The claim is that urban blackbirds raise their song frequency to avoid low-frequency traffic "
        "rumble. The frequency comparison directly supports that mechanism; the other choices "
        "concern song timing, plumage or clutch size."
    )
    for qid, key in (("RW-INF-88807", "A"), ("RW-INF-88808", "B"), ("RW-INF-88809", "D")):
        q = questions[qid]
        for choice in q["choices"]:
            if choice["id"] == key:
                choice["text"] = blackbird
        q["explanation"] = blackbird_explanation

    # P1: name both protective mechanisms instead of repeating the generic goal.
    q = questions["RW-EXP-89022"]
    q["explanation"] = (
        "The notes describe two distinct defenses: the flash startles grazing copepods and cuts "
        "their feeding by 55%, and it makes the copepods visible to nocturnal predatory fish. "
        "The choice that names both mechanisms is correct; the others mention only one effect or "
        "an unrelated detail."
    )

    # P2: escape paired currency dollar signs so the renderer never mistakes a
    # prose span between two prices for LaTeX.
    for qid in ("RW-M17-CT001", "RW-M17-CT002", "RW-M24-CI002", "RW-M24-INF002", "RW-M24-TS002"):
        q = questions[qid]
        q["stimulus"] = q["stimulus"].replace("\\$", "$").replace("$", "\\$")

    # P1: restore the cross-text paragraph break and shorten the key so the
    # longest-choice cue no longer points at the answer.
    q = questions["RW-CRF-88406"]
    q["choices"] = [
        {
            "id": "A",
            "text": "Both authors conclude that open-plan libraries are obsolete compared with older designs.",
        },
        {
            "id": "B",
            "text": "Sterling stresses open-plan libraries' collaborative benefit; Nair notes a noise-related trade-off.",
        },
        {
            "id": "C",
            "text": "Sterling studies only laboratory models, whereas Nair refuses to consider empirical data.",
        },
        {
            "id": "D",
            "text": "Sterling opposes open-plan libraries on financial grounds, whereas Nair supports them unconditionally.",
        },
    ]
    q["correct_answer"] = "B"
    q["explanation"] = (
        "Text 1 emphasizes collaboration; Text 2 warns that noise reduces comprehension. "
        "The correct choice captures that benefit-versus-trade-off relationship without "
        "overstating either author."
    )
    q["distractor_rationales"] = {
        "A": "Neither author calls open-plan libraries obsolete.",
        "C": "Both authors discuss real studies, not laboratory models or a refusal of evidence.",
        "D": "Sterling supports the practice, and Nair does not support it unconditionally.",
    }

    q = questions["RW-CRF-88420"]
    q["choices"] = [
        {"id": "A", "text": "Silva's benefits are mathematically impossible to measure."},
        {
            "id": "B",
            "text": "Silva's benefits require modifying restoration to preserve frame-rate choices.",
        },
        {
            "id": "C",
            "text": "Berg's concern applies only to systems already decommissioned.",
        },
        {
            "id": "D",
            "text": "Digital restoration can be deployed at maximum scale without monitoring or mitigation.",
        },
    ]
    q["correct_answer"] = "B"
    q["explanation"] = (
        "Silva values access; Berg warns that smoothing frame rates erases deliberate rhythmic "
        "choices. The correct choice says the benefits can be retained only if restoration is "
        "modified to preserve those choices."
    )
    q["distractor_rationales"] = {
        "A": "The passage discusses access and rhythmic fidelity, not mathematical impossibility.",
        "C": "Berg's concern applies to current restoration practice, not only decommissioned systems.",
        "D": "Berg explicitly cautions against adoption without safeguards.",
    }

    # P2: the bike-rental item is subtraction, not a percentage task, and its
    # context sentence was composed from unrelated pools.
    q = questions["M13-DATA-B001"]
    q["skill"] = "One-variable data: distributions and measures of center and spread"


def fix_missing_blanks(questions: dict[str, dict]) -> None:
    """Every 'completes the text' prompt gets an actual blank.

    Items ending in an open 'that' receive the blank in that clause. The
    reported INF-002 key is a because-clause, so its final period becomes a
    comma before the blank. Other full-sentence inference answers get a blank
    sentence at the end; lower-case answer clauses are capitalised so they can
    stand as that sentence.
    """
    for question in questions.values():
        if question.get("section") != "Reading and Writing":
            continue
        if not COMPLETES.search(question.get("prompt") or ""):
            continue
        stimulus = (question.get("stimulus") or "").rstrip()
        if "___" in stimulus:
            continue
        key = question.get("correct_answer")
        choices = question.get("choices") or []
        key_text = next((str(c.get("text") or "") for c in choices if c.get("id") == key), "")

        if stimulus.endswith("that"):
            stimulus = stimulus[:-4].rstrip() + " that ______"
        elif question.get("id") == "RW-INF-002":
            stimulus = stimulus.rstrip(".") + ", ______"
            # The key is a subordinate clause that completes the comma splice
            # naturally; the other choices remain independent sentences.
            for choice in choices:
                if choice.get("id") == key:
                    choice["text"] = choice["text"][:1].lower() + choice["text"][1:]
        else:
            if key_text[:1].islower():
                for choice in choices:
                    text = str(choice.get("text") or "")
                    if text:
                        choice["text"] = text[:1].upper() + text[1:]
            stimulus += "\n\n______"
        question["stimulus"] = stimulus


def fix_cross_text_headings(questions: dict[str, dict]) -> None:
    """Put Text 1 / Text 2 back on their own lines."""
    for question in questions.values():
        if question.get("skill") != "Cross-Text Connections":
            continue
        stimulus = question.get("stimulus") or ""
        if "Text 2" not in stimulus:
            continue
        stimulus = re.sub(r"(?<=[.!?])\s+Text 1\s*\n", "\n\nText 1\n", stimulus)
        stimulus = re.sub(r"(?<=[.!?])\s+Text 2\s*\n", "\n\nText 2\n", stimulus)
        # The older generated style used "Text 1: ..." / "Text 2: ..." inline.
        # Normalise it to the same line-start headings as the repaired items.
        stimulus = re.sub(r"(?m)^Text 1:\s*", "Text 1\n", stimulus)
        stimulus = re.sub(r"(?m)^Text 2:\s*", "Text 2\n", stimulus)
        question["stimulus"] = stimulus


def fix_m13_data_context(questions: dict[str, dict]) -> None:
    """Replace the unrelated three-pool context with a meaningful one."""
    for question in questions.values():
        qid = str(question.get("id") or "")
        if not re.match(r"^M13-DATA-(?:T|E|B|L)\d{3}$", qid):
            continue
        stimulus = GENERATED_CONTEXT.sub("", question.get("stimulus") or "").strip()
        label = None
        match = re.search(
            r"The (?:bar graph|line graph) shows (.+?)(?: recorded| over the periods|\.)",
            stimulus,
            re.I,
        )
        if match:
            label = match.group(1).strip()
        context = data_context(qid, label)
        if stimulus.startswith(context + " "):
            stimulus = stimulus[len(context) + 1 :]
        question["stimulus"] = f"{context} {stimulus}"
        if re.match(r"^M13-DATA-B\d{3}$", qid):
            question["skill"] = "One-variable data: distributions and measures of center and spread"


def main() -> int:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = by_id(bank)
    manual_repairs(questions)
    fix_missing_blanks(questions)
    fix_cross_text_headings(questions)
    fix_m13_data_context(questions)
    bank["bank_version"] = "2026.11.23-open-core-43"
    bank["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated {len(questions)} questions in {BANK}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

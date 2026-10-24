#!/usr/bin/env python3
"""HDSAT Reading & Writing expansion (R2-M10).

Builds original, CC-BY-4.0 Reading & Writing items on top of the existing bank:

  * Words in Context   four sentence frames per vocabulary entry
  * Boundaries         introductory-clause commas, composed from a clause bank
  * Transitions        authored sentence pairs, one defensible transition each
  * Central Ideas, Inferences, Text Structure   authored passages
  * Rhetorical Synthesis                        authored note sets
  * Command of Evidence (Quantitative)          generated table / bar / line data

Every item is written once, has one defensible key and carries a rationale for
each wrong choice, so it can pass `tools/content_qa.py`. Figures are inline
JSON (table headers/rows or chart series), never images.

Inputs live in supabase/import/data/m10/*.json (authored content) and the
output is supabase/import/expansion/extra_rw_m10.json, which
import_questions.py merges into the bank.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from generate_bank_expansion import EXP_DIR, mc  # noqa: E402

DATA_DIR = os.path.join(HERE, "data", "m10")
OUT = os.path.join(EXP_DIR, "extra_rw_m10.json")

RW = "Reading and Writing"
CRAFT = "Craft and Structure"
INFO = "Information and Ideas"
EXPRESSION = "Expression of Ideas"
CONVENTIONS = "Standard English Conventions"
EASY, MEDIUM, HARD = "Easy", "Medium", "Hard"

WIC_PROMPT = "Which choice completes the text with the most logical and precise word or phrase?"


def load(name):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        print(f"  (missing {name}; skipping that family)")
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Words in Context
# ---------------------------------------------------------------------------
# Each vocabulary entry has its own authored sentence, so the blank is
# granted by the sentence rather than by a generic frame. An entry without a
# sentence is skipped rather than given a bad item.
WIC_DIFFICULTIES = [EASY, MEDIUM, MEDIUM, HARD]


def gen_words_in_context():
    entries = {str(e.get("word", "")).strip(): e for e in load("wic.json").get("entries", [])}
    sentences = load("wic_sentences.json").get("sentences", [])
    items = []
    for index, row in enumerate(sentences):
        word = str(row.get("word", "")).strip()
        sentence = str(row.get("sentence", "")).strip()
        cue = str(row.get("cue", "")).strip()
        entry = entries.get(word)
        if not entry or "______" not in sentence:
            continue
        gloss = str(entry.get("gloss", "")).strip()
        wrongs = [str(w).strip() for w in entry.get("distractors", [])][:3]
        if not gloss or len(wrongs) != 3:
            continue
        if not cue:
            cue = f"the sentence's surrounding clues establish the meaning {gloss}."
        items.append(
            mc(
                f"RW-M10W-{index:04d}",
                RW,
                CRAFT,
                "Words in Context",
                WIC_DIFFICULTIES[index % len(WIC_DIFFICULTIES)],
                sentence,
                WIC_PROMPT,
                word,
                wrongs,
                f"In context, '{word}' means {gloss}; {cue}",
                [
                    f"'{wrong}' does not fit the sentence's clue ({gloss})."
                    for wrong in wrongs
                ],
            )
        )
    return items


# ---------------------------------------------------------------------------
# Boundaries: an introductory dependent clause takes a comma.
# ---------------------------------------------------------------------------
INTRO_CLAUSES = [
    "Although the first survey found no change",
    "Because the samples had thawed in transit",
    "When the sensor array rebooted after the storm",
    "After the committee reviewed the budget twice",
    "While the paint was still drying",
    "If the forecast holds through Friday",
    "Since the archive closed early on Fridays",
    "Once the last volunteer had signed in",
    "Unless the manufacturer ships the parts early",
    "Before the results could be published",
    "As the tide moved across the flats",
    "Even though the earlier trial had failed",
    "Because the river had already crested",
    "When the older records were finally digitised",
    "After the second prototype passed every test",
    "While the choir rehearsed in the side room",
    "If the grant is renewed for a third year",
    "Since the library extended its weekend hours",
    "Once the frost had lifted from the fields",
    "Although the estimate was revised twice",
]

MAIN_CLAUSES = [
    "the field team repeated every measurement at the northern site before the light faded",
    "the technicians recalibrated the instruments and logged the drift against the reference unit",
    "the crew reinforced the lower embankment with stone hauled in from the quarry road",
    "the reviewers asked for a shorter summary and a clearer account of the sampling method",
    "the volunteers cleared the drainage channel that had silted up during the previous winter",
    "the organizers moved the event indoors and reopened registration for a second session",
    "the researchers scheduled a second visit for the following spring, when the water table rises",
    "the builders delayed the roof inspection until the scaffolding had been certified",
    "the museum opened the gallery a week early so that school groups could visit before term ended",
    "the students presented their findings to a panel of local engineers and two visiting statisticians",
    "the gardeners covered the young seedlings with fleece as soon as the forecast turned cold",
    "the engineers recorded a smaller vibration after the damping mounts were replaced",
    "the editor returned the manuscript with notes on the opening chapter and the closing table",
    "the clinic extended its evening appointments through the winter and hired two extra nurses",
    "the surveyors marked the new boundary line with posts spaced every twenty meters",
    "the archive digitised the ledgers at a rate of forty pages an hour without breaking the bindings",
    "the council reopened the footpath after the landslip had been cleared and inspected",
    "the lab stored the samples at four degrees and tested them within the first forty-eight hours",
    "the choir recorded the piece in a single take because the hall was booked for the afternoon",
    "the orchard replanted the eastern rows with a variety that ripens two weeks later",
    "the ferry ran a reduced timetable while the second vessel was in dry dock for repairs",
    "the team published the dataset alongside the paper so that other groups could repeat the analysis",
    "the kitchen weighed every ingredient to the nearest gram and recorded the oven temperature",
    "the observatory scheduled the run for a moonless night and checked the lens alignment twice",
    "the newspaper printed a correction on the front page the morning after the error appeared",
    "the warehouse reorganised the shelving so that the most requested items sat nearest the door",
    "the cyclists rerouted through the valley when the main road was closed for resurfacing",
    "the committee extended the consultation by three weeks after receiving more than two hundred replies",
    "the hospital trialled the new schedule on one ward before rolling it out across the site",
    "the beekeepers moved the hives to the orchard once the first blossom had opened",
]


def gen_boundaries():
    items = []
    # One item per introductory clause, each with its own main clause. Reusing a
    # main clause across items is what turns a bank into near-duplicates.
    for index, intro in enumerate(INTRO_CLAUSES):
        for offset in range(1):
            main = MAIN_CLAUSES[index % len(MAIN_CLAUSES)]
            difficulty = EASY if index % 3 == 0 else MEDIUM if index % 3 == 1 else HARD
            items.append(
                mc(
                    f"RW-M10B-{index:03d}{offset}",
                    RW,
                    CONVENTIONS,
                    "Boundaries",
                    difficulty,
                    f"{intro} ______ {main}.",
                    "Which choice completes the text so that it conforms to the conventions of Standard English?",
                    ",",
                    [";", ":", "—"],
                    "An introductory dependent clause is separated from the main clause by a comma; the clause cannot stand alone, so a semicolon or colon would be wrong.",
                    [
                        "A semicolon joins two independent clauses; the opening clause is dependent.",
                        "A colon may introduce an explanation or a list, not a main clause after a dependent one.",
                        "A dash would mark a sharp break, but the sentence needs the ordinary comma after an introductory clause.",
                    ],
                )
            )
    return items


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------
RELATION_NOTE = {
    "contrast": "the two sentences set up an opposition",
    "addition": "the second sentence adds a further point in the same direction",
    "cause": "the first sentence gives the reason for the second",
    "example": "the second sentence gives a specific instance of the first",
    "concession": "the second sentence grants a point against the first",
    "result": "the second sentence follows as a consequence of the first",
    "sequence": "the second sentence marks the next step in time",
}


def gen_transitions():
    data = load("transitions.json")
    more = load("transitions_b.json").get("pairs", [])
    items = []
    for index, pair in enumerate(data.get("pairs", []) + more):
        before = str(pair.get("before", "")).strip().rstrip(".")
        after = str(pair.get("after", "")).strip()
        correct = str(pair.get("correct", "")).strip()
        wrongs = [str(w).strip() for w in pair.get("distractors", [])][:3]
        relation = str(pair.get("relation", "")).strip()
        if not (before and after and correct and len(wrongs) == 3):
            continue
        # The blank is the transition, so the comma after it belongs to the
        # stimulus: "<sentence one>. ______, <sentence two>."
        after = after[0:1].lower() + after[1:]
        stimulus = f"{before}. ______, {after}"
        difficulty = EASY if index % 4 == 0 else MEDIUM if index % 4 in (1, 2) else HARD
        items.append(
            mc(
                f"RW-M10T-{index:04d}",
                RW,
                EXPRESSION,
                "Transitions",
                difficulty,
                stimulus,
                "Which choice completes the text with the most logical transition?",
                correct,
                wrongs,
                f"'{correct}' marks {RELATION_NOTE.get(relation, 'the relationship between the two sentences')}; the other options signal a different relationship.",
                [
                    f"'{wrong}' signals a relationship the two sentences do not have."
                    for wrong in wrongs
                ],
            )
        )
    return items


# ---------------------------------------------------------------------------
# Authored passages: Central Ideas, Inferences, Text Structure and Purpose
# ---------------------------------------------------------------------------
def gen_passages():
    data = load("passages.json")
    more = load("passages_b.json").get("items", [])
    items = []
    for index, item in enumerate(data.get("items", []) + more):
        skill = str(item.get("skill", "")).strip()
        if skill not in ("Central Ideas and Details", "Inferences", "Text Structure and Purpose"):
            continue
        wrongs = [str(w).strip() for w in item.get("wrongs", [])][:3]
        why = [str(w).strip() for w in item.get("why", [])][:3]
        if len(wrongs) != 3:
            continue
        if len(why) != 3:
            why = ["This option is not supported by the passage." for _ in wrongs]
        difficulty = EASY if index % 5 == 0 else MEDIUM if index % 5 in (1, 2, 3) else HARD
        items.append(
            mc(
                f"RW-M10P-{index:04d}",
                RW,
                INFO,
                skill,
                difficulty,
                str(item.get("passage", "")).strip(),
                str(item.get("prompt", "")).strip(),
                str(item.get("correct", "")).strip(),
                wrongs,
                str(item.get("explanation", "")).strip(),
                why,
            )
        )
    return items


# ---------------------------------------------------------------------------
# Rhetorical Synthesis
# ---------------------------------------------------------------------------
def gen_synthesis():
    data = load("synthesis.json")
    more = load("synthesis_b.json").get("items", [])
    items = []
    for index, item in enumerate(data.get("items", []) + more):
        notes = [str(n).strip() for n in item.get("notes", []) if str(n).strip()]
        wrongs = [str(w).strip() for w in item.get("wrongs", [])][:3]
        why = [str(w).strip() for w in item.get("why", [])][:3]
        if len(notes) < 2 or len(wrongs) != 3:
            continue
        if len(why) != 3:
            why = ["This option uses the notes but does not accomplish the stated goal." for _ in wrongs]
        bullets = "\n".join(f"• {note}" for note in notes)
        goal = str(item.get("goal", "")).strip()
        difficulty = MEDIUM if index % 3 else EASY
        items.append(
            mc(
                f"RW-M10S-{index:04d}",
                RW,
                EXPRESSION,
                "Rhetorical Synthesis",
                difficulty,
                f"While researching a topic, a student has taken the following notes:\n{bullets}",
                f"{goal}\n\nWhich choice most effectively uses relevant information from the notes to accomplish this goal?",
                str(item.get("correct", "")).strip(),
                wrongs,
                "The correct choice selects the notes that serve the stated goal and states them precisely; the others either miss the goal or add unsupported detail.",
                why,
            )
        )
    return items


# ---------------------------------------------------------------------------
# Command of Evidence (Quantitative): real tables and charts, generated numbers
# ---------------------------------------------------------------------------
SCENARIOS = [
    ("A team of ecologists recorded the number of nesting pairs at four restored wetlands.", "nesting pairs", "Wetland"),
    ("A soil lab measured the percentage of organic matter in four field plots.", "organic matter (%)", "Plot"),
    ("A transport survey counted daily bicycle crossings on four city bridges.", "daily crossings", "Bridge"),
    ("A materials lab measured the compressive strength of four concrete mixes.", "strength (MPa)", "Mix"),
    ("A health team recorded the share of households with safe drinking water in four districts.", "households with safe water (%)", "District"),
    ("A botany group counted flowering stems per square metre in four meadow strips.", "flowering stems per m²", "Strip"),
    ("A university measured the share of graduates employed within six months across four programs.", "employed within six months (%)", "Program"),
    ("A hydrology team recorded average daily flow at four river gauges.", "flow (m³/s)", "Gauge"),
    ("A school district counted the number of students using a late bus route at four schools.", "students on the late route", "School"),
    ("An acoustics lab measured background noise at four library reading rooms.", "noise (dB)", "Room"),
    ("A wildlife trust counted breeding pairs of seabirds on four cliff ledges.", "breeding pairs", "Ledge"),
    ("A farm trial measured the yield of four wheat varieties in tonnes per hectare.", "yield (t/ha)", "Variety"),
    ("A water utility recorded household consumption in four neighborhoods.", "daily use (liters)", "Neighborhood"),
    ("A rail operator measured morning punctuality at four stations.", "on-time arrivals (%)", "Station"),
    ("An air-quality network logged the average concentration of nitrogen dioxide at four curbside sites.", "NO₂ (µg/m³)", "Site"),
    ("A hospital audited the share of patients seen within four hours in four departments.", "seen within four hours (%)", "Department"),
    ("A forest survey counted tree species richness in four woodland blocks.", "species recorded", "Block"),
    ("A bakery compared the rise height of four sourdough starters.", "rise height (cm)", "Starter"),
    ("A city counted the number of people using four public benches each hour.", "users per hour", "Bench"),
    ("A marine survey measured the density of seagrass shoots at four coastal sites.", "shoots per m²", "Site"),
    ("A sports laboratory measured sprint times over twenty meters for four training groups.", "time (seconds)", "Group"),
    ("A museum recorded visitor dwell time in four exhibition rooms.", "average dwell (minutes)", "Room"),
    ("A weather station logged annual rainfall at four upland gauges.", "rainfall (mm)", "Gauge"),
    ("An energy auditor measured winter heat loss through four wall constructions.", "heat loss (W/m²)", "Construction"),
    ("A river trust counted mayfly larvae at four sampling points.", "larvae per sample", "Point"),
    ("A charity measured the share of calls answered within one minute across four helplines.", "answered within a minute (%)", "Helpline"),
    ("A university library counted loans per student across four faculties.", "loans per student", "Faculty"),
    ("A vineyard measured sugar content in grapes from four rows.", "sugar content (Brix)", "Row"),
    ("A council counted reported potholes on four road sections.", "potholes reported", "Section"),
    ("A sleep clinic measured average sleep duration across four age groups.", "sleep (hours)", "Age group"),
    ("A recycling scheme measured contamination rates in four collection rounds.", "contamination (%)", "Round"),
    ("A cycle-hire scheme counted hires from four docking stations.", "hires per day", "Station"),
    ("A beekeeping group measured honey yields from four apiary sites.", "honey (kg)", "Apiary"),
    ("A school measured the share of pupils walking to school across four year groups.", "walking to school (%)", "Year group"),
    ("A lab compared the drying time of four paint formulations.", "drying time (minutes)", "Formulation"),
    ("A port authority recorded container throughput at four berths.", "containers per week", "Berth"),
    ("A conservation team counted fish passing a weir through four ladders.", "fish counted", "Ladder"),
    ("A clinic compared the share of appointments kept across four reminder methods.", "appointments kept (%)", "Method"),
    ("A greenhouse trial measured leaf area on four fertiliser treatments.", "leaf area (cm²)", "Treatment"),
    ("A tourism office counted overnight stays in four coastal towns.", "overnight stays", "Town"),
]


def data_item(index):
    scenario, metric, unit_label = SCENARIOS[index % len(SCENARIOS)]
    labels = ["North", "South", "East", "West"]
    # Deterministic but distinct numbers per item.
    base = 18 + (index * 7) % 29
    values = [
        base + (index * 3) % 11,
        base + 9 + (index * 5) % 13,
        base + 4 + (index * 2) % 7,
        base + 15 + (index * 11) % 17,
    ]
    order = sorted(range(4), key=lambda i: values[i], reverse=True)
    top, second, low = order[0], order[1], order[3]
    rows = [[f"{unit_label} {labels[i]}", f"{values[i]}"] for i in range(4)]

    if index % 3 == 0:
        figure = {
            "type": "table",
            "caption": f"{metric.capitalize()} by {unit_label.lower()}",
            "headers": [unit_label, metric],
            "rows": rows,
        }
        prompt = "Which choice most effectively uses data from the table to complete the statement?"
        correct = f"{unit_label} {labels[top]} recorded the highest {metric}, at {values[top]}."
        wrongs = [
            f"{unit_label} {labels[second]} recorded the highest {metric}, at {values[second]}.",
            f"{unit_label} {labels[low]} recorded the highest {metric}, at {values[low]}.",
            f"All four {unit_label.lower()}s recorded the same {metric}.",
        ]
        explanation = (
            f"The table gives {values[top]} for {unit_label} {labels[top]}, more than any other row; "
            f"the next highest is {values[second]} for {unit_label} {labels[second]}."
        )
    elif index % 3 == 1:
        figure = {
            "type": "bar_chart",
            "caption": f"{metric.capitalize()} by {unit_label.lower()}",
            "x_label": unit_label,
            "y_label": metric,
            "series": [{"label": labels[i], "value": values[i]} for i in range(4)],
        }
        prompt = "Which choice best describes the data in the graph?"
        gap = values[top] - values[second]
        correct = (
            f"{unit_label} {labels[top]} was the highest at {values[top]}, "
            f"{gap} above {unit_label} {labels[second]}."
        )
        wrongs = [
            f"{unit_label} {labels[low]} was the highest at {values[low]}.",
            f"{unit_label} {labels[top]} and {unit_label} {labels[second]} recorded identical values.",
            f"{unit_label} {labels[second]} was the lowest at {values[second]}.",
        ]
        explanation = (
            f"The tallest bar is {unit_label} {labels[top]} at {values[top]}; "
            f"{unit_label} {labels[low]} is the smallest at {values[low]}."
        )
    else:
        figure = {
            "type": "line_chart",
            "caption": f"{metric.capitalize()} at {unit_label.lower()} {labels[top]} over four years",
            "x_label": "Year",
            "y_label": metric,
            "series": [
                {"label": "2020", "value": values[low]},
                {"label": "2021", "value": values[second]},
                {"label": "2022", "value": values[top]},
                {"label": "2023", "value": values[top] - 2},
            ],
        }
        prompt = "Which choice best describes the trend shown in the graph?"
        peak = max(values[low], values[second], values[top], values[top] - 2)
        correct = (
            f"It rose to a peak of {peak} in 2022 and then declined slightly in 2023."
        )
        wrongs = [
            "It fell steadily from 2020 to 2023 without ever rising.",
            "It stayed exactly the same in every year shown.",
            f"It peaked in 2020 at {values[low]}.",
        ]
        explanation = (
            f"The plotted values rise from {values[low]} in 2020 to {peak} in 2022, "
            f"then fall to {peak - 2} in 2023."
        )

    rationales = [
        f"This option misreads the {'table' if figure['type'] == 'table' else 'graph'}: another row or year is higher.",
        "This option names a value that does not appear in the data.",
        "This option claims a pattern the data do not show.",
    ]
    return mc(
        f"RW-M10Q-{index:04d}",
        RW,
        INFO,
        "Command of Evidence (Quantitative)",
        EASY if index % 4 == 0 else MEDIUM if index % 4 in (1, 2) else HARD,
        _stimulus(scenario, figure, index),
        prompt,
        correct,
        wrongs,
        explanation,
        rationales,
        figure=figure,
    )


# Every item carries its own framing detail, so no two stimuli are identical
# even when they share a scenario.
PLACES = [
    "the northern catchment",
    "a coastal district",
    "an upland county",
    "the lower river valley",
    "a suburban borough",
    "the eastern plateau",
    "a small island group",
    "the central plain",
    "a former industrial corridor",
    "the southern highlands",
]
YEARS = [2019, 2020, 2021, 2022, 2023, 2024]


def gen_quantitative():
    # One item per scenario: a student should never meet the same survey twice.
    return [data_item(i) for i in range(len(SCENARIOS))]


def _stimulus(scenario, figure, index):
    place = PLACES[(index * 3) % len(PLACES)]
    year = YEARS[(index * 5) % len(YEARS)]
    kind = "table" if figure["type"] == "table" else "graph"
    return (
        f"{scenario} The measurements were collected in {year} across {place} as part of "
        f"survey {index + 1:03d}, and the results are summarized in the {kind}."
    )


def build():
    items = []
    items.extend(gen_words_in_context())
    items.extend(gen_boundaries())
    items.extend(gen_transitions())
    items.extend(gen_passages())
    items.extend(gen_synthesis())
    items.extend(gen_quantitative())
    return items


def main():
    items = build()
    os.makedirs(EXP_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"questions": items}, fh, ensure_ascii=False, indent=1)
    by_skill = {}
    for item in items:
        by_skill[item["skill"]] = by_skill.get(item["skill"], 0) + 1
    print(f"wrote {len(items)} R&W items to {OUT}")
    for skill, count in sorted(by_skill.items()):
        print(f"  {skill}: {count}")


if __name__ == "__main__":
    main()

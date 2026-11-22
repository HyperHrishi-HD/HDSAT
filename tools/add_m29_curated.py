#!/usr/bin/env python3
"""Add the M29 curated expansion to the source-of-truth bank.

The 10,000-item bank is large but has a thin curated layer. This batch adds
original Reading & Writing and Math items that target the domains students
actually meet in the adaptive sets, with complete rationales and no figure
dependencies. It is deliberately small enough to review by hand.

Run:
    python tools/add_m29_curated.py
    python tools/add_m29_curated.py --check
"""
from __future__ import annotations

import argparse
import collections
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"
SEED = ROOT / "supabase" / "seed" / "0024_m29_curated_expansion.sql"
VERSION = "2026.11.06-open-core-37"
SOURCE = {
    "source_id": "hdsat-open-core-2026",
    "source_name": "HDSAT Open Core Curated Bank",
    "license": "CC-BY-4.0",
    "attribution": "HDSAT Open Core Curated Bank (CC-BY-4.0)",
}
ASSESSMENTS = ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"]


def item(
    qid: str,
    domain: str,
    skill: str,
    difficulty: str,
    stimulus: str | None,
    prompt: str,
    choices: list[tuple[str, str]] | None,
    key: str,
    explanation: str,
    rationales: dict[str, str],
    *,
    fmt: str = "multiple_choice",
    acceptable: list[str] | None = None,
) -> dict:
    return {
        "id": qid,
        "external_id": f"HDSAT-{qid}",
        "assessments": ASSESSMENTS,
        "section": "Reading and Writing" if qid.startswith("RW-") else "Math",
        "domain": domain,
        "skill": skill,
        "difficulty": difficulty,
        "format": fmt,
        "stimulus": stimulus,
        "prompt": prompt,
        "choices": [{"id": letter, "text": text} for letter, text in choices] if choices else None,
        "figure_metadata": None,
        "correct_answer": key,
        "acceptable_answers": acceptable or [key],
        "explanation": explanation,
        "distractor_rationales": rationales,
        "choice_order_seed": f"hdsat-choice-order:{qid}" if fmt == "multiple_choice" else None,
        **SOURCE,
        "is_released_practice_set": False,
    }


QUESTIONS = [
    item(
        "RW-INF-M29-01",
        "Information and Ideas",
        "Central Ideas and Details",
        "Medium",
        "In a three-year study of restored tallgrass prairies, ecologists seeded half the plots with a mix of thirty native species and half with a mix of eight. The diverse plots established more slowly at first, but by the third year they produced about 40 percent more biomass during an experimental drought and supported twice as many specialist bee species. The researchers concluded that species diversity can improve both drought resilience and pollinator habitat, even when a diverse planting takes longer to establish.",
        "Which choice best states the main idea of the text?",
        [
            ("A", "Restored prairies establish more quickly when they are seeded with only eight native species."),
            ("B", "A diverse native seed mix can improve drought resilience and pollinator habitat even when it establishes more slowly than a species-poor mix."),
            ("C", "Specialist bee species prefer restored prairies that contain only eight plant species."),
            ("D", "Drought biomass in restored prairies depends primarily on rainfall rather than on species richness."),
        ],
        "B",
        "The passage's central claim is that the thirty-species plots, despite slower early establishment, produced more biomass under drought and supported more specialist bees. The keyed choice captures both benefits and the trade-off.",
        {
            "A": "The passage says the diverse plots established more slowly, not more quickly.",
            "C": "The diverse plots supported twice as many specialist bee species, so the opposite is true.",
            "D": "The study compared seed mixes during a drought; it did not claim rainfall outweighed species richness.",
        },
    ),
    item(
        "RW-INF-M29-02",
        "Information and Ideas",
        "Inferences",
        "Hard",
        "Medieval portolan charts plotted coastlines and sailing routes with striking accuracy, and their rhumb lines radiate from compass roses. Yet no surviving chart records the local magnetic declination that navigators would have needed to convert a magnetic bearing into a true bearing. Because uncorrected magnetic bearings would produce growing errors on long voyages, historians infer that",
        "Which choice most logically completes the text?",
        [
            ("A", "portolan charts were copied directly from ancient Roman maps that already showed magnetic declination."),
            ("B", "magnetic declination was too small in the medieval Mediterranean to affect a ship's course."),
            ("C", "chart makers must have used astronomical observations or other corrections that the surviving charts do not preserve."),
            ("D", "medieval navigators avoided long voyages until magnetic declination was formally measured."),
        ],
        "C",
        "The passage sets up a puzzle: the charts are accurate, but they do not record the declination needed to turn magnetic readings into true bearings. The most logical inference is that corrections existed in another form and were not written on the surviving charts.",
        {
            "A": "The passage gives no evidence that Roman maps already recorded magnetic declination.",
            "B": "If declination were negligible, the passage would not describe cumulative errors on long voyages.",
            "D": "The passage says the charts were used for sailing routes, not that long voyages were avoided.",
        },
    ),
    item(
        "RW-INF-M29-03",
        "Information and Ideas",
        "Command of Evidence (Textual)",
        "Medium",
        "Literary critic Maya Chen argues that in the novel The House on the Quay, the narrator's outward composure conceals acute anxiety. Chen notes that the narrator describes household routines in careful detail while avoiding every direct statement about the family's financial collapse.",
        "Which quotation from the novel would most directly support Chen's claim?",
        [
            ("A", "\"I smoothed the tablecloth and returned each spoon to its place, though I could hear my own pulse and twice set the sugar bowl beside the wrong cup.\""),
            ("B", "\"The dining room wallpaper had been imported from Lisbon, and its blue medallions caught the afternoon light.\""),
            ("C", "\"My brother preferred the garden in the early morning, when the servants had not yet opened the shutters.\""),
            ("D", "\"We spoke of the weather and of a cousin's wedding, and I slept soundly after they had gone.\""),
        ],
        "A",
        "The keyed quotation shows the narrator performing calm domestic order while betraying physical signs of panic: a racing pulse and a repeatedly misplaced object. That is exactly the gap between surface composure and hidden anxiety that Chen describes.",
        {
            "B": "The wallpaper description supplies decorative detail but reveals no anxiety beneath composure.",
            "C": "The brother's preference for the garden has no bearing on the narrator's concealed fear.",
            "D": "Sound sleep and ordinary conversation suggest composure without underlying distress.",
        },
    ),
    item(
        "RW-INF-M29-04",
        "Information and Ideas",
        "Central Ideas and Details",
        "Easy",
        "To reconstruct past mercury deposition in remote lakes, researchers collect sediment cores from lake bottoms. Mercury binds to organic particles that settle out of the water, so each dated layer of sediment preserves a record of the mercury present when that layer formed. By measuring mercury concentrations in successive layers, scientists can distinguish broad atmospheric deposition from local geological sources and track how deposition changed over centuries.",
        "According to the text, why do researchers measure mercury in dated sediment layers?",
        [
            ("A", "To identify the species of fish that lived in the lake during each period."),
            ("B", "To determine how quickly organic particles sink to the lake bottom."),
            ("C", "To measure the current mercury concentration of the lake water."),
            ("D", "To reconstruct how mercury deposition changed over time."),
        ],
        "D",
        "The passage explains that dated layers preserve mercury from the time each layer formed, which lets scientists track deposition over centuries and separate atmospheric from geological sources.",
        {
            "A": "The text does not use sediment mercury to identify fish species.",
            "B": "Sinking speed is part of how the record forms, not the reason researchers measure it.",
            "C": "The cores record past deposition, not only the lake's present mercury level.",
        },
    ),
    item(
        "RW-CRF-M29-01",
        "Craft and Structure",
        "Words in Context",
        "Medium",
        "Reviewers often call the novelist's prose _______: within a single paragraph she can move from tender lyricism to biting satire, and her narrators may be generous in one sentence and merciless in the next.",
        "Which choice completes the text with the most logical and precise word or phrase?",
        [
            ("A", "monolithic"),
            ("B", "mercurial"),
            ("C", "didactic"),
            ("D", "laconic"),
        ],
        "B",
        "The sentence emphasizes rapid shifts in tone and temperament, so \"mercurial\" — changeable or volatile — is the precise fit.",
        {
            "A": "\"Monolithic\" means uniform and unchanging, the opposite of the described shifts.",
            "C": "\"Didactic\" means intended to teach a moral lesson, which the sentence does not describe.",
            "D": "\"Laconic\" means using very few words, not changing tone abruptly.",
        },
    ),
    item(
        "RW-CRF-M29-02",
        "Craft and Structure",
        "Text Structure and Purpose",
        "Medium",
        "For decades, scholars treated the Antikythera mechanism as a decorative astronomical showpiece. Then, in 2006, computed tomography revealed more than thirty interlocking bronze gears inside the corroded fragments. That discovery allowed researchers to model the device's gear ratios and show that it could predict eclipses and track the positions of the sun and moon. The mechanism is now understood as a sophisticated calendar computer rather than an ornamental curiosity.",
        "Which choice best describes the overall structure of the text?",
        [
            ("A", "It compares two ancient devices and argues that one is more accurate than the other."),
            ("B", "It describes the materials used to build an object and explains how they were mined."),
            ("C", "It presents a long-standing assumption and then explains how new evidence revised that assumption."),
            ("D", "It lists the steps of an archaeological excavation and evaluates the training of its workers."),
        ],
        "C",
        "The text begins with the old view of the mechanism as a showpiece, then describes the CT scan evidence and the revised conclusion that it was a calendar computer.",
        {
            "A": "Only one device is discussed; there is no comparison between two objects.",
            "B": "Materials and mining are not the subject of the passage.",
            "D": "The passage does not describe an excavation procedure or worker training.",
        },
    ),
    item(
        "RW-CRF-M29-03",
        "Craft and Structure",
        "Cross-Text Connections",
        "Hard",
        "Text 1\nHistorian Lena Ortiz argues that the spread of the telegraph in the 1840s made American newspaper reporting more uniform. Because wire copy could be sent to many papers at once, editors increasingly published the same national and international dispatches, Ortiz contends, gradually eroding distinctive local reporting styles.\n\nText 2\nMedia historian Paul Chen notes that rural editors did subscribe to wire services, but they often rewrote dispatches to emphasize local concerns, added commentary, and sometimes omitted stories that did not interest their readers. Wire copy gave papers shared material, Chen concludes, without determining how that material was presented.",
        "Based on the texts, how would Chen (Text 2) most likely respond to Ortiz's argument (Text 1)?",
        [
            ("A", "By agreeing that the telegraph spread shared material but arguing that local editors shaped its presentation, limiting the uniformity Ortiz describes."),
            ("B", "By arguing that rural editors refused to subscribe to wire services because the dispatches were too expensive."),
            ("C", "By claiming that the telegraph had no effect on the content of American newspapers."),
            ("D", "By agreeing that local reporting styles disappeared completely after the 1840s."),
        ],
        "A",
        "Chen accepts that wire copy supplied shared material, but he emphasizes local rewriting, commentary, and selection. That is a qualified response: shared inputs did not produce uniform output.",
        {
            "B": "Chen says rural editors did subscribe, so this contradicts his account.",
            "C": "Chen acknowledges that the telegraph gave papers shared material; he does not deny any effect.",
            "D": "Chen argues that local editors shaped wire copy, which undercuts the claim that local styles disappeared.",
        },
    ),
    item(
        "RW-EXP-M29-01",
        "Expression of Ideas",
        "Transitions",
        "Easy",
        "Early textile mills clustered along rivers because waterwheels supplied their power. _______ the development of compact high-pressure steam engines allowed manufacturers to build mills near ports and railroads instead.",
        "Which choice completes the text with the most logical transition?",
        [
            ("A", "For example,"),
            ("B", "Similarly,"),
            ("C", "In addition,"),
            ("D", "Eventually,"),
        ],
        "D",
        "The second sentence describes a later change in where mills could be built, so a time transition such as \"Eventually\" marks the shift from river power to steam power.",
        {
            "A": "\"For example\" would present the steam-engine change as an illustration of river power, not a later development.",
            "B": "\"Similarly\" would suggest the second sentence continues the same pattern rather than replacing it.",
            "C": "\"In addition\" would imply both power sources were being discussed together, not a historical change.",
        },
    ),
    item(
        "RW-EXP-M29-02",
        "Expression of Ideas",
        "Rhetorical Synthesis",
        "Medium",
        "While researching a topic, a student has taken the following notes:\n- Alice Ball (1892–1916) was a chemist at the University of Hawaii.\n- She developed a method that made chaulmoogra oil water-soluble and injectable.\n- Before her method, leprosy patients received the oil orally or through painful injections that often caused abscesses.\n- Her injectable treatment was used until sulfone drugs replaced it in the 1940s.",
        "The student wants to emphasize the significance of Ball's method for treating leprosy. Which choice most effectively uses relevant information from the notes to accomplish this goal?",
        [
            ("A", "Alice Ball was a chemist at the University of Hawaii who was born in 1892."),
            ("B", "Ball's method made chaulmoogra oil water-soluble and injectable, turning a painful and unreliable treatment into one that could be delivered consistently."),
            ("C", "Sulfone drugs replaced chaulmoogra oil treatment in the 1940s."),
            ("D", "Chaulmoogra oil was sometimes taken orally before researchers developed other treatments."),
        ],
        "B",
        "The keyed response states what Ball's method changed — solubility and injectability — and explains why that mattered: it made a painful, unreliable treatment consistently deliverable.",
        {
            "A": "Birth year and employer do not explain why the method was significant.",
            "C": "The later replacement of the treatment does not show what Ball's method accomplished.",
            "D": "The oral-use detail is background and does not identify Ball's contribution.",
        },
    ),
    item(
        "RW-SEC-M29-01",
        "Standard English Conventions",
        "Boundaries",
        "Easy",
        "The city's oldest library, a converted nineteenth-century warehouse ___ has served residents for more than a century.",
        "Which choice completes the text so that it conforms to the conventions of Standard English?",
        [
            ("A", ","),
            ("B", ";"),
            ("C", ":"),
            ("D", "—"),
        ],
        "A",
        "The phrase \"a converted nineteenth-century warehouse\" is a nonessential appositive opened by a comma after \"library,\" so it must be closed by a matching comma before \"has served.\"",
        {
            "B": "A semicolon would separate two independent clauses, but \"has served residents...\" has no subject of its own here.",
            "C": "A colon would introduce an explanation or list, not close the appositive.",
            "D": "A single dash would not match the comma that opened the appositive.",
        },
    ),
    item(
        "RW-SEC-M29-02",
        "Standard English Conventions",
        "Form, Structure, and Sense",
        "Medium",
        "The collection of letters, along with several unpublished photographs, ___ acquired by the archive in 1998.",
        "Which choice completes the text so that it conforms to the conventions of Standard English?",
        [
            ("A", "were"),
            ("B", "have been"),
            ("C", "was"),
            ("D", "are"),
        ],
        "C",
        "The subject is the singular noun \"collection\"; the phrase \"along with several unpublished photographs\" does not change the subject. The singular past-tense verb \"was\" agrees with it.",
        {
            "A": "\"Were\" is plural and does not agree with the singular subject \"collection.\"",
            "B": "\"Have been\" is plural and also shifts to the present perfect, which does not fit the 1998 date.",
            "D": "\"Are\" is plural and present tense, neither of which fits the subject and date.",
        },
    ),
    item(
        "RW-SEC-M29-03",
        "Standard English Conventions",
        "Boundaries",
        "Medium",
        "The researchers expected the bacteria to die in the acidic water ___ they instead multiplied rapidly.",
        "Which choice completes the text so that it conforms to the conventions of Standard English?",
        [
            ("A", "however"),
            ("B", "; however,"),
            ("C", ", however"),
            ("D", "; however"),
        ],
        "B",
        "Two independent clauses need a semicolon before the conjunctive adverb \"however,\" and the comma after \"however\" sets off the transition.",
        {
            "A": "Without punctuation, the two independent clauses run together.",
            "C": "A comma before \"however\" creates a comma splice.",
            "D": "The semicolon is correct, but the comma after \"however\" is still required.",
        },
    ),
    item(
        "M-ALG-M29-01",
        "Algebra",
        "Linear equations in one variable",
        "Easy",
        "$$3(2x - 5) = 4x + 7$$",
        "What is the value of $x$?",
        [
            ("A", "$11$"),
            ("B", "$4$"),
            ("C", "$8$"),
            ("D", "$22$"),
        ],
        "A",
        "Distribute: $6x - 15 = 4x + 7$. Subtract $4x$ from both sides: $2x - 15 = 7$. Add 15: $2x = 22$, so $x = 11$.",
        {
            "B": "$4$ results from dropping the $-15$ when distributing.",
            "C": "$8$ results from adding 15 to only one side before dividing.",
            "D": "$22$ is the value of $2x$, not of $x$.",
        },
    ),
    item(
        "M-ALG-M29-02",
        "Algebra",
        "Systems of two linear equations in two variables",
        "Medium",
        "$$3x + 2y = 19$$\n$$x - y = 3$$",
        "If $(x, y)$ is the solution to the given system, what is the value of $x + y$?",
        None,
        "7",
        "From $x - y = 3$, $x = y + 3$. Substitute into $3x + 2y = 19$: $3(y + 3) + 2y = 19$, so $5y + 9 = 19$ and $y = 2$. Then $x = 5$, and $x + y = 7$.",
        {},
        fmt="spr",
        acceptable=["7", "7.0"],
    ),
    item(
        "M-ALG-M29-03",
        "Algebra",
        "Linear inequalities in one or two variables",
        "Medium",
        "A delivery van has an empty mass of 2,400 kilograms and will carry identical boxes that each have a mass of 35 kilograms. A bridge has a posted mass limit of 3,200 kilograms for the loaded van.",
        "What is the greatest number of boxes the van can carry across the bridge?",
        [
            ("A", "$22$"),
            ("B", "$23$"),
            ("C", "$20$"),
            ("D", "$24$"),
        ],
        "A",
        "The loaded mass is $2{,}400 + 35b$, which must be at most $3{,}200$. Thus $35b \\le 800$, so $b \\le 22.857...$. The greatest whole number of boxes is 22.",
        {
            "B": "23 boxes would add $805$ kilograms, exceeding the 800-kilogram allowance.",
            "C": "20 boxes is below the maximum, but the question asks for the greatest number.",
            "D": "24 boxes would add $840$ kilograms, which is over the limit.",
        },
    ),
    item(
        "M-ADV-M29-01",
        "Advanced Math",
        "Quadratic functions: vertex and symmetry",
        "Medium",
        "$$f(x) = x^2 - 6x + 5$$",
        "What is the minimum value of $f(x)$?",
        [
            ("A", "$-4$"),
            ("B", "$-3$"),
            ("C", "$3$"),
            ("D", "$5$"),
        ],
        "A",
        "Complete the square: $x^2 - 6x + 5 = (x - 3)^2 - 4$. The squared term is at least 0, so the minimum value is $-4$, reached at $x = 3$.",
        {
            "B": "$-3$ is the $x$-coordinate of the vertex, not the minimum value.",
            "C": "$3$ has the wrong sign for the vertex's $x$-coordinate and is not the minimum value.",
            "D": "$5$ is the $y$-intercept, not the vertex's $y$-coordinate.",
        },
    ),
    item(
        "M-ADV-M29-02",
        "Advanced Math",
        "Exponential growth and decay",
        "Medium",
        "A town's population is 12,000 and increases by 4 percent each year. Let $P(t)$ be the population after $t$ years.",
        "Which equation models the population after $t$ years?",
        [
            ("A", "$P(t) = 12{,}000(1.4)^t$"),
            ("B", "$P(t) = 12{,}000(1.04)^t$"),
            ("C", "$P(t) = 12{,}000(0.04)^t$"),
            ("D", "$P(t) = 12{,}000(1.004)^t$"),
        ],
        "B",
        "A 4 percent annual increase multiplies the population by $1 + 0.04 = 1.04$ each year, so the model is $12{,}000(1.04)^t$.",
        {
            "A": "$1.4$ represents a 40 percent increase, not 4 percent.",
            "C": "$0.04$ alone would shrink the population to 4 percent of its previous size each year.",
            "D": "$1.004$ represents a 0.4 percent increase, ten times too small.",
        },
    ),
    item(
        "M-ADV-M29-03",
        "Advanced Math",
        "Function composition and evaluation",
        "Medium",
        "The functions $f$ and $g$ are defined by $f(x) = 2x + 1$ and $g(x) = x^2 - 3$.",
        "What is the value of $f(g(2))$?",
        [
            ("A", "$3$"),
            ("B", "$1$"),
            ("C", "$5$"),
            ("D", "$7$"),
        ],
        "A",
        "First evaluate the inner function: $g(2) = 2^2 - 3 = 1$. Then $f(1) = 2(1) + 1 = 3$.",
        {
            "B": "$1$ is $g(2)$, not the final composition.",
            "C": "$5$ results from evaluating $g(f(2))$ instead of $f(g(2))$.",
            "D": "$7$ results from using $2^2 + 3$ for $g(2)$.",
        },
    ),
    item(
        "M-PSD-M29-01",
        "Problem-Solving and Data Analysis",
        "Percentages",
        "Easy",
        "A jacket has a regular price of $80. It is discounted by 25 percent, and then a 10 percent sales tax is applied to the discounted price.",
        "What is the total cost of the jacket after the discount and tax?",
        [
            ("A", "$66$"),
            ("B", "$60$"),
            ("C", "$68$"),
            ("D", "$70$"),
        ],
        "A",
        "The discount makes the price $80(1 - 0.25) = 60$. Tax adds 10 percent of $60, or $6, for a total of $66.",
        {
            "B": "$60$ is the discounted price before tax.",
            "C": "$68$ applies the discount and tax incorrectly, as though tax were on the original price and then discounted.",
            "D": "$70$ results from subtracting only $10 from the original price.",
        },
    ),
    item(
        "M-PSD-M29-02",
        "Problem-Solving and Data Analysis",
        "Probability and conditional probability",
        "Easy",
        "A bag contains 5 red marbles, 3 blue marbles, and 2 green marbles. One marble is selected at random.",
        "What is the probability that the selected marble is not blue?",
        [
            ("A", "$\\frac{7}{10}$"),
            ("B", "$\\frac{3}{10}$"),
            ("C", "$\\frac{7}{3}$"),
            ("D", "$\\frac{2}{5}$"),
        ],
        "A",
        "There are $5 + 3 + 2 = 10$ marbles total. The 3 blue marbles are excluded, leaving $5 + 2 = 7$ favorable outcomes, so the probability is $7/10$.",
        {
            "B": "$3/10$ is the probability of selecting a blue marble.",
            "C": "$7/3$ is greater than 1 and cannot be a probability.",
            "D": "$2/5$ is the probability of selecting a green marble.",
        },
    ),
    item(
        "M-PSD-M29-03",
        "Problem-Solving and Data Analysis",
        "Mean, median and mode",
        "Easy",
        "A student's mean score on five tests is 84. The first four scores are 78, 86, 90, and 82.",
        "What is the student's score on the fifth test?",
        [
            ("A", "$84$"),
            ("B", "$80$"),
            ("C", "$82$"),
            ("D", "$88$"),
        ],
        "A",
        "The five scores total $5(84) = 420$. The first four total $78 + 86 + 90 + 82 = 336$, so the fifth score is $420 - 336 = 84$.",
        {
            "B": "$80$ would make the five-score total 416, for a mean of 83.2.",
            "C": "$82$ would make the total 418, for a mean of 83.6.",
            "D": "$88$ would make the total 424, for a mean of 84.8.",
        },
    ),
    item(
        "M-GEO-M29-01",
        "Geometry and Trigonometry",
        "Circles: area and circumference",
        "Easy",
        "A circle has a circumference of $12\\pi$.",
        "What is the area of the circle?",
        [
            ("A", "$36\\pi$"),
            ("B", "$6\\pi$"),
            ("C", "$144\\pi$"),
            ("D", "$24\\pi$"),
        ],
        "A",
        "Since $C = 2\\pi r = 12\\pi$, the radius is $6$. The area is $\\pi r^2 = \\pi(6)^2 = 36\\pi$.",
        {
            "B": "$6\\pi$ is the radius multiplied by $\\pi$, not the area.",
            "C": "$144\\pi$ squares the diameter rather than the radius.",
            "D": "$24\\pi$ uses the diameter instead of the radius in the area formula.",
        },
    ),
    item(
        "M-GEO-M29-02",
        "Geometry and Trigonometry",
        "Right triangles and trigonometric ratios",
        "Medium",
        "In a right triangle, one acute angle measures $30^\\circ$ and the hypotenuse has length 14.",
        "What is the length of the side opposite the $30^\\circ$ angle?",
        [
            ("A", "$7$"),
            ("B", "$7\\sqrt{3}$"),
            ("C", "$14\\sqrt{3}$"),
            ("D", "$14$"),
        ],
        "A",
        "In a right triangle, $\\sin 30^\\circ = \\frac{\\text{opposite}}{\\text{hypotenuse}} = \\frac{1}{2}$. Thus the opposite side is $14 \\cdot \\frac{1}{2} = 7$.",
        {
            "B": "$7\\sqrt{3}$ is the length of the side adjacent to the $30^\\circ$ angle.",
            "C": "$14\\sqrt{3}$ multiplies the hypotenuse by $\\sqrt{3}$ without using the sine ratio.",
            "D": "$14$ is the hypotenuse, not the opposite side.",
        },
    ),
    item(
        "M-GEO-M29-03",
        "Geometry and Trigonometry",
        "Volume and surface area",
        "Easy",
        "A right circular cylinder has a radius of 3 centimeters and a height of 10 centimeters.",
        "What is the volume of the cylinder, in cubic centimeters?",
        [
            ("A", "$90\\pi$"),
            ("B", "$30\\pi$"),
            ("C", "$60\\pi$"),
            ("D", "$900\\pi$"),
        ],
        "A",
        "The volume of a cylinder is $\\pi r^2 h = \\pi(3)^2(10) = 90\\pi$.",
        {
            "B": "$30\\pi$ uses $r h$ instead of $r^2 h$.",
            "C": "$60\\pi$ uses the diameter instead of the radius.",
            "D": "$900\\pi$ squares the height as well as the radius.",
        },
    ),
]


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def seed_sql(bank: dict, questions: list[dict]) -> str:
    counts = collections.Counter(q["source_id"] for q in bank["questions"])
    lines = [
        "-- HDSAT M29 curated expansion. Generated by tools/add_m29_curated.py.",
        f"-- bank_version: {VERSION}",
        "-- Idempotent: every statement is an upsert on the primary key.",
        "",
        "BEGIN;",
        "",
        "-- dataset_sources (refresh record_count after the expansion)",
    ]
    for source in bank["sources"]:
        source_id = source["source_id"]
        lines.append(
            "INSERT INTO public.dataset_sources (source_id, name, license, license_url, "
            "provenance_summary, is_released_practice_set, is_official_college_board, record_count) "
            f"VALUES ({sql_literal(source_id)}, {sql_literal(source['name'])}, "
            f"{sql_literal(source['license'])}, {sql_literal(source.get('license_url'))}, "
            f"{sql_literal(source.get('provenance_summary'))}, "
            f"{sql_literal(bool(source.get('is_released_practice_set')))}, "
            f"{sql_literal(bool(source.get('is_official_college_board')))}, "
            f"{counts.get(source_id, 0)}) "
            "ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name, license = EXCLUDED.license, "
            "license_url = EXCLUDED.license_url, provenance_summary = EXCLUDED.provenance_summary, "
            "is_released_practice_set = EXCLUDED.is_released_practice_set, "
            "is_official_college_board = EXCLUDED.is_official_college_board, "
            "record_count = EXCLUDED.record_count;"
        )
    lines.append("\n-- questions")
    for q in questions:
        assessments = "ARRAY[" + ", ".join(sql_literal(a) for a in q["assessments"]) + "]::TEXT[]"
        choices = "NULL" if q["choices"] is None else sql_literal(json.dumps(q["choices"], ensure_ascii=False)) + "::jsonb"
        lines.append(
            "INSERT INTO public.questions (id, external_id, assessments, section, domain, skill, "
            "difficulty, format, stimulus, prompt, choices, figure_metadata, source_id, source_name, "
            "license, attribution, is_released_practice_set, status) VALUES ("
            f"{sql_literal(q['id'])}, {sql_literal(q['external_id'])}, {assessments}, "
            f"{sql_literal(q['section'])}, {sql_literal(q['domain'])}, {sql_literal(q['skill'])}, "
            f"{sql_literal(q['difficulty'])}, {sql_literal(q['format'])}, {sql_literal(q['stimulus'])}, "
            f"{sql_literal(q['prompt'])}, {choices}, NULL, {sql_literal(q['source_id'])}, "
            f"{sql_literal(q['source_name'])}, {sql_literal(q['license'])}, {sql_literal(q['attribution'])}, "
            f"FALSE, 'active') ON CONFLICT (id) DO UPDATE SET external_id = EXCLUDED.external_id, "
            "assessments = EXCLUDED.assessments, section = EXCLUDED.section, domain = EXCLUDED.domain, "
            "skill = EXCLUDED.skill, difficulty = EXCLUDED.difficulty, format = EXCLUDED.format, "
            "stimulus = EXCLUDED.stimulus, prompt = EXCLUDED.prompt, choices = EXCLUDED.choices, "
            "figure_metadata = EXCLUDED.figure_metadata, source_id = EXCLUDED.source_id, "
            "source_name = EXCLUDED.source_name, license = EXCLUDED.license, attribution = EXCLUDED.attribution, "
            "status = EXCLUDED.status, updated_at = NOW();"
        )
    lines.append("\n-- answer keys")
    for q in questions:
        acceptable = "ARRAY[" + ", ".join(sql_literal(a) for a in q["acceptable_answers"]) + "]::TEXT[]"
        lines.append(
            "INSERT INTO public.question_keys (question_id, correct_answer, acceptable_answers, "
            "explanation, distractor_rationales) VALUES ("
            f"{sql_literal(q['id'])}, {sql_literal(q['correct_answer'])}, {acceptable}, "
            f"{sql_literal(q['explanation'])}, {sql_literal(json.dumps(q['distractor_rationales'], ensure_ascii=False))}::jsonb) "
            "ON CONFLICT (question_id) DO UPDATE SET correct_answer = EXCLUDED.correct_answer, "
            "acceptable_answers = EXCLUDED.acceptable_answers, explanation = EXCLUDED.explanation, "
            "distractor_rationales = EXCLUDED.distractor_rationales;"
        )
    lines += ["", "COMMIT;", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="report without writing")
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    existing = {q["id"] for q in bank["questions"]}
    collisions = [q["id"] for q in QUESTIONS if q["id"] in existing]

    if args.check:
        print(f"bank {bank['bank_version']}: {len(bank['questions'])} items")
        print(f"new items: {len(QUESTIONS) - len(collisions)}; refreshed: {len(collisions)}")
        print("ids: " + ", ".join(q["id"] for q in QUESTIONS))
        return

    # Idempotent by id: a rerun refreshes the curated rows instead of appending
    # a second copy or refusing after a wording repair.
    replacements = {q["id"]: q for q in QUESTIONS}
    bank["questions"] = [replacements.get(q["id"], q) for q in bank["questions"]]
    bank["questions"].extend(q for q in QUESTIONS if q["id"] not in existing)
    bank["bank_version"] = VERSION
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    counts = collections.Counter(q["source_id"] for q in bank["questions"])
    bank["sources"] = [
        {**source, "record_count": counts.get(source["source_id"], 0)}
        for source in bank["sources"]
    ]
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    SEED.write_text(seed_sql(bank, QUESTIONS), encoding="utf-8")
    print(f"wrote {len(QUESTIONS)} items; bank now {len(bank['questions'])}")
    print(f"wrote {SEED}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
HDSAT Authorized Question Bank & Flashcard Importer and Validator.

Validates JSON/CSV datasets for required fields, mathematical accuracy, provenance,
license metadata, and duplicate detection. Generates deterministic seed files
and SQL migration scripts for idempotent Supabase loading.
"""

import argparse
import csv
import json
import os
import random
import re
from datetime import datetime, timezone

BANK_VERSION = "2026.10.14-open-core-1"

SOURCES = [
    {
        "source_id": "hdsat-open-core-2026",
        "name": "HDSAT Open Core Curated Bank",
        "license": "CC-BY-4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
"provenance_summary": "HDSAT original practice items drafted for HDSAT against the publicly published SAT Suite domain/skill blueprint (collegeboard.org). AI-assisted drafting with a human review checklist (see supabase/import/REVIEW_CHECKLIST.md). NOT official College Board material and NOT derived from any College Board test form.",
        "is_released_practice_set": False,
        "is_official_college_board": False,
    },
    {
        "source_id": "hdsat-benchmark-sim-1",
        "name": "HDSAT Benchmark Simulation Set A (Released Practice Form)",
        "license": "CC-BY-4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
"provenance_summary": "HDSAT original practice items reserved for the HDSAT Benchmark Form A simulation. Deliberately tagged is_released_practice_set=true so students can exclude benchmark-simulation items while drilling in the Question Bank or Practice Rush. NOT official College Board material.",
        "is_released_practice_set": True,
        "is_official_college_board": False,
    },
]

QUESTIONS = [
    # =========================================================================
    # READING AND WRITING — Information and Ideas
    # =========================================================================
    {
        "id": "RW-INF-001",
        "external_id": "HDSAT-RW-INF-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Reading and Writing",
        "domain": "Information and Ideas",
        "skill": "Central Ideas and Details",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "Marine biologist Adriana Vergés and her colleagues have documented how warming ocean temperatures allow tropical herbivorous fish to expand their ranges into temperate kelp forests. Unlike native temperate species, these tropical browsers consume kelp blades at rates that exceed the algae's seasonal regrowth capacity, gradually transforming dense canopy habitats into sparse rocky reefs.",
        "prompt": "Which choice best states the main idea of the text?",
        "choices": [
            {"id": "A", "text": "Range expansion by tropical herbivorous fish into warming temperate waters can deplete kelp forests faster than the kelp can regenerate."},
            {"id": "B", "text": "Temperate kelp forests grow more rapidly during warm seasons than tropical coral reefs do."},
            {"id": "C", "text": "Native temperate fish species have adapted their diets to compete with arriving tropical browsers."},
            {"id": "D", "text": "Ocean warming affects rocky reefs more severely than it affects shallow coastal waters."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Choice A accurately captures the central claim: warming temperatures enable tropical herbivorous fish to move into temperate kelp habitats, where their grazing outpaces kelp regrowth and converts dense canopies into sparse reefs. Choices B, C, and D introduce claims unsupported by the passage.",
        "distractor_rationales": {
            "B": "The text never compares the growth rate of temperate kelp forests with that of tropical coral reefs.",
            "C": "The text contrasts native temperate species with tropical browsers rather than stating native fish changed their diets.",
            "D": "Rocky reefs are described as the result of kelp loss, not as a pre-existing habitat more severely warmed."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-INF-002",
        "external_id": "HDSAT-RW-INF-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Information and Ideas",
        "skill": "Inferences",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "In medieval European scriptoria, parchment made from calfskin (vellum) was prized for illuminated manuscripts because its smooth, low-lipid surface accepted gold leaf and mineral pigments evenly. However, archival multispectral imaging of twelfth-century parish registries—documents intended for routine administrative tracking rather than liturgical display—shows that scribes overwhelmingly selected coarser sheepskin parchment, which split easily if scraped to remove ink.",
        "prompt": "Which choice most logically completes the text?",
        "choices": [
            {"id": "A", "text": "Because parish registries did not require decorative illumination, scribes prioritized sheepskin's resistance to undetected erasure and lower cost over vellum's smooth finish."},
            {"id": "B", "text": "Twelfth-century scribes lacked access to mineral pigments when compiling administrative parish registries."},
            {"id": "C", "text": "Vellum manuscripts deteriorated more rapidly in parish archives than sheepskin registries did."},
            {"id": "D", "text": "Multispectral imaging cannot distinguish between calfskin and sheepskin in illuminated liturgical manuscripts."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The passage contrasts vellum (prized for decorative illumination) with sheepskin (used for administrative registries and prone to splitting if someone tried to scrape off ink). Thus, for administrative records where preventing tampering mattered more than gold leaf, sheepskin was advantageous.",
        "distractor_rationales": {
            "B": "The passage notes registries were not intended for liturgical display, not that pigments were unavailable.",
            "C": "Durability over centuries is not compared in the passage.",
            "D": "Multispectral imaging was successfully used to identify the parchment type."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-INF-003",
        "external_id": "HDSAT-RW-INF-003",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Reading and Writing",
        "domain": "Information and Ideas",
        "skill": "Command of Evidence (Quantitative)",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "Agronomists tested four cover-crop mixtures across 120 days to evaluate soil nitrogen retention and late-season weed suppression in upper Midwest plots. The researchers concluded that pairing a legume with a cereal grass allows farmers to capture nearly the full weed-suppression benefit of the grass without sacrificing the high nitrogen retention of the legume.",
        "figure_metadata": {
            "type": "table",
            "caption": "120-Day Cover Crop Trial Results",
            "headers": ["Cover Crop Treatment", "Soil Nitrogen Retained (kg/ha)", "Weed Suppression (%)"],
            "rows": [
                ["Crimson Clover (legume)", "68", "54%"],
                ["Winter Rye (cereal grass)", "42", "89%"],
                ["Clover + Winter Rye (50/50)", "64", "86%"],
                ["Tillage Radish (brassica)", "51", "72%"]
            ]
        },
        "prompt": "Which choice most effectively uses data from the table to support the researchers' conclusion?",
        "choices": [
            {"id": "A", "text": "The Clover + Winter Rye mix achieved 86% weed suppression (close to Winter Rye's 89%) while retaining 64 kg/ha of nitrogen (close to Crimson Clover's 68 kg/ha)."},
            {"id": "B", "text": "Winter Rye alone suppressed 89% of weeds, whereas Crimson Clover alone suppressed only 54% of weeds."},
            {"id": "C", "text": "Tillage Radish retained 51 kg/ha of nitrogen and suppressed 72% of weeds, outperforming Winter Rye in nitrogen retention."},
            {"id": "D", "text": "Crimson Clover retained 68 kg/ha of nitrogen, the highest amount of any treatment in the 120-day trial."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "To support the claim that the pairing captures nearly the full weed-suppression benefit of the cereal grass without sacrificing the legume's nitrogen retention, Choice A directly cites the 50/50 mix's metrics (86% and 64 kg/ha) alongside the single-crop benchmarks (89% and 68 kg/ha).",
        "distractor_rationales": {
            "B": "Mentions only the single-crop extremes without citing the paired mixture.",
            "C": "Focuses on Tillage Radish, which is neither the legume nor the cereal grass in the conclusion.",
            "D": "Cites only Crimson Clover's nitrogen retention."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-INF-004",
        "external_id": "HDSAT-RW-INF-004",
        "assessments": ["SAT", "PSAT/NMSQT"],
        "section": "Reading and Writing",
        "domain": "Information and Ideas",
        "skill": "Command of Evidence (Textual)",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "Literary critic Priya Nair argues that in nineteenth-century industrial novels, depictions of railway schedules do not merely provide realistic background detail; rather, they dramatize how standardized mechanical time reshaped characters' intimate perception of memory and obligation.",
        "prompt": "Which quotation from a nineteenth-century novel would most directly illustrate Nair's claim?",
        "choices": [
            {"id": "A", "text": "\"Even in the quiet parlor of his childhood home, Julian found himself measuring his father's pauses by the six-minute intervals of the junction bell, as though affection itself were a connection to be missed.\""},
            {"id": "B", "text": "\"The new viaduct spanned forty arches of dressed limestone, carrying the morning express high above the canal barges that had served the valley for a century.\""},
            {"id": "C", "text": "\"Passengers waiting on the windy platform consulted the printed timetable nailed beside the ticket window before stowing their trunks.\""},
            {"id": "D", "text": "\"Because the locomotive required fresh water every thirty miles, the company constructed iron tanks at each market town along the route.\""}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Choice A directly shows railway scheduling ('six-minute intervals of the junction bell') reshaping a character's intimate emotional and familial perception ('measuring his father's pauses... as though affection itself were a connection to be missed').",
        "distractor_rationales": {
            "B": "Describes physical infrastructure and engineering rather than internal perception.",
            "C": "Provides literal background detail of passengers checking a timetable.",
            "D": "Describes mechanical logistics of steam locomotives."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-INF-005",
        "external_id": "HDSAT-RW-INF-005",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Information and Ideas",
        "skill": "Central Ideas and Details",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "Unlike traditional concrete, which releases carbon dioxide during limestone calcination, mycelium-based acoustic panels are grown by binding agricultural agricultural byproducts—such as hemp hurds or oat hulls—with the root-like fungal network of Ganoderma lucidum. Once heat-cured, the panels are fire-retardant, biodegradable, and absorb midrange office noise more effectively than fiberglass tiles.",
        "prompt": "According to the text, how are mycelium-based acoustic panels produced?",
        "choices": [
            {"id": "A", "text": "By using fungal networks to bind agricultural plant byproducts and then heat-curing the material."},
            {"id": "B", "text": "By heating limestone with fiberglass tiles to reduce midrange office noise."},
            {"id": "C", "text": "By compressing synthetic polymers around live hemp plants."},
            {"id": "D", "text": "By extracting carbon dioxide from traditional concrete during calcination."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The text explicitly states that the panels are grown by binding agricultural byproducts with the root-like fungal network and then heat-cured.",
        "distractor_rationales": {
            "B": "Limestone calcination and fiberglass tiles are mentioned as contrasting traditional materials.",
            "C": "Synthetic polymers are never mentioned.",
            "D": "Calcination is mentioned as releasing CO2 in traditional concrete."
        },
        "source_id": "hdsat-benchmark-sim-1"
    },
    {
        "id": "RW-INF-006",
        "external_id": "HDSAT-RW-INF-006",
        "assessments": ["SAT", "PSAT/NMSQT"],
        "section": "Reading and Writing",
        "domain": "Information and Ideas",
        "skill": "Inferences",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "Paleoclimatologists reconstructing monsoon intensity from stalagmite oxygen-isotope ratios ($\\delta^{18}\\text{O}$) long assumed that lower $\\delta^{18}\\text{O}$ values in cave calcite strictly reflect higher local rainfall volume. Recently, however, atmospheric tracer models demonstrated that shifts in the geographic moisture source—from the Arabian Sea to the Bay of Bengal—can lower precipitation $\\delta^{18}\\text{O}$ by up to 3 per mil even when total local rainfall remains constant.",
        "prompt": "Which choice most logically completes the text?",
        "choices": [
            {"id": "A", "text": "Interpreting stalagmite $\\delta^{18}\\text{O}$ records as a direct measure of local rainfall volume may be inaccurate if concurrent changes in moisture-source pathways are not accounted for."},
            {"id": "B", "text": "Stalagmites formed near the Arabian Sea grow more rapidly than those formed near the Bay of Bengal."},
            {"id": "C", "text": "Oxygen-isotope ratios in cave calcite remain constant regardless of changes in regional monsoon circulation."},
            {"id": "D", "text": "Atmospheric tracer models are less reliable than stalagmite calcite measurements for dating ancient cave formations."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Because changes in the geographic moisture source can alter $\\delta^{18}\\text{O}$ by up to 3 per mil without any change in local rainfall volume, attributing lower $\\delta^{18}\\text{O}$ solely to local rainfall volume can be misleading unless source-pathway changes are considered.",
        "distractor_rationales": {
            "B": "Stalagmite growth rate is not discussed.",
            "C": "Contradicts the text, which explains two different factors that change $\\delta^{18}\\text{O}$.",
            "D": "Radiometric dating of caves is not the subject of the passage."
        },
        "source_id": "hdsat-open-core-2026"
    },

    # =========================================================================
    # READING AND WRITING — Craft and Structure
    # =========================================================================
    {
        "id": "RW-CRF-001",
        "external_id": "HDSAT-RW-CRF-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Craft and Structure",
        "skill": "Words in Context",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "Whereas early portable seismographs required delicate mechanical pendulums that could be disrupted by minor jostling during transport, modern solid-state accelerometers are remarkably _______, functioning reliably even when dropped from reconnaissance aircraft into volcanic craters.",
        "prompt": "Which choice completes the text with the most logical and precise word or phrase?",
        "choices": [
            {"id": "A", "text": "resilient"},
            {"id": "B", "text": "ambiguous"},
            {"id": "C", "text": "ephemeral"},
            {"id": "D", "text": "tentative"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "'Resilient' means able to withstand shock or rough conditions, which contrasts directly with 'delicate' pendulums and matches 'functioning reliably even when dropped from reconnaissance aircraft'.",
        "distractor_rationales": {
            "B": "'Ambiguous' means open to multiple interpretations.",
            "C": "'Ephemeral' means short-lived.",
            "D": "'Tentative' means hesitant or provisional."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-CRF-002",
        "external_id": "HDSAT-RW-CRF-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Reading and Writing",
        "domain": "Craft and Structure",
        "skill": "Words in Context",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "Architect Lina Bo Bardi rejected the notion that museum display cases should isolate artworks from everyday life; instead, at the São Paulo Museum of Art, she mounted paintings on transparent tempered-glass easels so visitors could move freely among the works in a _______ spatial arrangement.",
        "prompt": "Which choice completes the text with the most logical and precise word or phrase?",
        "choices": [
            {"id": "A", "text": "nonhierarchical"},
            {"id": "B", "text": "clandestine"},
            {"id": "C", "text": "redundant"},
            {"id": "D", "text": "perfunctory"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "'Nonhierarchical' describes an arrangement without fixed rank or forced sequence, matching Bo Bardi's rejection of isolating walls and her support for visitors moving freely among transparent easels.",
        "distractor_rationales": {
            "B": "'Clandestine' means secretive.",
            "C": "'Redundant' means repetitive or unnecessary.",
            "D": "'Perfunctory' means carried out with minimal effort."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-CRF-003",
        "external_id": "HDSAT-RW-CRF-003",
        "assessments": ["SAT", "PSAT/NMSQT"],
        "section": "Reading and Writing",
        "domain": "Craft and Structure",
        "skill": "Words in Context",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "Far from offering a _______ endorsement of algorithmic credit scoring, economist Safiya Patel demonstrates that while automated underwriting reduces processing delays for standard mortgages, it systematically amplifies historical data gaps for first-generation rural borrowers.",
        "prompt": "Which choice completes the text with the most logical and precise word or phrase?",
        "choices": [
            {"id": "A", "text": "univocal"},
            {"id": "B", "text": "mendacious"},
            {"id": "C", "text": "parsimonious"},
            {"id": "D", "text": "derivative"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "'Univocal' (or unqualified/unambiguous) fits the contrast: Patel does not give a single-sided endorsement, because she highlights both a benefit (faster processing) and a systemic flaw (amplifying data gaps).",
        "distractor_rationales": {
            "B": "'Mendacious' means untruthful.",
            "C": "'Parsimonious' means stingy or sparing.",
            "D": "'Derivative' means unoriginal."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-CRF-004",
        "external_id": "HDSAT-RW-CRF-004",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Craft and Structure",
        "skill": "Text Structure and Purpose",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "Many popular accounts of the 1925 serum run to Nome credit a single lead sled dog, Balto, with saving the isolated Alaskan town from a diphtheria outbreak. Historian Gay Salisbury and Laney Salisbury, however, emphasize that the 674-mile relay involved twenty mushers and roughly 150 dogs, with Leonhard Seppala's team—led by Togo—covering the longest and most hazardous crossing over Norton Sound.",
        "prompt": "Which choice best describes the overall structure of the text?",
        "choices": [
            {"id": "A", "text": "It presents a widely held simplified view of a historical event and then offers historical details that complicate that view."},
            {"id": "B", "text": "It chronicles the chronological stages of a medical emergency and then proposes a policy to prevent future outbreaks."},
            {"id": "C", "text": "It compares two competing scientific explanations for a phenomenon and argues that neither is complete."},
            {"id": "D", "text": "It praises an individual achievement and then explains why contemporary observers ignored it."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The first sentence states a popular simplified narrative (crediting a single dog, Balto), and the second sentence introduces historians' broader evidence (20 mushers, 150 dogs, and Togo's longest hazardous leg) that complicates that simplified view.",
        "distractor_rationales": {
            "B": "No future public health policy is proposed.",
            "C": "The passage is historical, not a comparison of competing scientific theories.",
            "D": "The passage corrects a narrow popular focus rather than claiming the event was ignored."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-CRF-005",
        "external_id": "HDSAT-RW-CRF-005",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Reading and Writing",
        "domain": "Craft and Structure",
        "skill": "Cross-Text Connections",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "Text 1\nUrban ecologist Marcus Vance contends that planting non-native drought-tolerant street trees in arid cities is an ecological mistake. Because native insect herbivores have not co-evolved with exotic foliage, non-native canopies support up to 70% fewer caterpillar species, depriving migratory songbirds of essential protein during spring stopovers.\n\nText 2\nLandscape hydrologist Elena Rostova notes that in heavily paved metropolitan heat islands, soil compaction and radiant heat create microclimates several degrees hotter and drier than the surrounding native desert. In her multi-year survey of Phoenix boulevards, several native riparian tree species suffered high canopy dieback, whereas selected non-native Mediterranean oaks maintained dense shade that cooled adjacent sidewalks by 6°C and allowed understory native shrubs to survive.",
        "prompt": "Based on the texts, how would Rostova (Text 2) most likely respond to Vance's argument (Text 1)?",
        "choices": [
            {"id": "A", "text": "By pointing out that in extreme urban microclimates where native trees struggle to survive, resilient non-native trees can provide microclimate cooling that indirectly supports native understory plants."},
            {"id": "B", "text": "By disputing Vance's finding that migratory songbirds rely on caterpillars during spring stopovers."},
            {"id": "C", "text": "By arguing that urban planners should replace all street trees with artificial shade structures to conserve water."},
            {"id": "D", "text": "By agreeing that non-native Mediterranean oaks should be removed from arid cities immediately."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Rostova shows that paved urban heat islands are harsher than surrounding deserts, causing some native trees to die back while hardy non-native trees provide shade that cools sidewalks and helps native understory shrubs survive.",
        "distractor_rationales": {
            "B": "Rostova does not address or dispute songbird diet.",
            "C": "Artificial shade structures are never mentioned.",
            "D": "Rostova highlights the benefits of Mediterranean oaks in Phoenix boulevards."
        },
        "source_id": "hdsat-benchmark-sim-1"
    },

    # =========================================================================
    # READING AND WRITING — Standard English Conventions
    # =========================================================================
    {
        "id": "RW-SEC-001",
        "external_id": "HDSAT-RW-SEC-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Standard English Conventions",
        "skill": "Boundaries",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "In 1899, physicist Hertha Ayrton read her paper on the behavior of electric arcs before the Institution of Electrical Engineers in _______ she became the first woman invited to become a full member of the prestigious society.",
        "prompt": "Which choice completes the text so that it conforms to the conventions of Standard English?",
        "choices": [
            {"id": "A", "text": "London; shortly thereafter,"},
            {"id": "B", "text": "London, shortly thereafter,"},
            {"id": "C", "text": "London shortly thereafter"},
            {"id": "D", "text": "London, shortly thereafter"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The text contains two independent clauses: 'In 1899, physicist Hertha Ayrton read her paper... in London' and 'shortly thereafter, she became the first woman...'. A semicolon properly joins the two independent clauses, followed by a comma after the introductory transition phrase 'shortly thereafter'.",
        "distractor_rationales": {
            "B": "Creates a comma splice between two independent clauses.",
            "C": "Creates a fused (run-on) sentence with no punctuation between independent clauses.",
            "D": "Creates a comma splice."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-SEC-002",
        "external_id": "HDSAT-RW-SEC-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Reading and Writing",
        "domain": "Standard English Conventions",
        "skill": "Form, Structure, and Sense",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "The acoustics of ancient Greek amphitheaters—most notably Epidaurus, whose limestone seating tiers filter out low-frequency background wind noise while amplifying high-frequency vocal consonants—_______ modern architectural engineers for decades.",
        "prompt": "Which choice completes the text so that it conforms to the conventions of Standard English?",
        "choices": [
            {"id": "A", "text": "have intrigued"},
            {"id": "B", "text": "has intrigued"},
            {"id": "C", "text": "is intriguing"},
            {"id": "D", "text": "intrigues"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The plural subject 'The acoustics' requires a plural verb, and the temporal phrase 'for decades' calls for the present perfect tense ('have intrigued'). Choices B, C, and D are all singular verbs.",
        "distractor_rationales": {
            "B": "Singular verb 'has' does not agree with plural subject 'acoustics'.",
            "C": "Singular verb 'is' does not agree with 'acoustics' or fit 'for decades'.",
            "D": "Singular verb 'intrigues' does not agree with 'acoustics'."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-SEC-003",
        "external_id": "HDSAT-RW-SEC-003",
        "assessments": ["SAT", "PSAT/NMSQT"],
        "section": "Reading and Writing",
        "domain": "Standard English Conventions",
        "skill": "Form, Structure, and Sense",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "Calibrated using laser interferometry in an underground vacuum chamber, _______ can detect gravitational-wave strain amplitudes smaller than one ten-thousandth the diameter of a proton.",
        "prompt": "Which choice completes the text so that it conforms to the conventions of Standard English?",
        "choices": [
            {"id": "A", "text": "the suspended silica mirrors of the LIGO observatory"},
            {"id": "B", "text": "gravitational-wave strain amplitudes at the LIGO observatory"},
            {"id": "C", "text": "physicists' measurements of the LIGO observatory's silica mirrors"},
            {"id": "D", "text": "it is the LIGO observatory's suspended silica mirrors that"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The introductory participial phrase 'Calibrated using laser interferometry in an underground vacuum chamber' must modify the noun immediately following the comma. 'The suspended silica mirrors of the LIGO observatory' are what are calibrated and can detect the strain amplitudes.",
        "distractor_rationales": {
            "B": "Creates a dangling modifier: strain amplitudes are not calibrated in a vacuum chamber.",
            "C": "Measurements are not physical objects calibrated in an underground vacuum chamber that themselves detect strain.",
            "D": "Expletive 'it' cannot be modified by 'Calibrated using laser interferometry'."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-SEC-004",
        "external_id": "HDSAT-RW-SEC-004",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Standard English Conventions",
        "skill": "Boundaries",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "Botanist Robin Wall Kimmerer observes that when sweetgrass (Hierochloe odorata) is harvested selectively by _______ the plant responds with vigorous compensatory tillering, producing denser shoots the following spring than unharvested plots do.",
        "prompt": "Which choice completes the text so that it conforms to the conventions of Standard English?",
        "choices": [
            {"id": "A", "text": "hand,"},
            {"id": "B", "text": "hand;"},
            {"id": "C", "text": "hand"},
            {"id": "D", "text": "hand—"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Within the 'that' clause, 'when sweetgrass (Hierochloe odorata) is harvested selectively by hand' is a dependent adverbial clause preceding the main clause 'the plant responds...'. A comma is required after 'hand' to separate the dependent clause from the independent clause.",
        "distractor_rationales": {
            "B": "A semicolon cannot separate a dependent 'when' clause from its main clause.",
            "C": "Omits the necessary comma after an introductory dependent clause.",
            "D": "An em dash is inappropriate when no paired dash or abrupt break exists."
        },
        "source_id": "hdsat-benchmark-sim-1"
    },

    # =========================================================================
    # READING AND WRITING — Expression of Ideas
    # =========================================================================
    {
        "id": "RW-EXP-001",
        "external_id": "HDSAT-RW-EXP-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Reading and Writing",
        "domain": "Expression of Ideas",
        "skill": "Transitions",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "Early twentieth-century glacialogists assumed that subglacial lakes beneath the Antarctic ice sheet were hydrologically isolated basins that remained stagnant for millions of years. _______ satellite laser altimetry in the 2000s revealed rapid rises and falls in the ice surface above Lake Whillans, proving that subglacial water periodically flushes through interconnected channels.",
        "prompt": "Which choice completes the text with the most logical transition?",
        "choices": [
            {"id": "A", "text": "However,"},
            {"id": "B", "text": "Consequently,"},
            {"id": "C", "text": "Similarly,"},
            {"id": "D", "text": "For instance,"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The second sentence overturns the assumption described in the first sentence ('hydrologically isolated... stagnant' vs. 'periodically flushes through interconnected channels'). 'However,' signals this contrast.",
        "distractor_rationales": {
            "B": "'Consequently,' indicates cause and effect.",
            "C": "'Similarly,' indicates comparison of alike ideas.",
            "D": "'For instance,' introduces an example of the preceding claim rather than a refutation."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-EXP-002",
        "external_id": "HDSAT-RW-EXP-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Reading and Writing",
        "domain": "Expression of Ideas",
        "skill": "Rhetorical Synthesis",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "While researching a topic, a student has taken the following notes:\n- Sodium-ion batteries use abundant sodium salts rather than lithium and cobalt.\n- Current commercial sodium-ion cells have a gravimetric energy density of 140–160 Wh/kg, compared with 240–280 Wh/kg for nickel-manganese-cobalt (NMC) lithium-ion cells.\n- Sodium-ion cells retain over 88% of their discharge capacity at -20°C, whereas standard lithium-ion cells often drop below 65% capacity at that temperature.\n- Because stationary grid storage facilities do not move, battery weight is far less important than cold-weather reliability and raw-material cost.",
        "prompt": "The student wants to explain why sodium-ion batteries are particularly well suited for stationary cold-climate grid storage despite having lower energy density than NMC lithium-ion cells. Which choice most effectively uses relevant information from the notes to accomplish this goal?",
        "choices": [
            {"id": "A", "text": "Although sodium-ion batteries have a lower energy density (140–160 Wh/kg) than NMC lithium-ion cells, their heavier weight matters little in stationary grid facilities, where their low-cost sodium materials and >88% capacity retention at -20°C are major advantages."},
            {"id": "B", "text": "NMC lithium-ion cells achieve an energy density of 240–280 Wh/kg, whereas sodium-ion cells use abundant sodium salts instead of lithium and cobalt."},
            {"id": "C", "text": "At -20°C, standard lithium-ion cells often drop below 65% discharge capacity, while sodium-ion batteries have an energy density of 140–160 Wh/kg."},
            {"id": "D", "text": "Stationary grid storage facilities do not move, so engineers must choose between NMC lithium-ion batteries and sodium-ion batteries."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Choice A synthesizes all parts of the prompt: acknowledging the lower energy density, explaining why weight is unimportant for stationary storage, and highlighting both cold-weather retention (>88% at -20°C) and abundant sodium materials.",
        "distractor_rationales": {
            "B": "Omits cold-weather performance and stationary grid storage altogether.",
            "C": "Juxtaposes statistics without explaining why stationary grid storage favors sodium-ion.",
            "D": "Fails to mention energy density, cold-weather performance, or material cost."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "RW-EXP-003",
        "external_id": "HDSAT-RW-EXP-003",
        "assessments": ["SAT", "PSAT/NMSQT"],
        "section": "Reading and Writing",
        "domain": "Expression of Ideas",
        "skill": "Rhetorical Synthesis",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "While researching a topic, a student has taken the following notes:\n- In 1977, the Voyager 1 and 2 spacecraft launched carrying the Golden Record, a 12-inch gold-plated copper phonograph disc.\n- The committee led by Carl Sagan selected 115 analog-encoded images and 90 minutes of audio.\n- Acoustic engineer Timothy Ferris oversaw the mastering of the record at 16 2/3 revolutions per minute (rpm) rather than the standard 33 1/3 rpm LP speed.\n- Halving the rotational speed doubled the playing time that could fit into the disc's physical grooves, though it slightly reduced high-frequency audio fidelity.",
        "prompt": "The student wants to emphasize the engineering trade-off involved in mastering the Voyager Golden Record. Which choice most effectively uses relevant information from the notes to accomplish this goal?",
        "choices": [
            {"id": "A", "text": "By mastering the Voyager Golden Record at 16 2/3 rpm instead of 33 1/3 rpm, Timothy Ferris doubled the audio duration that could fit on the disc at the cost of a slight reduction in high-frequency fidelity."},
            {"id": "B", "text": "Launched in 1977 aboard Voyager 1 and 2, the 12-inch gold-plated copper Golden Record contained 115 images and 90 minutes of audio selected by Carl Sagan's committee."},
            {"id": "C", "text": "Timothy Ferris oversaw the mastering of the Golden Record, which spun at 16 2/3 revolutions per minute rather than the standard 33 1/3 rpm."},
            {"id": "D", "text": "Carl Sagan's committee included both analog-encoded images and audio recordings on the 12-inch copper phonograph disc."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Choice A explicitly states the engineering trade-off: halving the speed from 33 1/3 rpm to 16 2/3 rpm doubled the audio capacity while sacrificing some high-frequency fidelity.",
        "distractor_rationales": {
            "B": "Provides general background without mentioning the engineering trade-off.",
            "C": "States the speed difference without explaining the benefit or cost.",
            "D": "Describes the contents without mentioning any trade-off."
        },
        "source_id": "hdsat-benchmark-sim-1"
    },

    # =========================================================================
    # MATH — Algebra
    # =========================================================================
    {
        "id": "M-ALG-001",
        "external_id": "HDSAT-M-ALG-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Algebra",
        "skill": "Linear equations in one variable",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "A botanical conservatory maintains a tropical orchid room by running a misting system. The reservoir starts the day with $480$ liters of distilled water and releases $15$ liters per hour. If $W$ represents the volume of water remaining after $t$ hours, and $W = 480 - 15t$, after how many hours will exactly $195$ liters remain?",
        "prompt": "What is the value of $t$ when $W = 195$?",
        "choices": [
            {"id": "A", "text": "$19$"},
            {"id": "B", "text": "$17$"},
            {"id": "C", "text": "$21$"},
            {"id": "D", "text": "$32$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A", "19"],
        "explanation": "Substitute $W = 195$ into the linear equation: $195 = 480 - 15t$. Subtract $195$ from $480$: $15t = 285$. Divide both sides by $15$: $t = 285 / 15 = 19$ hours.",
        "distractor_rationales": {
            "B": "Result of arithmetic error $255 / 15 = 17$.",
            "C": "Result of $315 / 15 = 21$.",
            "D": "Total time to empty the entire $480$-liter tank ($480 / 15 = 32$)."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ALG-002",
        "external_id": "HDSAT-M-ALG-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Algebra",
        "skill": "Systems of two linear equations in two variables",
        "difficulty": "Medium",
        "format": "spr",
        "stimulus": "$$3x + 4y = 31$$\n$$5x - 2y = 17$$",
        "prompt": "If $(x, y)$ is the solution to the given system of equations, what is the value of $x + y$?",
        "choices": None,
        "correct_answer": "9",
        "acceptable_answers": ["9", "9.0"],
        "explanation": "Multiply the second equation by $2$ to eliminate $y$: $10x - 4y = 34$. Adding this to the first equation gives $13x = 65$, so $x = 5$. Substituting $x = 5$ into $3x + 4y = 31$ gives $15 + 4y = 31$, so $y = 4$. Therefore $x + y = 5 + 4 = 9$.",
        "distractor_rationales": {},
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ALG-003",
        "external_id": "HDSAT-M-ALG-003",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Algebra",
        "skill": "Linear functions",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "A municipal bike-share program charges a monthly membership fee plus a constant usage rate per minute for rides exceeding $30$ minutes. The function $C(m) = 18 + 0.15m$ gives the total monthly cost $C(m)$, in dollars, for a member who accumulates $m$ overage minutes during the month.",
        "prompt": "What is the best interpretation of the number $18$ in this context?",
        "choices": [
            {"id": "A", "text": "The fixed monthly membership fee, in dollars, when a member has $0$ overage minutes."},
            {"id": "B", "text": "The charge, in dollars, for each additional minute beyond $30$ minutes."},
            {"id": "C", "text": "The maximum number of overage minutes included in the base plan."},
            {"id": "D", "text": "The total cost, in dollars, of an $18$-minute bike ride."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "In the linear model $C(m) = 18 + 0.15m$, the constant term $18$ is the $y$-intercept $C(0)$, representing the fixed monthly membership fee before any overage minutes are incurred.",
        "distractor_rationales": {
            "B": "The per-minute overage rate is $0.15$, the slope of the linear function.",
            "C": "The variable $m$ counts overage minutes; $18$ is measured in dollars.",
            "D": "The function models monthly cost for $m$ overage minutes, not the cost of an $18$-minute trip."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ALG-004",
        "external_id": "HDSAT-M-ALG-004",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Algebra",
        "skill": "Linear inequalities in one or two variables",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "A bakery produces loaves of sourdough bread that each require $0.6$ kilograms of flour and batches of brioche rolls that each require $0.4$ kilograms of flour. The bakery has at most $36$ kilograms of flour available for the morning bake and must prepare at least $30$ loaves of sourdough bread to fulfill standing restaurant orders.",
        "prompt": "If $s$ represents the number of sourdough loaves and $b$ represents the number of brioche batches, what is the maximum number of brioche batches the bakery can produce?",
        "choices": [
            {"id": "A", "text": "$45$"},
            {"id": "B", "text": "$30$"},
            {"id": "C", "text": "$60$"},
            {"id": "D", "text": "$90$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A", "45"],
        "explanation": "The flour constraint is $0.6s + 0.4b \\le 36$ with $s \\ge 30$. To maximize $b$, use the minimum required sourdough loaves $s = 30$: $0.6(30) + 0.4b \\le 36 \\Rightarrow 18 + 0.4b \\le 36 \\Rightarrow 0.4b \\le 18 \\Rightarrow b \\le 45$.",
        "distractor_rationales": {
            "B": "This is the minimum number of sourdough loaves required, not the maximum number of brioche batches.",
            "C": "Divides $36$ by $0.6$ instead of accounting for the sourdough requirement.",
            "D": "Assumes $s = 0$, ignoring the constraint $s \\ge 30$."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ALG-005",
        "external_id": "HDSAT-M-ALG-005",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Algebra",
        "skill": "Systems of two linear equations in two variables",
        "difficulty": "Hard",
        "format": "spr",
        "stimulus": "$$kx - 6y = 14$$\n$$15x - 18y = 42$$",
        "prompt": "In the system of equations above, $k$ is a constant. If the system has infinitely many solutions, what is the value of $k$?",
        "choices": None,
        "correct_answer": "5",
        "acceptable_answers": ["5", "5.0"],
        "explanation": "A system of two linear equations has infinitely many solutions when one equation is a non-zero constant multiple of the other. Comparing the $y$-coefficients and constant terms, $-18 = 3(-6)$ and $42 = 3(14)$. Therefore the second equation is $3$ times the first equation, so $15 = 3k$, which gives $k = 5$.",
        "distractor_rationales": {},
        "source_id": "hdsat-benchmark-sim-1"
    },

    # =========================================================================
    # MATH — Advanced Math
    # =========================================================================
    {
        "id": "M-ADV-001",
        "external_id": "HDSAT-M-ADV-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Advanced Math",
        "skill": "Equivalent expressions",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "$$(2x^2 - 5x + 3) - (x^2 - 4x - 7)$$",
        "prompt": "Which of the following is equivalent to the given expression?",
        "choices": [
            {"id": "A", "text": "$x^2 - x + 10$"},
            {"id": "B", "text": "$x^2 - 9x - 4$"},
            {"id": "C", "text": "$x^2 - x - 4$"},
            {"id": "D", "text": "$3x^2 - 9x + 10$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Distribute the subtraction sign across the second polynomial: $2x^2 - 5x + 3 - x^2 + 4x + 7$. Combine like terms: $(2x^2 - x^2) + (-5x + 4x) + (3 + 7) = x^2 - x + 10$.",
        "distractor_rationales": {
            "B": "Fails to distribute the negative sign to $-4x$ and $-7$.",
            "C": "Distributes the negative sign to $-4x$ but not to $-7$.",
            "D": "Adds the $x^2$ terms instead of subtracting."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ADV-002",
        "external_id": "HDSAT-M-ADV-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Advanced Math",
        "skill": "Nonlinear functions",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "The height $h(t)$, in meters above the ground, of a weather probe launched vertically from a platform is modeled by the function $h(t) = -5t^2 + 40t + 12$, where $t$ is the time in seconds after launch.",
        "prompt": "What is the maximum height, in meters, reached by the probe?",
        "choices": [
            {"id": "A", "text": "$92$"},
            {"id": "B", "text": "$80$"},
            {"id": "C", "text": "$52$"},
            {"id": "D", "text": "$4$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A", "92"],
        "explanation": "For a quadratic function $h(t) = at^2 + bt + c$ with $a < 0$, the maximum occurs at the vertex $t = -b/(2a) = -40 / (2 \\cdot (-5)) = 4$ seconds. Evaluating $h(4) = -5(4)^2 + 40(4) + 12 = -80 + 160 + 12 = 92$ meters.",
        "distractor_rationales": {
            "B": "Omits the initial platform height of $12$ meters.",
            "C": "Evaluates $h(2)$ instead of the vertex $h(4)$.",
            "D": "Gives the time $t = 4$ seconds at which the maximum occurs rather than the maximum height."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ADV-003",
        "external_id": "HDSAT-M-ADV-003",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Advanced Math",
        "skill": "Nonlinear equations in one variable and systems of equations in two variables",
        "difficulty": "Medium",
        "format": "spr",
        "stimulus": "$$x^2 - 11x + 24 = 0$$",
        "prompt": "What is the positive difference between the two solutions to the given quadratic equation?",
        "choices": None,
        "correct_answer": "5",
        "acceptable_answers": ["5", "5.0"],
        "explanation": "Factor the quadratic expression: $(x - 3)(x - 8) = 0$. The solutions are $x = 8$ and $x = 3$. The positive difference between the two solutions is $8 - 3 = 5$.",
        "distractor_rationales": {},
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ADV-004",
        "external_id": "HDSAT-M-ADV-004",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Advanced Math",
        "skill": "Nonlinear functions",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "A culture of bioluminescent bacteria initially contains $2{,}500$ cells. Under controlled nutrient conditions, the population doubles every $3$ hours.",
        "prompt": "Which function $P(t)$ best models the number of bacteria in the culture $t$ hours after the start of the observation?",
        "choices": [
            {"id": "A", "text": "$P(t) = 2{,}500(2)^{t/3}$"},
            {"id": "B", "text": "$P(t) = 2{,}500(2)^{3t}$"},
            {"id": "C", "text": "$P(t) = 2{,}500(3)^{t/2}$"},
            {"id": "D", "text": "$P(t) = 2{,}500 + 2^{t/3}$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Because the population doubles every $3$ hours, the growth factor per $3$-hour period is $2$, and the number of $3$-hour doubling periods in $t$ hours is $t/3$. Thus $P(t) = 2{,}500(2)^{t/3}$.",
        "distractor_rationales": {
            "B": "Models a population that doubles $3$ times per hour (every $20$ minutes).",
            "C": "Uses base $3$ (tripling) instead of base $2$ (doubling).",
            "D": "Adds the exponential term instead of multiplying the initial population."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-ADV-005",
        "external_id": "HDSAT-M-ADV-005",
        "assessments": ["SAT", "PSAT/NMSQT"],
        "section": "Math",
        "domain": "Advanced Math",
        "skill": "Nonlinear equations in one variable and systems of equations in two variables",
        "difficulty": "Hard",
        "format": "spr",
        "stimulus": "$$2x^2 - 12x + c = 0$$",
        "prompt": "In the given equation, $c$ is a constant. If the equation has exactly one real solution, what is the value of $c$?",
        "choices": None,
        "correct_answer": "18",
        "acceptable_answers": ["18", "18.0"],
        "explanation": "A quadratic equation $ax^2 + bx + c = 0$ has exactly one real solution when its discriminant $b^2 - 4ac$ equals $0$. Here $a = 2$ and $b = -12$, so $(-12)^2 - 4(2)(c) = 0 \\Rightarrow 144 - 8c = 0 \\Rightarrow c = 18$.",
        "distractor_rationales": {},
        "source_id": "hdsat-benchmark-sim-1"
    },

    # =========================================================================
    # MATH — Problem-Solving and Data Analysis
    # =========================================================================
    {
        "id": "M-PSD-001",
        "external_id": "HDSAT-M-PSD-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Problem-Solving and Data Analysis",
        "skill": "Percentages",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "During an annual clearance sale, a scientific instrument supplier reduces the price of a digital oscilloscope by $20\\%$. A university laboratory also applies an educational grant discount that takes an additional $10\\%$ off the sale price.",
        "prompt": "If the original list price of the oscilloscope was $\\$650$, what is the final price paid by the laboratory, before tax?",
        "choices": [
            {"id": "A", "text": "$\\$468$"},
            {"id": "B", "text": "$\\$455$"},
            {"id": "C", "text": "$\\$520$"},
            {"id": "D", "text": "$\\$585$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A", "468"],
        "explanation": "After the $20\\%$ reduction, the sale price is $650 \\times 0.80 = \\$520$. Taking an additional $10\\%$ off the sale price yields $520 \\times 0.90 = \\$468$.",
        "distractor_rationales": {
            "B": "Adds the two percentages ($30\\%$) and computes $650 \\times 0.70 = 455$.",
            "C": "Applies only the initial $20\\%$ discount.",
            "D": "Applies only a $10\\%$ discount."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-PSD-002",
        "external_id": "HDSAT-M-PSD-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Problem-Solving and Data Analysis",
        "skill": "One-variable data: distributions and measures of center and spread",
        "difficulty": "Medium",
        "format": "spr",
        "stimulus": "The table shows the daily particulate matter readings (in micrograms per cubic meter) recorded at an air-quality station over $6$ days. On Day 7, a reading of $92$ micrograms per cubic meter is recorded due to a regional dust event.",
        "figure_metadata": {
            "type": "table",
            "caption": "Daily Particulate Matter Readings (Days 1–6)",
            "headers": ["Day", "Reading (µg/m³)"],
            "rows": [
                ["Day 1", "14"],
                ["Day 2", "18"],
                ["Day 3", "21"],
                ["Day 4", "21"],
                ["Day 5", "25"],
                ["Day 6", "33"]
            ]
        },
        "prompt": "By how much does the mean of the $7$-day dataset exceed the median of the $7$-day dataset?",
        "choices": None,
        "correct_answer": "11",
        "acceptable_answers": ["11", "11.0"],
        "explanation": "The ordered $7$-day dataset is $14, 18, 21, 21, 25, 33, 92$. The median (fourth value) is $21$. The sum of all $7$ readings is $14 + 18 + 21 + 21 + 25 + 33 + 92 = 224$, so the mean is $224 / 7 = 32$. The mean exceeds the median by $32 - 21 = 11$.",
        "distractor_rationales": {},
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-PSD-003",
        "external_id": "HDSAT-M-PSD-003",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Problem-Solving and Data Analysis",
        "skill": "Probability and conditional probability",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "A quality-control engineer inspected $240$ solar panels from two production lines and recorded the results in the table.",
        "figure_metadata": {
            "type": "table",
            "caption": "Solar Panel Quality Inspection",
            "headers": ["Production Line", "Passed", "Failed", "Total"],
            "rows": [
                ["Line A", "132", "8", "140"],
                ["Line B", "93", "7", "100"],
                ["Total", "225", "15", "240"]
            ]
        },
        "prompt": "If one of the panels that passed inspection is selected at random, what is the probability that it was manufactured on Line A?",
        "choices": [
            {"id": "A", "text": "$\\dfrac{44}{75}$"},
            {"id": "B", "text": "$\\dfrac{33}{35}$"},
            {"id": "C", "text": "$\\dfrac{11}{20}$"},
            {"id": "D", "text": "$\\dfrac{7}{12}$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "The condition restricts the sample space to the $225$ panels that passed inspection. Of those, $132$ came from Line A. The conditional probability is $132 / 225 = 44 / 75$ (dividing numerator and denominator by $3$).",
        "distractor_rationales": {
            "B": "Computes $132 / 140$, the probability that a Line A panel passed.",
            "C": "Computes $132 / 240$, the unconditional proportion of all panels that came from Line A and passed.",
            "D": "Computes $140 / 240$, the proportion of all panels produced on Line A."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-PSD-004",
        "external_id": "HDSAT-M-PSD-004",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Problem-Solving and Data Analysis",
        "skill": "Inference from sample statistics and margin of error",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "A transit authority surveyed a random sample of $400$ weekday commuter-rail riders in a metropolitan region. Based on the sample, the authority estimated that $64\\%$ of all weekday commuter-rail riders in the region use mobile ticketing, with an associated margin of error of $4.5\\%$ at the $95\\%$ confidence level.",
        "prompt": "Which of the following is the most appropriate conclusion from the survey?",
        "choices": [
            {"id": "A", "text": "It is plausible that the actual percentage of all weekday commuter-rail riders in the region who use mobile ticketing is between $59.5\\%$ and $68.5\\%$."},
            {"id": "B", "text": "Exactly $64\\%$ of all transit riders across every mode of transportation in the region use mobile ticketing."},
            {"id": "C", "text": "Among the $400$ sampled riders, between $59.5\\%$ and $68.5\\%$ stated that they were $95\\%$ satisfied with mobile ticketing."},
            {"id": "D", "text": "If the transit authority surveyed another $400$ riders, the new sample proportion would be guaranteed to equal $64\\%$."}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "A sample estimate of $64\\%$ with a margin of error of $\\pm 4.5\\%$ yields a plausible interval of $64\\% - 4.5\\% = 59.5\\%$ to $64\\% + 4.5\\% = 68.5\\%$ for the population from which the random sample was drawn (weekday commuter-rail riders in the region).",
        "distractor_rationales": {
            "B": "Overgeneralizes beyond commuter-rail riders and treats the sample estimate as an exact population value.",
            "C": "Confuses the confidence level and margin of error with individual rider satisfaction.",
            "D": "New random samples vary due to sampling variability; they are not guaranteed to match $64\\%$."
        },
        "source_id": "hdsat-open-core-2026"
    },

    # =========================================================================
    # MATH — Geometry and Trigonometry
    # =========================================================================
    {
        "id": "M-GEO-001",
        "external_id": "HDSAT-M-GEO-001",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Geometry and Trigonometry",
        "skill": "Area and volume",
        "difficulty": "Easy",
        "format": "spr",
        "stimulus": "A right circular cylinder has a base radius of $4$ centimeters and a height of $9$ centimeters. The volume of the cylinder can be written in the form $k\\pi$ cubic centimeters, where $k$ is a constant.",
        "prompt": "What is the value of $k$?",
        "choices": None,
        "correct_answer": "144",
        "acceptable_answers": ["144", "144.0"],
        "explanation": "The volume of a right circular cylinder is $V = \\pi r^2 h$. Substituting $r = 4$ and $h = 9$ gives $V = \\pi (4)^2 (9) = 144\\pi$ cubic centimeters, so $k = 144$.",
        "distractor_rationales": {},
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-GEO-002",
        "external_id": "HDSAT-M-GEO-002",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"],
        "section": "Math",
        "domain": "Geometry and Trigonometry",
        "skill": "Right triangles and trigonometry",
        "difficulty": "Medium",
        "format": "multiple_choice",
        "stimulus": "In right triangle $ABC$, angle $C$ is a right angle, the length of side $AC$ is $12$, and the length of hypotenuse $AB$ is $15$.",
        "prompt": "What is the value of $\\sin A$?",
        "choices": [
            {"id": "A", "text": "$\\dfrac{3}{5}$"},
            {"id": "B", "text": "$\\dfrac{4}{5}$"},
            {"id": "C", "text": "$\\dfrac{3}{4}$"},
            {"id": "D", "text": "$\\dfrac{4}{3}$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "By the Pythagorean theorem, $BC = \\sqrt{15^2 - 12^2} = \\sqrt{225 - 144} = \\sqrt{81} = 9$. Side $BC$ is opposite angle $A$, so $\\sin A = \\text{opposite}/\\text{hypotenuse} = 9 / 15 = 3 / 5$.",
        "distractor_rationales": {
            "B": "Equals $\\cos A = 12/15 = 4/5$.",
            "C": "Equals $\\tan A = 9/12 = 3/4$.",
            "D": "Equals $\\cot A = 12/9 = 4/3$, which is greater than $1$."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-GEO-003",
        "external_id": "HDSAT-M-GEO-003",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Geometry and Trigonometry",
        "skill": "Circles",
        "difficulty": "Hard",
        "format": "multiple_choice",
        "stimulus": "$$x^2 + y^2 - 6x + 8y - 11 = 0$$",
        "prompt": "The equation above represents a circle in the $xy$-plane. What is the radius of the circle?",
        "choices": [
            {"id": "A", "text": "$6$"},
            {"id": "B", "text": "$36$"},
            {"id": "C", "text": "$\\sqrt{11}$"},
            {"id": "D", "text": "$5$"}
        ],
        "correct_answer": "A",
        "acceptable_answers": ["A", "6"],
        "explanation": "Complete the square for $x$ and $y$: $(x^2 - 6x + 9) + (y^2 + 8y + 16) = 11 + 9 + 16 \\Rightarrow (x - 3)^2 + (y + 4)^2 = 36$. In standard form $(x - h)^2 + (y - k)^2 = r^2$, we have $r^2 = 36$, so the radius is $r = 6$.",
        "distractor_rationales": {
            "B": "Gives $r^2 = 36$ instead of $r = 6$.",
            "C": "Takes the square root of the constant term before completing the square.",
            "D": "Finds $\\sqrt{9 + 16} = 5$, omitting the $11$ on the right-hand side."
        },
        "source_id": "hdsat-open-core-2026"
    },
    {
        "id": "M-GEO-004",
        "external_id": "HDSAT-M-GEO-004",
        "assessments": ["SAT", "PSAT/NMSQT", "PSAT 10"],
        "section": "Math",
        "domain": "Geometry and Trigonometry",
        "skill": "Circles",
        "difficulty": "Hard",
        "format": "spr",
        "stimulus": "A circle in the $xy$-plane has radius $10$. Sector $AOB$ of the circle has a central angle of $\\dfrac{2\\pi}{5}$ radians. The area of sector $AOB$ can be written as $m\\pi$, where $m$ is a constant.",
        "prompt": "What is the value of $m$?",
        "choices": None,
        "correct_answer": "20",
        "acceptable_answers": ["20", "20.0"],
        "explanation": "The area of a sector with central angle $\\theta$ radians is $\\frac{1}{2}r^2\\theta$. Substituting $r = 10$ and $\\theta = \\frac{2\\pi}{5}$ gives $\\text{Area} = \\frac{1}{2}(100)\\left(\\frac{2\\pi}{5}\\right) = 20\\pi$. Thus $m = 20$.",
        "distractor_rationales": {},
        "source_id": "hdsat-benchmark-sim-1"
    },
]


# ============================================================================
# HDSAT STUDY DECK: VOCABULARY + MATH FORMULA FLASHCARDS
# Definitions are concise original glosses written for HDSAT (not copied from
# any proprietary dictionary). Formula cards state public mathematical facts.
# ============================================================================

FLASHCARDS = [
    # --- Vocabulary ---
    {"id": "V-001", "deck": "vocabulary", "front": "abate (verb)", "back": "To become less intense or widespread; to lessen.", "tags": ["change", "reduce"]},
    {"id": "V-002", "deck": "vocabulary", "front": "candid (adj.)", "back": "Honest and direct, especially about something difficult.", "tags": ["tone"]},
    {"id": "V-003", "deck": "vocabulary", "front": "corroborate (verb)", "back": "To confirm or support a claim with additional evidence.", "tags": ["evidence"]},
    {"id": "V-004", "deck": "vocabulary", "front": "dissent (noun)", "back": "Disagreement with an established opinion or authority.", "tags": ["argument"]},
    {"id": "V-005", "deck": "vocabulary", "front": "empirical (adj.)", "back": "Based on observation or experiment rather than theory alone.", "tags": ["evidence"]},
    {"id": "V-006", "deck": "vocabulary", "front": "exacerbate (verb)", "back": "To make a problem or bad situation worse.", "tags": ["cause-effect"]},
    {"id": "V-007", "deck": "vocabulary", "front": "frugal (adj.)", "back": "Careful and economical with money or resources.", "tags": ["character"]},
    {"id": "V-008", "deck": "vocabulary", "front": "hinder (verb)", "back": "To create difficulty that slows or prevents progress.", "tags": ["cause-effect"]},
    {"id": "V-009", "deck": "vocabulary", "front": "impartial (adj.)", "back": "Treating all sides equally; not favouring one party.", "tags": ["argument"]},
    {"id": "V-010", "deck": "vocabulary", "front": "inevitable (adj.)", "back": "Certain to happen; unavoidable.", "tags": ["certainty"]},
    {"id": "V-011", "deck": "vocabulary", "front": "lucid (adj.)", "back": "Expressed clearly and easy to understand.", "tags": ["style"]},
    {"id": "V-012", "deck": "vocabulary", "front": "mitigate (verb)", "back": "To make something less severe or harmful.", "tags": ["change", "reduce"]},
    {"id": "V-013", "deck": "vocabulary", "front": "nuance (noun)", "back": "A subtle difference in meaning, tone, or expression.", "tags": ["style"]},
    {"id": "V-014", "deck": "vocabulary", "front": "obsolete (adj.)", "back": "No longer in use because something newer replaced it.", "tags": ["change"]},
    {"id": "V-015", "deck": "vocabulary", "front": "plausible (adj.)", "back": "Seeming reasonable or believable, though not proven.", "tags": ["argument"]},
    {"id": "V-016", "deck": "vocabulary", "front": "pragmatic (adj.)", "back": "Guided by practical results rather than ideals.", "tags": ["character"]},
    {"id": "V-017", "deck": "vocabulary", "front": "proponent (noun)", "back": "A person who argues in favour of something.", "tags": ["argument"]},
    {"id": "V-018", "deck": "vocabulary", "front": "reluctant (adj.)", "back": "Unwilling and hesitant to act.", "tags": ["character"]},
    {"id": "V-019", "deck": "vocabulary", "front": "scrupulous (adj.)", "back": "Very careful to be honest and thorough.", "tags": ["character"]},
    {"id": "V-020", "deck": "vocabulary", "front": "speculate (verb)", "back": "To form a conclusion without firm evidence.", "tags": ["evidence"]},
    {"id": "V-021", "deck": "vocabulary", "front": "substantiate (verb)", "back": "To provide evidence that proves a claim.", "tags": ["evidence"]},
    {"id": "V-022", "deck": "vocabulary", "front": "tentative (adj.)", "back": "Uncertain or not yet final; offered with hesitation.", "tags": ["certainty"]},
    {"id": "V-023", "deck": "vocabulary", "front": "undermine (verb)", "back": "To weaken something gradually, often an argument or position.", "tags": ["cause-effect"]},
    {"id": "V-024", "deck": "vocabulary", "front": "volatile (adj.)", "back": "Liable to change rapidly and unpredictably.", "tags": ["change"]},
    # --- Math formulas ---
    {"id": "F-001", "deck": "math_formula", "front": "Slope between two points", "latex": "m=\\dfrac{y_2-y_1}{x_2-x_1}", "back": "Slope equals rise over run; the denominator cannot be zero.", "tags": ["algebra"]},
    {"id": "F-002", "deck": "math_formula", "front": "Slope-intercept form", "latex": "y=mx+b", "back": "m is the slope and b is the y-intercept.", "tags": ["algebra"]},
    {"id": "F-003", "deck": "math_formula", "front": "Quadratic formula", "latex": "x=\\dfrac{-b\\pm\\sqrt{b^2-4ac}}{2a}", "back": "Solves ax^2+bx+c=0. The expression under the radical is the discriminant.", "tags": ["advanced-math"]},
    {"id": "F-004", "deck": "math_formula", "front": "Vertex of a parabola", "latex": "x=-\\dfrac{b}{2a}", "back": "The x-coordinate of the vertex of y = ax^2 + bx + c (also the axis of symmetry).", "tags": ["advanced-math"]},
    {"id": "F-005", "deck": "math_formula", "front": "Difference of squares", "latex": "a^2-b^2=(a+b)(a-b)", "back": "Factors any difference of two perfect squares.", "tags": ["advanced-math"]},
    {"id": "F-006", "deck": "math_formula", "front": "Perfect square trinomials", "latex": "a^2\\pm2ab+b^2=(a\\pm b)^2", "back": "Recognise these to factor quickly without expanding.", "tags": ["advanced-math"]},
    {"id": "F-007", "deck": "math_formula", "front": "Exponent rules", "latex": "x^a x^b = x^{a+b}, \\quad \\dfrac{x^a}{x^b}=x^{a-b}, \\quad (x^a)^b=x^{ab}", "back": "Add exponents when multiplying like bases, subtract when dividing, multiply when raising a power to a power.", "tags": ["advanced-math"]},
    {"id": "F-008", "deck": "math_formula", "front": "Percent change", "latex": "\\%\\Delta=\\dfrac{\\text{new}-\\text{old}}{\\text{old}}\\times100", "back": "A positive result is an increase; a negative result is a decrease.", "tags": ["problem-solving"]},
    {"id": "F-009", "deck": "math_formula", "front": "Exponential growth and decay", "latex": "y=a(1\\pm r)^t", "back": "a is the initial amount, r the rate per period, t the number of periods.", "tags": ["problem-solving"]},
    {"id": "F-010", "deck": "math_formula", "front": "Compound interest", "latex": "A=P\\left(1+\\dfrac{r}{n}\\right)^{nt}", "back": "P principal, r annual rate, n compounds per year, t years.", "tags": ["problem-solving"]},
    {"id": "F-011", "deck": "math_formula", "front": "Distance, rate, time", "latex": "d=rt", "back": "Distance equals rate multiplied by time; rearrange for the unknown.", "tags": ["problem-solving"]},
    {"id": "F-012", "deck": "math_formula", "front": "Average (arithmetic mean)", "latex": "\\bar{x}=\\dfrac{\\text{sum of values}}{\\text{number of values}}", "back": "Use sum = mean x count to find a missing value.", "tags": ["problem-solving"]},
    {"id": "F-013", "deck": "math_formula", "front": "Pythagorean theorem", "latex": "a^2+b^2=c^2", "back": "For a right triangle, c is the hypotenuse.", "tags": ["geometry"]},
    {"id": "F-014", "deck": "math_formula", "front": "Special right triangles", "latex": "45\\text{-}45\\text{-}90:\\; x, x, x\\sqrt2 \\qquad 30\\text{-}60\\text{-}90:\\; x, x\\sqrt3, 2x", "back": "Sides are in a fixed ratio, so one known side gives the others.", "tags": ["geometry"]},
    {"id": "F-015", "deck": "math_formula", "front": "Circle: area and circumference", "latex": "A=\\pi r^2, \\qquad C=2\\pi r", "back": "Area uses the square of the radius; circumference is the full distance around.", "tags": ["geometry"]},
    {"id": "F-016", "deck": "math_formula", "front": "Circle equation (centre–radius form)", "latex": "(x-h)^2+(y-k)^2=r^2", "back": "Centre (h, k) and radius r.", "tags": ["geometry"]},
    {"id": "F-017", "deck": "math_formula", "front": "Sector and arc of a circle", "latex": "\\text{arc}=\\dfrac{\\theta}{360}2\\pi r, \\qquad \\text{sector}=\\dfrac{\\theta}{360}\\pi r^2", "back": "The fraction of the circle is central angle divided by 360 degrees.", "tags": ["geometry"]},
    {"id": "F-018", "deck": "math_formula", "front": "Volume and surface area", "latex": "V_{box}=lwh,\\; V_{cyl}=\\pi r^2h,\\; V_{sph}=\\tfrac43\\pi r^3,\\; V_{cone}=\\tfrac13\\pi r^2h", "back": "The reference sheet supplies these; know which one each problem needs.", "tags": ["geometry"]},
    {"id": "F-019", "deck": "math_formula", "front": "Right-triangle trigonometry", "latex": "\\sin\\theta=\\dfrac{\\text{opp}}{\\text{hyp}},\\; \\cos\\theta=\\dfrac{\\text{adj}}{\\text{hyp}},\\; \\tan\\theta=\\dfrac{\\text{opp}}{\\text{adj}}", "back": "The reference sheet lists both degree and radian values for common angles.", "tags": ["trigonometry"]},
    {"id": "F-020", "deck": "math_formula", "front": "Sine, cosine and tangent identities", "latex": "\\sin^2\\theta+\\cos^2\\theta=1, \\quad \\tan\\theta=\\dfrac{\\sin\\theta}{\\cos\\theta}", "back": "The Pythagorean identity lets you convert between sine and cosine.", "tags": ["trigonometry"]},
    {"id": "F-021", "deck": "math_formula", "front": "Radians and degrees", "latex": "\\pi \\text{ rad}=180^\\circ", "back": "Multiply by pi/180 for degrees to radians; by 180/pi for radians to degrees.", "tags": ["trigonometry"]},
    {"id": "F-022", "deck": "math_formula", "front": "Systems: substitution and elimination", "latex": "\\text{inconsistent}\\Rightarrow \\text{no solution}, \\quad \\text{dependent}\\Rightarrow \\text{infinitely many}", "back": "Parallel lines give no solution; identical lines give infinitely many.", "tags": ["algebra"]},
]

# ============================================================================
# HDSAT STUDY RESOURCE LIBRARY
# Every entry below is a real, publicly reachable resource. Provider, access
# model and verification notes are recorded so the library can be audited.
# ============================================================================

RESOURCES = [
    {"id": "R-001", "title": "Official SAT Practice (Khan Academy)", "provider": "Khan Academy / College Board", "url": "https://www.khanacademy.org/digital-sat", "type": "course", "cost": "free", "description": "Full-length practice and skill drills built with College Board. Khan Academy content is published under CC BY-NC-SA.", "tags": ["sat", "full-length", "math", "reading"]},
    {"id": "R-002", "title": "Bluebook: digital test app", "provider": "College Board", "url": "https://bluebook.app.collegeboard.org/", "type": "tool", "cost": "free", "description": "The official application used on test day. Install it to rehearse the exact digital test interface.", "tags": ["sat", "digital", "official"]},
    {"id": "R-003", "title": "Digital SAT Suite: what to expect", "provider": "College Board", "url": "https://satsuite.collegeboard.org/digital/what-to-expect", "type": "reference", "cost": "free", "description": "Official structure: module lengths, timing, adaptive second modules and the built-in calculator.", "tags": ["sat", "structure", "official"]},
    {"id": "R-004", "title": "PSAT/NMSQT and PSAT 10 overview", "provider": "College Board", "url": "https://satsuite.collegeboard.org/psat-nmsqt", "type": "reference", "cost": "free", "description": "Assessment structure, timing and scoring for the PSAT/NMSQT; a useful companion for PSAT 10 and PSAT 8/9 practice.", "tags": ["psat", "structure", "official"]},
    {"id": "R-005", "title": "SAT Suite Question Bank", "provider": "College Board", "url": "https://satsuitequestionbank.collegeboard.org/", "type": "reference", "cost": "free", "description": "Searchable bank of real released questions. Read-only: College Board's terms do not permit re-hosting these items, so HDSAT links to it instead of importing it.", "tags": ["sat", "question-bank", "official", "licensing"]},
    {"id": "R-006", "title": "Desmos Graphing Calculator", "provider": "Desmos", "url": "https://www.desmos.com/calculator", "type": "tool", "cost": "free", "description": "The same graphing calculator embedded in Bluebook. Practise with it here, or use the HDSAT Desmos Lab page.", "tags": ["math", "calculator", "tool"]},
    {"id": "R-007", "title": "Desmos API documentation", "provider": "Desmos", "url": "https://www.desmos.com/api/v1.12/docs/index.html", "type": "reference", "cost": "free", "description": "How the embeddable calculator API works, including the options HDSAT's Desmos Lab uses.", "tags": ["math", "calculator", "developers"]},
    {"id": "R-008", "title": "Digital SAT Math reference sheet", "provider": "College Board", "url": "https://satsuite.collegeboard.org/media/pdf/digital-sat-math-reference-sheet.pdf", "type": "reference", "cost": "free", "description": "The reference sheet provided inside the digital test. HDSAT renders the same formulas in its in-test reference panel.", "tags": ["math", "formulas", "official"]},
    {"id": "R-009", "title": "OpenStax College Algebra 2e", "provider": "OpenStax (Rice University)", "url": "https://openstax.org/details/books/college-algebra-2e", "type": "textbook", "cost": "free", "description": "Peer-reviewed open textbook, CC BY 4.0. Chapters 2, 5 and 7 map closely onto the Algebra and Advanced Math domains.", "tags": ["math", "algebra", "textbook", "open-license"]},
    {"id": "R-010", "title": "OpenStax Statistics", "provider": "OpenStax (Rice University)", "url": "https://openstax.org/details/books/statistics", "type": "textbook", "cost": "free", "description": "CC BY 4.0 coverage of data displays, probability and inference for the Problem-Solving and Data Analysis domain.", "tags": ["math", "statistics", "textbook", "open-license"]},
    {"id": "R-011", "title": "OpenStax Writing Guide with Handbook", "provider": "OpenStax (Rice University)", "url": "https://openstax.org/details/books/writing-guide", "type": "textbook", "cost": "free", "description": "CC BY 4.0 guidance on argument, evidence and revision for the Reading and Writing section.", "tags": ["reading", "writing", "textbook", "open-license"]},
    {"id": "R-012", "title": "Purdue OWL: grammar and punctuation", "provider": "Purdue University", "url": "https://owl.purdue.edu/owl/general_writing/grammar/index.html", "type": "course", "cost": "free", "description": "Clear reference pages on sentence boundaries, pronoun agreement, modifiers and verb forms for Standard English Conventions.", "tags": ["writing", "grammar", "conventions"]},
    {"id": "R-013", "title": "Purdue OWL: using evidence and citation", "provider": "Purdue University", "url": "https://owl.purdue.edu/owl/research_and_citation/using_research/index.html", "type": "course", "cost": "free", "description": "How to integrate evidence into an argument, useful for Information and Ideas and Expression of Ideas questions.", "tags": ["reading", "evidence", "argument"]},
    {"id": "R-014", "title": "Khan Academy: Grammar", "provider": "Khan Academy", "url": "https://www.khanacademy.org/humanities/grammar", "type": "course", "cost": "free", "description": "Video and practice sequence for the conventions tested in the Writing portion of the digital Reading and Writing module.", "tags": ["writing", "grammar", "conventions"]},
    {"id": "R-015", "title": "Khan Academy: Statistics and probability", "provider": "Khan Academy", "url": "https://www.khanacademy.org/math/statistics-probability", "type": "course", "cost": "free", "description": "Interactive units on scatterplots, two-way tables, probability and sampling.", "tags": ["math", "statistics", "problem-solving"]},
    {"id": "R-016", "title": "Khan Academy: Algebra 2", "provider": "Khan Academy", "url": "https://www.khanacademy.org/math/algebra2", "type": "course", "cost": "free", "description": "Sequences, polynomial and rational functions, exponentials, logarithms and trigonometry.", "tags": ["math", "advanced-math", "trigonometry"]},
    {"id": "R-017", "title": "Wolfram MathWorld", "provider": "Wolfram Research", "url": "https://mathworld.wolfram.com/", "type": "reference", "cost": "free", "description": "Reliable definitions and identities when a formula reference sheet is not enough.", "tags": ["math", "reference"]},
    {"id": "R-018", "title": "College Board: SAT fee waivers and test-day policies", "provider": "College Board", "url": "https://satsuite.collegeboard.org/sat/registration/fee-waivers", "type": "reference", "cost": "free", "description": "Official registration, accommodation and fee-waiver information so practice planning matches real test logistics.", "tags": ["sat", "logistics", "official"]},
]


# ============================================================================
# VALIDATION ENGINE
# ============================================================================

ALLOWED_SECTIONS = {"Reading and Writing", "Math"}
ALLOWED_DIFFICULTY = {"Easy", "Medium", "Hard"}
ALLOWED_FORMATS = {"multiple_choice", "spr"}
LETTERS = ["A", "B", "C", "D"]

# Artifacts that indicate unreviewed machine text slipping into a student-facing
# explanation. Any hit is a hard validation failure.
FORBIDDEN_EXPLANATION_MARKERS = [
    "wait:",
    "wait!",
    "let us verify",
    "let's verify",
    "as an ai",
    "lorem ipsum",
    "todo:",
    "placeholder",
    "i apologize",
    "based on the user",
    "as requested",
]


def _letters_in(text):
    return re.findall(r"\b[A-D]\b", text or "")


def remap_choice_letters(text, mapping):
    """Rewrite 'Choice A' / 'Choices B and C' style references after a shuffle."""
    if not text:
        return text

    pattern = re.compile(r"\bChoices?\s+([A-D])((?:\s*(?:,|and|or)\s*[A-D])*)")

    def repl(match):
        found = [match.group(1)] + re.findall(r"[A-D]", match.group(2) or "")
        mapped = [mapping.get(letter, letter) for letter in found]
        if len(mapped) == 1:
            return "Choice " + mapped[0]
        body = ", ".join(mapped[:-1]) + " and " + mapped[-1]
        return "Choices " + body

    return pattern.sub(repl, text)


def deterministic_shuffle(question):
    """Shuffle multiple-choice options with a per-question seed so the correct
    answer is not always the same position, then repair every letter reference."""
    if question.get("format") != "multiple_choice" or not question.get("choices"):
        return dict(question)

    q = dict(question)
    rng = random.Random("hdsat-choice-order:" + question["id"])
    original = list(q["choices"])
    shuffled = original[:]
    rng.shuffle(shuffled)

    mapping = {}
    for new_index, choice in enumerate(shuffled):
        mapping[choice["id"]] = LETTERS[new_index]

    q["choices"] = [
        {"id": LETTERS[i], "text": choice["text"]} for i, choice in enumerate(shuffled)
    ]
    q["correct_answer"] = mapping.get(str(q["correct_answer"]).strip().upper(), q["correct_answer"])
    q["acceptable_answers"] = [
        mapping.get(str(a).strip().upper(), a) for a in (q.get("acceptable_answers") or [])
    ]
    q["explanation"] = remap_choice_letters(q.get("explanation"), mapping)
    rationales = q.get("distractor_rationales") or {}
    q["distractor_rationales"] = {
        mapping.get(key, key): remap_choice_letters(value, mapping)
        for key, value in rationales.items()
    }
    q["choice_order_seed"] = "hdsat-choice-order:" + question["id"]
    return q


def validate(questions, sources):
    """Return (errors, warnings). Errors block generation; warnings are reported."""
    errors, warnings = [], []
    source_ids = {s["source_id"] for s in sources}
    seen_ids, seen_external = set(), set()

    for q in questions:
        qid = q.get("id", "<missing id>")
        if not q.get("id"):
            errors.append("A question is missing its id")
            continue
        if qid in seen_ids:
            errors.append(f"{qid}: duplicate internal id")
        seen_ids.add(qid)

        external = q.get("external_id")
        if external in seen_external:
            errors.append(f"{qid}: duplicate external_id {external}")
        seen_external.add(external)

        if q.get("section") not in ALLOWED_SECTIONS:
            errors.append(f"{qid}: invalid section {q.get('section')!r}")
        if q.get("difficulty") not in ALLOWED_DIFFICULTY:
            errors.append(f"{qid}: invalid difficulty {q.get('difficulty')!r}")
        fmt = q.get("format")
        if fmt not in ALLOWED_FORMATS:
            errors.append(f"{qid}: invalid format {fmt!r}")

        if q.get("source_id") not in source_ids:
            errors.append(f"{qid}: unknown source_id {q.get('source_id')!r}")
        if not q.get("domain") or not q.get("skill"):
            errors.append(f"{qid}: domain and skill are required")
        if not (q.get("assessments") or []):
            errors.append(f"{qid}: at least one assessment tag is required")
        if not (q.get("prompt") or "").strip():
            errors.append(f"{qid}: prompt is empty")
        if q.get("section") == "Reading and Writing" and not (q.get("stimulus") or "").strip():
            warnings.append(f"{qid}: Reading and Writing item has no stimulus text")

        explanation = q.get("explanation") or ""
        if len(explanation.strip()) < 40:
            errors.append(f"{qid}: explanation is missing or too short")
        lowered = explanation.lower()
        for marker in FORBIDDEN_EXPLANATION_MARKERS:
            if marker in lowered:
                errors.append(f"{qid}: explanation contains unreviewed marker {marker!r}")

        answer = str(q.get("correct_answer", "")).strip()
        if fmt == "multiple_choice":
            choices = q.get("choices") or []
            ids = [c.get("id") for c in choices]
            if len(choices) < 3:
                errors.append(f"{qid}: multiple-choice item needs at least 3 options")
            if len(set(ids)) != len(ids):
                errors.append(f"{qid}: duplicate choice ids")
            if answer not in ids:
                errors.append(f"{qid}: correct_answer {answer!r} is not one of {ids}")
            if any(not (c.get("text") or "").strip() for c in choices):
                errors.append(f"{qid}: a choice has empty text")
            for key in (q.get("distractor_rationales") or {}):
                if key not in ids:
                    errors.append(f"{qid}: distractor rationale key {key!r} is not a choice id")
        elif fmt == "spr":
            if q.get("choices"):
                warnings.append(f"{qid}: SPR item has choices attached")
            if not answer:
                errors.append(f"{qid}: SPR item has no correct answer")
            accepted = q.get("acceptable_answers") or []
            if not accepted:
                errors.append(f"{qid}: SPR item needs at least one acceptable answer string")
            numeric = all(_is_number(a) for a in accepted) if accepted else False
            if not numeric and not answer:
                errors.append(f"{qid}: SPR answer is neither numeric nor textual")

    for source in sources:
        if not source.get("license"):
            errors.append(f"source {source.get('source_id')}: license is required")
        if not source.get("provenance_summary"):
            errors.append(f"source {source.get('source_id')}: provenance summary is required")
    return errors, warnings


def _is_number(value):
    try:
        float(str(value).replace(",", ""))
        return True
    except (TypeError, ValueError):
        return False


# ============================================================================
# OUTPUT GENERATION
# ============================================================================

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(ROOT, "src", "data")
SEED_DIR = os.path.join(ROOT, "supabase", "seed")


def _source_index():
    return {s["source_id"]: s for s in SOURCES}


def _public_record(q):
    source = _source_index()[q["source_id"]]
    return {
        "id": q["id"],
        "external_id": q.get("external_id"),
        "assessments": q.get("assessments", []),
        "section": q["section"],
        "domain": q["domain"],
        "skill": q["skill"],
        "difficulty": q["difficulty"],
        "format": q["format"],
        "stimulus": q.get("stimulus"),
        "prompt": q["prompt"],
        "choices": q.get("choices"),
        "figure_metadata": q.get("figure_metadata"),
        "source_id": q["source_id"],
        "source_name": source["name"],
        "license": source["license"],
        "attribution": f"{source['name']} ({source['license']})",
        "is_released_practice_set": bool(q.get("is_released_practice_set", source["is_released_practice_set"])),
        "correct_answer": str(q.get("correct_answer")),
        "acceptable_answers": q.get("acceptable_answers", []),
        "explanation": q.get("explanation", ""),
        "distractor_rationales": q.get("distractor_rationales", {}),
        "choice_order_seed": q.get("choice_order_seed"),
    }


def build_client_bank(questions):
    counts_by_source = {}
    for q in questions:
        counts_by_source[q["source_id"]] = counts_by_source.get(q["source_id"], 0) + 1
    return {
        "bank_version": BANK_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "licensing_note": (
            "Open Core bank: original HDSAT practice items (AI-assisted drafting, human review "
            "checklist). Not official College Board material. Answer keys are shipped to the "
            "client only so that guest/offline mode can grade attempts; server-side grading via "
            "the submit_question_attempt RPC remains authoritative in cloud mode."
        ),
        "sources": [
            {**s, "record_count": counts_by_source.get(s["source_id"], 0)} for s in SOURCES
        ],
        "questions": [_public_record(q) for q in questions],
    }


def _sql_str(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def _sql_json(value):
    return _sql_str(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def _sql_array(values):
    if not values:
        return "ARRAY[]::TEXT[]"
    return "ARRAY[" + ", ".join(_sql_str(v) for v in values) + "]::TEXT[]"


def build_seed_sql(questions, cards):
    lines = [
        "-- HDSAT seed data. Generated by supabase/import/import_questions.py",
        f"-- bank_version: {BANK_VERSION}  generated_at: {datetime.now(timezone.utc).isoformat()}",
        "-- Idempotent: safe to re-run. Every statement is an upsert on the primary key.",
        "",
        "BEGIN;",
        "",
    ]
    counts = {}
    for q in questions:
        counts[q["source_id"]] = counts.get(q["source_id"], 0) + 1

    lines.append("-- dataset_sources")
    for s in SOURCES:
        lines.append(
            "INSERT INTO public.dataset_sources (source_id, name, license, license_url, provenance_summary, "
            "is_released_practice_set, is_official_college_board, record_count) VALUES ("
            f"{_sql_str(s['source_id'])}, {_sql_str(s['name'])}, {_sql_str(s['license'])}, "
            f"{_sql_str(s.get('license_url'))}, {_sql_str(s['provenance_summary'])}, "
            f"{str(bool(s['is_released_practice_set'])).upper()}, "
            f"{str(bool(s['is_official_college_board'])).upper()}, {counts.get(s['source_id'], 0)}) "
            "ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name, license = EXCLUDED.license, "
            "license_url = EXCLUDED.license_url, provenance_summary = EXCLUDED.provenance_summary, "
            "is_released_practice_set = EXCLUDED.is_released_practice_set, record_count = EXCLUDED.record_count;"
        )

    lines.append("")
    lines.append("-- questions (public metadata)")
    for q in questions:
        source = _source_index()[q["source_id"]]
        lines.append(
            "INSERT INTO public.questions (id, external_id, assessments, section, domain, skill, difficulty, "
            "format, stimulus, prompt, choices, figure_metadata, source_id, source_name, license, attribution, "
            "is_released_practice_set, status) VALUES ("
            f"{_sql_str(q['id'])}, {_sql_str(q.get('external_id'))}, {_sql_array(q.get('assessments', []))}, "
            f"{_sql_str(q['section'])}, {_sql_str(q['domain'])}, {_sql_str(q['skill'])}, {_sql_str(q['difficulty'])}, "
            f"{_sql_str(q['format'])}, {_sql_str(q.get('stimulus'))}, {_sql_str(q['prompt'])}, "
            f"{_sql_json(q.get('choices')) if q.get('choices') else 'NULL'}, "
            f"{_sql_json(q.get('figure_metadata')) if q.get('figure_metadata') else 'NULL'}, "
            f"{_sql_str(q['source_id'])}, {_sql_str(source['name'])}, {_sql_str(source['license'])}, "
            f"{_sql_str(source['name'] + ' (' + source['license'] + ')')}, "
            f"{str(bool(q.get('is_released_practice_set', source['is_released_practice_set']))).upper()}, 'active') "
            "ON CONFLICT (id) DO UPDATE SET external_id = EXCLUDED.external_id, assessments = EXCLUDED.assessments, "
            "section = EXCLUDED.section, domain = EXCLUDED.domain, skill = EXCLUDED.skill, "
            "difficulty = EXCLUDED.difficulty, format = EXCLUDED.format, stimulus = EXCLUDED.stimulus, "
            "prompt = EXCLUDED.prompt, choices = EXCLUDED.choices, figure_metadata = EXCLUDED.figure_metadata, "
            "source_id = EXCLUDED.source_id, source_name = EXCLUDED.source_name, license = EXCLUDED.license, "
            "attribution = EXCLUDED.attribution, status = EXCLUDED.status, updated_at = NOW();"
        )

    lines.append("")
    lines.append("-- question_keys (server-only answer keys)")
    for q in questions:
        lines.append(
            "INSERT INTO public.question_keys (question_id, correct_answer, acceptable_answers, explanation, "
            "distractor_rationales) VALUES ("
            f"{_sql_str(q['id'])}, {_sql_str(q.get('correct_answer'))}, {_sql_array(q.get('acceptable_answers', []))}, "
            f"{_sql_str(q.get('explanation', ''))}, "
            f"{_sql_json(q.get('distractor_rationales') or {})}) "
            "ON CONFLICT (question_id) DO UPDATE SET correct_answer = EXCLUDED.correct_answer, "
            "acceptable_answers = EXCLUDED.acceptable_answers, explanation = EXCLUDED.explanation, "
            "distractor_rationales = EXCLUDED.distractor_rationales;"
        )

    lines.append("")
    lines.append("-- flashcards (public study deck; deck_type uses the schema's vocabulary|formula values,")
    lines.append("-- the LaTeX body of a formula card is stored in example_or_application)")
    for card in cards:
        deck_type = "formula" if card["deck"] == "math_formula" else "vocabulary"
        category = (card.get("tags") or ["general"])[0]
        lines.append(
            "INSERT INTO public.flashcards (id, deck_type, category, front_prompt, part_of_speech, "
            "back_definition, example_or_application, synonyms_or_related, source_attribution) VALUES ("
            f"{_sql_str(card['id'])}, {_sql_str(deck_type)}, {_sql_str(category)}, {_sql_str(card['front'])}, "
            "NULL, "
            f"{_sql_str(card['back'])}, {_sql_str(card.get('latex'))}, {_sql_array(card.get('tags', []))}, "
            f"{_sql_str('HDSAT Study Deck (CC-BY-4.0)')}) "
            "ON CONFLICT (id) DO UPDATE SET deck_type = EXCLUDED.deck_type, category = EXCLUDED.category, "
            "front_prompt = EXCLUDED.front_prompt, back_definition = EXCLUDED.back_definition, "
            "example_or_application = EXCLUDED.example_or_application, "
            "synonyms_or_related = EXCLUDED.synonyms_or_related;"
        )

    lines.append("")
    lines.append("COMMIT;")
    lines.append("")
    return "\n".join(lines)


def _write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return len(json.dumps(payload))


def write_outputs(questions, cards, resources):
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(SEED_DIR, exist_ok=True)
    bank = build_client_bank(questions)
    _write_json(os.path.join(DATA_DIR, "questionBank.json"), bank)
    _write_json(
        os.path.join(DATA_DIR, "flashcards.json"),
        {
            "deck_version": BANK_VERSION,
            "generated_at": bank["generated_at"],
            "license": "CC-BY-4.0",
            "attribution": "HDSAT Study Deck (CC-BY-4.0)",
            "vocabulary_source": {
                "file": "supabase/import/data/elevated_vocab_cc0.json",
                "license": "CC0 1.0 (public domain dedication)",
                "name": "A New Word Every Day English corpus",
                "url": "https://github.com/lukefwalton/a-new-word-every-day",
                "note": "Vocabulary entries derived from this CC0-dedicated word list (word, part of speech, definition). Formulas and authored cards are HDSAT original CC-BY-4.0.",
            },
            "cards": cards,
        },
    )
    _write_json(
        os.path.join(DATA_DIR, "resources.json"),
        {"generated_at": bank["generated_at"], "resources": resources},
    )
    seed_path = os.path.join(SEED_DIR, "0001_seed_hdsat.sql")
    with open(seed_path, "w", encoding="utf-8") as handle:
        handle.write(build_seed_sql(questions, cards))
    return {
        "bank": os.path.relpath(os.path.join(DATA_DIR, "questionBank.json"), ROOT),
        "flashcards": os.path.relpath(os.path.join(DATA_DIR, "flashcards.json"), ROOT),
        "resources": os.path.relpath(os.path.join(DATA_DIR, "resources.json"), ROOT),
        "seed_sql": os.path.relpath(seed_path, ROOT),
    }


def load_expansion(base_dir=None):
    """Load the generated bank expansion (original CC-BY-4.0 items produced by
    generate_bank_expansion.py), so full-length adaptive tests are fillable.
    Missing expansion files are tolerated so --check still works in CI."""
    here = base_dir or os.path.dirname(os.path.abspath(__file__))
    exp_dir = os.path.join(here, "expansion")
    questions, cards = [], []
    q_path = os.path.join(exp_dir, "extra_questions.json")
    c_path = os.path.join(exp_dir, "extra_flashcards.json")
    if os.path.exists(q_path):
        with open(q_path, "r", encoding="utf-8") as fh:
            questions = json.load(fh).get("questions", [])
    if os.path.exists(c_path):
        with open(c_path, "r", encoding="utf-8") as fh:
            cards = json.load(fh).get("cards", [])
    return questions, cards


def load_external_file(path):
    """Load additional authorized question records from a JSON or CSV file."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Import file not found: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext == ".json":
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, dict):
            return payload.get("questions", []), payload.get("sources", [])
        if isinstance(payload, list):
            return payload, []
        raise ValueError("JSON import must be a list of questions or an object with 'questions'.")
    if ext == ".csv":
        rows = []
        with open(path, "r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                choices = None
                if (row.get("format") or "multiple_choice") == "multiple_choice":
                    choices = [
                        {"id": letter, "text": row.get(f"choice_{letter}", "").strip()}
                        for letter in LETTERS
                        if row.get(f"choice_{letter}", "").strip()
                    ]
                assessments = [
                    a.strip() for a in (row.get("assessments") or "SAT").split("|") if a.strip()
                ]
                acceptable = [
                    a.strip()
                    for a in (row.get("acceptable_answers") or row.get("correct_answer") or "").split("|")
                    if a.strip()
                ]
                rows.append(
                    {
                        "id": row.get("id", "").strip(),
                        "external_id": row.get("external_id", "").strip() or None,
                        "assessments": assessments,
                        "section": row.get("section", "").strip(),
                        "domain": row.get("domain", "").strip(),
                        "skill": row.get("skill", "").strip(),
                        "difficulty": row.get("difficulty", "").strip(),
                        "format": row.get("format", "multiple_choice").strip(),
                        "stimulus": row.get("stimulus", "").strip() or None,
                        "prompt": row.get("prompt", "").strip(),
                        "choices": choices,
                        "correct_answer": row.get("correct_answer", "").strip(),
                        "acceptable_answers": acceptable,
                        "explanation": row.get("explanation", "").strip(),
                        "distractor_rationales": {},
                        "source_id": row.get("source_id", "hdsat-open-core-2026").strip(),
                    }
                )
        return rows, []
    raise ValueError(f"Unsupported file extension {ext!r}; use .json or .csv")


def main(argv=None):
    parser = argparse.ArgumentParser(description="HDSAT question bank / study deck importer and validator")
    parser.add_argument("--check", action="store_true", help="validate only, do not write output files")
    parser.add_argument("--no-shuffle", action="store_true", help="keep the authored choice order (default shuffles deterministically)")
    parser.add_argument("--file", dest="import_file", help="optional path to an external JSON or CSV question dataset to validate and merge")
    args = parser.parse_args(argv)

    extra_questions, extra_cards = load_expansion()
    authored = [dict(q) for q in QUESTIONS] + [dict(q) for q in extra_questions]
    sources = [dict(s) for s in SOURCES]
    if args.import_file:
        extra_questions, extra_sources = load_external_file(args.import_file)
        existing_sids = {s["source_id"] for s in sources}
        for s in extra_sources:
            if s.get("source_id") not in existing_sids:
                sources.append(s)
                existing_sids.add(s["source_id"])
        by_id = {q["id"]: q for q in authored}
        for q in extra_questions:
            by_id[q.get("id", "")] = q
        authored = list(by_id.values())

    # Keep explicit assessment tags when provided; otherwise default to all
    # assessments, while excluding trigonometry items from PSAT 8/9 per the
    # Digital SAT Suite blueprint.
    ALL_ASSESSMENT_TAGS = ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"]
    NO_89_TAGS = ["SAT", "PSAT/NMSQT", "PSAT 10"]
    for q in authored:
        skill_lower = (q.get("skill") or "").lower()
        is_trig = "trigonometr" in skill_lower or "trig" in skill_lower
        if is_trig:
            q["assessments"] = [a for a in (q.get("assessments") or NO_89_TAGS) if a != "PSAT 8/9"] or list(NO_89_TAGS)
        elif not q.get("assessments"):
            q["assessments"] = list(ALL_ASSESSMENT_TAGS)
        else:
            q["assessments"] = list(ALL_ASSESSMENT_TAGS)

    questions = (
        [dict(q) for q in authored]
        if args.no_shuffle
        else [deterministic_shuffle(q) for q in authored]
    )

    errors, warnings = validate(questions, sources)
    all_cards = list(FLASHCARDS) + [dict(c) for c in extra_cards]
    seen_card_ids = set()
    for c in all_cards:
        if c.get("id") in seen_card_ids:
            errors.append(f"flashcard {c.get('id')}: duplicate id")
        seen_card_ids.add(c.get("id"))
    card_errors = [
        f"flashcard {c.get('id')}: missing front/back"
        for c in all_cards
        if not (c.get("front") or "").strip() or not (c.get("back") or "").strip()
    ]
    resource_errors = [
        f"resource {r.get('id')}: missing url"
        for r in RESOURCES
        if not str(r.get("url", "")).startswith("http")
    ]
    errors = errors + card_errors + resource_errors

    by_section, by_difficulty = {}, {}
    for q in questions:
        by_section[q["section"]] = by_section.get(q["section"], 0) + 1
        by_difficulty[q["difficulty"]] = by_difficulty.get(q["difficulty"], 0) + 1

    print(f"questions        : {len(questions)}")
    print(f"  by section     : {by_section}")
    print(f"  by difficulty  : {by_difficulty}")
    print(f"flashcards       : {len(all_cards)}")
    print(f"resources        : {len(RESOURCES)}")
    print(f"sources          : {len(SOURCES)}")
    if warnings:
        print(f"warnings         : {len(warnings)}")
        for w in warnings:
            print("  ! " + w)
    if errors:
        print(f"ERRORS           : {len(errors)}")
        for e in errors:
            print("  x " + e)
        return 1
    print("validation       : PASS")

    if args.check:
        return 0

    written = write_outputs(questions, all_cards, RESOURCES)
    for label, path in written.items():
        print(f"wrote {label:<16} {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

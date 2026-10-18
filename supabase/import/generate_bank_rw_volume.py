#!/usr/bin/env python3
"""
HDSAT Reading & Writing Volume Generator.

Adds a few hundred ORIGINAL, CC-BY-4.0 Reading & Writing items on top of the
authored + scaled expansion. Each item is written once (no duplicated "series"
copies), uses a single defensible answer, and is validated by
import_questions.py together with the rest of the bank.

Families covered:
  Words in Context, Boundaries, Form/Structure/Sense, Transitions,
  Rhetorical Synthesis, Central Ideas, Inferences, Text Structure/Purpose,
  Cross-Text Connections.

Output: supabase/import/expansion/extra_rw.json
The scale generator merges this file into extra_questions.json.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from generate_bank_expansion import EXP_DIR, mc  # noqa: E402

RW = "Reading and Writing"
D_E, D_M, D_H = "Easy", "Medium", "Hard"

CONTEXTS = [
    ("urban planner", "municipal transit corridors", "commuter foot-traffic surveys"),
    ("marine ecologist", "intertidal kelp canopies", "seasonal nutrient upwellings"),
    ("conservation curator", "iron-gall ink manuscripts", "controlled-humidity display records"),
    ("glaciologist", "subglacial meltwater channels", "radar interferometry transects"),
    ("materials engineer", "ceramic turbine coatings", "high-temperature oxidation trials"),
    ("agricultural botanist", "drought-tolerant millet cultivars", "subsoil moisture readings"),
    ("archival historian", "eighteenth-century guild ledgers", "apprentice wage registries"),
    ("acoustical physicist", "concert-hall diffuser panels", "early-reflection impulse measurements"),
    ("paleoclimate researcher", "varved lake-sediment cores", "annual pollen deposition layers"),
    ("choreographer", "ensemble staging patterns", "rehearsal timing notes"),
    ("hydrologist", "mountain snowpack reserves", "weekly snow-pillow telemetry"),
    ("linguist", "endangered dialect communities", "recorded conversational corpora"),
    ("structural engineer", "long-span footbridges", "vibration damping trials"),
    ("soil scientist", "prairie restoration plots", "root-density core samples"),
    ("astronomer", "variable star light curves", "automated photometry runs"),
    ("epidemiologist", "urban heat and health outcomes", "block-level temperature logs"),
    ("textile conservator", "dyed silk tapestries", "accelerated light-fading tests"),
    ("wildlife biologist", "corridor crossings for small mammals", "motion-trigger camera grids"),
    ("environmental chemist", "roadside stormwater ponds", "monthly contaminant assays"),
    ("musicologist", "nineteenth-century piano rolls", "restored performance recordings"),
    ("volcanologist", "shallow magma reservoirs", "continuous tiltmeter readings"),
    ("ethnographer", "seasonal market towns", "recorded vendor interviews"),
    ("neurobiologist", "songbird vocal learning", "multi-electrode recordings"),
    ("forest ecologist", "old-growth understory plots", "decadal seedling censuses"),
    ("cartographer", "coastal wetland boundaries", "drone photogrammetry surveys"),
    ("pharmacologist", "slow-release tablet coatings", "dissolution-profile assays"),
    ("geotechnical engineer", "expansive clay subsoils", "seasonal settlement readings"),
    ("oceanographer", "continental shelf currents", "moored acoustic doppler profiles"),
    ("archaeologist", "waterlogged timber structures", "dendrochronology samples"),
    ("aeronautical engineer", "low-speed wing sections", "wind-tunnel pressure maps"),
    ("microbiologist", "anaerobic sediment communities", "metagenomic sequencing runs"),
    ("urban historian", "streetcar-era commercial strips", "municipal building permits"),
    ("audiologist", "age-related hearing decline", "extended high-frequency audiograms"),
    ("meteorologist", "convective storm initiation", "radiosonde launch records"),
    ("conservation geneticist", "isolated amphibian populations", "microsatellite markers"),
]

WIC_TEMPLATES = [
    (D_E, "augment", ["curtail", "displace", "invalidate"],
     "Rather than replace the existing dataset on {topic}, the {role} used {evidence} to ______ it, adding three new measurements while preserving every earlier record.",
     "add to something in a way that increases it"),
    (D_E, "temper", ["intensify", "confirm", "publicize"],
     "The first results looked decisive, but a second season of {evidence} forced the {role} to ______ the team's initial enthusiasm, describing the effect as real yet far smaller than first reported.",
     "moderate or soften something"),
    (D_E, "codify", ["scatter", "abandon", "conceal"],
     "Working with {topic}, the {role} spent two years ______ a loose collection of local conventions into one written standard that any new technician could follow.",
     "organize rules into a clear system"),
    (D_M, "presage", ["mirror", "reverse", "conceal"],
     "A sharp drop in {evidence} may ______ a much wider shift in {topic}; similar early signals preceded every major reorganization of the field.",
     "indicate something before it happens"),
    (D_M, "supplant", ["supplement", "imitate", "restore"],
     "Within a decade, the method described in {evidence} had almost entirely ______ the older practice used to study {topic}, which survives today only in a few teaching laboratories.",
     "replace something, especially an older practice"),
    (D_M, "reconcile", ["magnify", "ignore", "duplicate"],
     "At first the two datasets on {topic} appeared contradictory, but the {role} managed to ______ them by showing that {evidence} had been recorded on a different seasonal schedule.",
     "make two apparently conflicting things consistent"),
    (D_M, "circumvent", ["enforce", "obey", "document"],
     "When budget rules blocked direct purchases of equipment for {topic}, the {role} ______ the restriction by borrowing instruments already owned by a neighboring department.",
     "find a way around an obstacle or rule"),
    (D_H, "extol", ["deride", "doubt", "outline"],
     "Even after later studies revealed its limits, senior researchers continued to ______ the method's early precision, citing {evidence} in nearly every review.",
     "praise something enthusiastically"),
    (D_H, "deprecate", ["celebrate", "codify", "translate"],
     "In the following decades, historians would ______ the assumption that {topic} could be explained by a single variable, calling it an oversimplification that {evidence} had already undermined.",
     "express disapproval of something"),
    (D_H, "tenuous", ["robust", "explicit", "reciprocal"],
     "The proposed link between {topic} and the patterns in {evidence} remained ______, resting on one small sample that no later team could reproduce.",
     "weak or fragile; not securely established"),
    (D_H, "intractable", ["trivial", "reversible", "decorative"],
     "The central problem in {topic} proved ______: each adjustment to {evidence} corrected one discrepancy while creating two others.",
     "very difficult to solve or control"),
    (D_H, "perfunctory", ["exhaustive", "meticulous", "deliberate"],
     "Reviewers described the audit of {topic} as ______, noting that it checked the first page of every file but never examined {evidence}.",
     "done quickly and without real care"),
]


def gen_wic_volume():
    items = []
    for ci, (role, topic, evidence) in enumerate(CONTEXTS):
        for ti, (diff, correct, wrongs, tpl, gloss) in enumerate(WIC_TEMPLATES):
            stim = tpl.format(role=role, topic=topic, evidence=evidence)
            items.append(mc(
                f"RW-CRF-9{ci:02d}{ti:02d}",
                RW, "Craft and Structure", "Words in Context", diff,
                stim,
                "Which choice completes the text with the most logical and precise word or phrase?",
                correct, wrongs,
                f"In context, '{correct}' means {gloss}, which is exactly what the sentence's clue about {evidence} requires.",
                [
                    f"'{w}' does not match the clue: the sentence needs a word meaning {gloss}, not {w}."
                    for w in wrongs
                ],
            ))
    return items


# ---------------------------------------------------------------------------
# Boundaries: one blank, four punctuation choices.
# ---------------------------------------------------------------------------
BOUNDARY_ITEMS = [
    # Semicolon between independent clauses
    ("The first survey recorded water loss along the upper canal ______ the second survey measured the same cross-sections after the diversion gates were replaced.",
     ";", [",", ":", "—"],
     "Two independent clauses need a semicolon (or a period) when no conjunction joins them."),
    ("The archive closed early on Fridays ______ researchers learned to schedule their visits for the morning.",
     ";", [",", ":", "—"],
     "Both halves can stand alone as sentences, so a semicolon is required."),
    ("The prototype passed every vibration test ______ it nevertheless failed when the chamber pressure dropped below ambient.",
     ";", [",", ":", "—"],
     "A comma would create a run-on between two independent clauses."),
    ("The field station lost power for six hours ______ the backup generator kept the freezers running.",
     ";", [",", ":", "—"],
     "The two clauses are independent, so a semicolon marks the boundary."),
    ("Most participants preferred the shorter route ______ a few chose the ridge trail for its view.",
     ";", [",", ":", "—"],
     "The second clause is independent; a semicolon is the standard separator."),
    ("The clay hardened faster than expected ______ the potter adjusted the drying schedule for the next batch.",
     ";", [",", ":", "—"],
     "Without a coordinating conjunction, two independent clauses need a semicolon."),

    # Colon introducing an explanation or list
    ("The expedition carried only the essentials ______ dried food, a water filter, and two repair kits.",
     ":", [";", ",", "—"],
     "A colon introduces the list that explains 'the essentials'."),
    ("The study reached an unexpected conclusion ______ the oldest trees were also the most sensitive to drought.",
     ":", [";", ",", "—"],
     "The clause after the blank explains the conclusion, so a colon is appropriate."),
    ("The museum's policy addressed three concerns ______ conservation, security, and public access.",
     ":", [";", ",", "—"],
     "A colon introduces the list that follows the general statement."),
    ("One detail troubled the reviewers ______ the sample size had never been reported.",
     ":", [";", ",", "—"],
     "The second half specifies the detail, which a colon introduces."),
    ("The recipe depends on a single step ______ the dough must rest overnight.",
     ":", [";", ",", "—"],
     "A colon introduces the specific step that explains the general claim."),
    ("The report identified two causes ______ poor drainage and compacted soil.",
     ":", [";", ",", "—"],
     "The list of causes is introduced by a colon."),

    # Comma after an introductory dependent clause
    ("After the river crested ______ volunteers reinforced the lower embankment.",
     ",", [";", ":", "—"],
     "An introductory dependent clause is followed by a comma."),
    ("Because the samples had thawed ______ the team repeated the assay.",
     ",", [";", ":", "—"],
     "The introductory clause ends with a comma before the main clause."),
    ("When the sensor array rebooted ______ the dashboard showed a week of missing readings.",
     ",", [";", ":", "—"],
     "A comma separates the introductory clause from the main clause."),
    ("Although the trail was marked ______ hikers still missed the turn after dusk.",
     ",", [";", ":", "—"],
     "The concessive introductory clause takes a comma before the main clause."),
    ("If the humidity rises above sixty percent ______ the display cases seal automatically.",
     ",", [";", ":", "—"],
     "An introductory conditional clause is followed by a comma."),
    ("As the last bell rang ______ the students filed into the courtyard.",
     ",", [";", ":", "—"],
     "The introductory temporal clause is set off with a comma."),

    # No comma between subject and verb
    ("The collection of field notes ______ stored in the basement archive.",
     "(no punctuation)", [",", ";", ":"],
     "A comma must not separate a subject from its verb, even when the subject has a long modifier."),
    ("The panel of outside reviewers ______ the proposal over two days.",
     "(no punctuation)", [",", ";", ":"],
     "The verb follows the complete subject directly; punctuation here would be an error."),
    ("The set of calibration slides ______ needs to be replaced each semester.",
     "(no punctuation)", [",", ";", ":"],
     "No mark belongs between the subject 'set' and its verb."),
    ("A series of small tremors ______ recorded before the eruption.",
     "(no punctuation)", [",", ";", ":"],
     "The intervening phrase does not license a comma before the verb."),
    ("The catalog of regional dialects ______ expanded by two hundred entries.",
     "(no punctuation)", [",", ";", ":"],
     "The subject and verb must remain unseparated."),
    ("The range of possible answers ______ narrowed after the second trial.",
     "(no punctuation)", [",", ";", ":"],
     "A comma between subject and verb would break the sentence."),

    # Comma before a coordinating conjunction joining independent clauses
    ("The archive had already closed ______ the courier left the package with the night guard.",
     ", but", ["but", "; but", ": but"],
     "A comma precedes a coordinating conjunction that joins two independent clauses."),
    ("The first model was cheap to build ______ it could not survive a cold night.",
     ", but", ["but", "; but", ": but"],
     "The comma plus conjunction correctly separates two independent clauses."),
    ("The trail was short ______ it climbed more than a thousand feet.",
     ", yet", ["yet", "; yet", ": yet"],
     "A comma is required before 'yet' when it joins two independent clauses."),
    ("The lab had enough reagent ______ the centrifuge was still broken.",
     ", but", ["but", "; but", ": but"],
     "Two independent clauses joined by 'but' take a preceding comma."),
    ("The lecture ended early ______ the audience stayed to ask questions.",
     ", so", ["so", "; so", ": so"],
     "The coordinating conjunction 'so' needs a comma before it in this sentence."),
    ("The river had dropped ______ the bridge remained closed for inspection.",
     ", yet", ["yet", "; yet", ": yet"],
     "A comma before 'yet' separates the two independent clauses."),

    # Dash before a summarizing appositive
    ("Only one thing could explain the results ______ the sensors had been calibrated in the wrong units.",
     "—", [":", ";", ","],
     "A dash can introduce a summary or afterthought, mirroring a colon."),
    ("The team needed one more thing before publishing ______ a second reader.",
     "—", [":", ";", ","],
     "The dash introduces the clarifying item at the end of the sentence."),
    ("They had overlooked the obvious cause ______ a loose cable.",
     "—", [":", ";", ","],
     "An emphatic dash introduces the appositive that names the cause."),
    ("The plan rested on a single assumption ______ that demand would stay flat.",
     "—", [":", ";", ","],
     "A dash introduces the assumption that the plan depends on."),
    ("The evidence pointed to one conclusion ______ the earlier result was an artifact.",
     "—", [":", ";", ","],
     "The dash sets off the summarizing conclusion."),
    ("There was only one obstacle left ______ the missing permit.",
     "—", [":", ";", ","],
     "The dash introduces the final, explanatory noun phrase."),
]


def gen_boundaries_volume():
    items = []
    for idx, (stim, correct, wrongs, why) in enumerate(BOUNDARY_ITEMS):
        items.append(mc(
            f"RW-SEC-9{idx:03d}",
            RW, "Standard English Conventions", "Boundaries", D_M if idx % 3 else D_E,
            stim,
            "Which choice completes the text so that it conforms to the conventions of Standard English?",
            correct, wrongs,
            why,
            [
                "This mark would create a run-on, a comma splice, or an unnecessary break in the sentence."
                for _ in wrongs
            ],
        ))
    return items


# ---------------------------------------------------------------------------
# Form, Structure, and Sense
# ---------------------------------------------------------------------------
FSS_ITEMS = [
    ("The collection of water samples ______ stored in a climate-controlled cabinet.",
     "was", ["were", "have been", "are"],
     "The subject is the singular noun 'collection'; the intervening phrase 'of water samples' does not change the verb."),
    ("The series of lectures ______ scheduled for the spring term.",
     "is", ["are", "were", "have been"],
     "The head noun 'series' is singular, so the verb must be singular."),
    ("The bundle of maps ______ catalogued before the exhibit opened.",
     "was", ["were", "have been", "are"],
     "The head noun 'bundle' is singular; the plural 'maps' is part of a prepositional phrase."),
    ("The archive of local records ______ fragile enough to require gloves.",
     "is", ["are", "were", "have been"],
     "'Archive', not 'records', is the subject of the verb."),
    ("The range of acceptable temperatures ______ narrower than the manual suggests.",
     "is", ["are", "were", "have been"],
     "The singular 'range' governs the verb."),
    ("The catalogue of regional dialects ______ two hundred entries.",
     "contains", ["contain", "have contained", "are containing"],
     "The singular subject 'catalogue' takes the singular verb 'contains'."),

    ("Each of the instruments ______ calibrated before every session.",
     "was", ["were", "have been", "are"],
     "'Each' is singular even when followed by a plural noun."),
    ("Every one of the samples ______ labelled twice.",
     "was", ["were", "have been", "are"],
     "'Every one' is the singular subject."),
    ("Neither of the two proposals ______ enough detail to evaluate.",
     "offers", ["offer", "have offered", "are offering"],
     "'Neither' is singular in formal standard English."),
    ("Each of the participants ______ a consent form before the study began.",
     "signed", ["sign", "have signed", "are signing"],
     "The singular 'each' requires the singular verb 'signed'."),
    ("One of the oldest manuscripts ______ still legible.",
     "is", ["are", "were", "have been"],
     "The subject is 'one', not 'manuscripts'."),
    ("Every dataset in the archive ______ a unique identifier.",
     "has", ["have", "are having", "were having"],
     "'Every dataset' is singular."),

    ("Each laboratory ______ its own calibration protocol.",
     "maintains", ["maintain", "have maintained", "are maintaining"],
     "A singular indefinite pronoun takes a singular verb and a singular possessive."),
    ("Neither department ______ budget was approved on time.",
     "its", ["their", "they're", "there"],
     "The singular 'neither department' takes the singular possessive 'its'."),
    ("Every school in the district revised ______ science curriculum.",
     "its", ["their", "they're", "there"],
     "'Every school' is singular, so 'its' agrees with it."),
    ("One of the authors revised ______ chapter after the review.",
     "his or her", ["their", "they're", "there"],
     "Formal agreement with the singular 'one' calls for 'his or her'."),
    ("Each player on the team submitted ______ own equipment request.",
     "his or her", ["their", "they're", "there"],
     "The singular 'each player' requires a singular possessive."),
    ("The committee released ______ final report in June.",
     "its", ["their", "they're", "there"],
     "'Committee' is a collective noun acting as a single unit, so 'its' is correct."),

    ("By the time the team arrived, the technician ______ every slide.",
     "had already labelled", ["has already labelled", "already labels", "will already label"],
     "The past perfect marks an action completed before another past action."),
    ("When the storm finally passed, the crew ______ for twelve hours.",
     "had been working", ["has been working", "is working", "will be working"],
     "Past perfect progressive shows duration up to a point in the past."),
    ("Before the policy changed, researchers ______ to request access in writing.",
     "had had", ["have had", "has had", "are having"],
     "The earlier obligation requires the past perfect 'had had'."),
    ("By the end of the decade, the survey ______ more than a thousand sites.",
     "had covered", ["has covered", "covers", "will cover"],
     "The past perfect places the completed survey before the stated endpoint."),
    ("The reviewer realized that she ______ the same error twice.",
     "had made", ["has made", "makes", "will make"],
     "The error occurred before the realization, so the past perfect is required."),
    ("Until the audit, no one ______ the discrepancy.",
     "had noticed", ["has noticed", "notices", "will notice"],
     "The past perfect marks the state before the audit."),

    ("Calibrated in a vacuum chamber, ______ required a second check.",
     "the mirrors", ["the technicians", "the schedule", "the procedure"],
     "The introductory participle must modify the noun that was calibrated: the mirrors."),
    ("Having reviewed the data twice, ______.",
     "the analyst revised the conclusion", ["the conclusion was revised", "the data were revised", "revising the conclusion"],
     "The participle must modify the person who reviewed the data."),
    ("Written in haste, ______ contained several errors.",
     "the report", ["the editor", "the reviewer", "the deadline"],
     "The phrase modifies the thing that was written: the report."),
    ("Trained on regional specimens, ______ identified the unknown sample quickly.",
     "the botanist", ["the sample", "the greenhouse", "the identification"],
     "The participle must modify the person who was trained."),
    ("Exposed to direct sunlight, ______ faded within a month.",
     "the pigment", ["the curator", "the gallery", "the lighting"],
     "The phrase modifies the pigment that was exposed."),
    ("Sealed in an airtight case, ______ remained stable for decades.",
     "the manuscript", ["the archivist", "the museum", "the humidity"],
     "The participle modifies the manuscript that was sealed."),

    ("The program asks students to collect samples, record measurements, and ______ the results.",
     "analyse", ["analysis of", "to analyse", "analysing"],
     "The list of infinitives must stay parallel: collect, record, analyse."),
    ("The role requires patience, accuracy, and ______.",
     "attention to detail", ["attentive", "to attend", "attending"],
     "The list joins three nouns, so the final item must be a noun phrase."),
    ("The workshop teaches participants to frame questions, gather evidence, and ______ conclusions.",
     "draw", ["drawing", "to draw", "drawn"],
     "Three parallel infinitives: frame, gather, draw."),
    ("The report was clear, concise, and ______.",
     "well organized", ["organization", "to organize", "organizing"],
     "The adjectives must stay parallel after 'clear' and 'concise'."),
    ("The team valued speed, precision, and ______.",
     "reliability", ["reliable", "to rely", "relying"],
     "The list requires a third noun."),
    ("The plan called for surveying the site, mapping the drainage, and ______ the results.",
     "publishing", ["to publish", "publication", "published"],
     "The gerunds must stay parallel: surveying, mapping, publishing."),

    ("The ______ conclusions were published in a regional journal.",
     "researchers'", ["researcher's", "researchers", "researchers's"],
     "A plural possessive takes the apostrophe after the final s."),
    ("The ______ equipment was stored in the annex.",
     "students'", ["student's", "students", "students's"],
     "The plural possessive 'students'' modifies 'equipment'."),
    ("The ______ findings surprised the review panel.",
     "committee's", ["committees'", "committee", "committees"],
     "A singular possessive takes 's after the noun."),
    ("Each ______ schedule was posted by Friday.",
     "employee's", ["employees", "employees'", "employees's"],
     "The singular 'each employee' takes a singular possessive."),
    ("The ______ reports were filed separately.",
     "departments'", ["department's", "departments", "departments's"],
     "Several departments share the reports, so the plural possessive is correct."),
    ("The ______ first draft was never recovered.",
     "author's", ["authors", "authors'", "authors's"],
     "One author's draft requires the singular possessive."),

    ("The new procedure uses ______ energy than the old one.",
     "less", ["fewer", "lesser", "least"],
     "Energy is a mass noun, so 'less' is correct."),
    ("The revised schedule has ______ steps than the original.",
     "fewer", ["less", "lesser", "least"],
     "Steps are countable, so 'fewer' is correct."),
    ("The second trial produced ______ errors than the first.",
     "fewer", ["less", "lesser", "least"],
     "'Errors' is countable, so 'fewer' is required."),
    ("The new lamp consumes ______ electricity than the old fixture.",
     "less", ["fewer", "lesser", "least"],
     "Electricity is not countable item by item, so 'less' is correct."),
    ("There were ______ applicants this year than last year.",
     "fewer", ["less", "lesser", "least"],
     "Applicants are countable, so 'fewer' is required."),
    ("The archive holds ______ material than the catalogue suggests.",
     "less", ["fewer", "lesser", "least"],
     "'Material' is a mass noun here, so 'less' is correct."),
]


def gen_form_volume():
    items = []
    for idx, (stim, correct, wrongs, why) in enumerate(FSS_ITEMS):
        diff = D_E if idx % 3 == 0 else D_M if idx % 3 == 1 else D_H
        items.append(mc(
            f"RW-SEC-9{1000 + idx:04d}",
            RW, "Standard English Conventions", "Form, Structure, and Sense", diff,
            stim,
            "Which choice completes the text so that it conforms to the conventions of Standard English?",
            correct, wrongs, why,
            ["This option violates agreement, tense, parallelism, or modifier placement in this sentence." for _ in wrongs],
        ))
    return items


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------
TRANSITION_GROUPS = [
    ("However", ["Therefore", "Similarly", "For example"], "contrast",
     "The second sentence contradicts or qualifies the first, so a contrast transition is needed."),
    ("Therefore", ["However", "Meanwhile", "For instance"], "cause and effect",
     "The second sentence follows as a result of the first, which calls for a cause-and-effect transition."),
    ("Similarly", ["Nevertheless", "Consequently", "In contrast"], "comparison",
     "The second sentence presents a comparable case, so a comparison transition fits."),
    ("For example", ["However", "Therefore", "Instead"], "illustration",
     "The second sentence gives a specific instance of the first claim, which calls for illustration."),
    ("Nevertheless", ["Therefore", "Likewise", "First"], "concession",
     "The second sentence concedes a contrast while maintaining the first point, which 'Nevertheless' signals."),
    ("In contrast", ["Similarly", "Therefore", "Finally"], "direct opposition",
     "The two sentences describe opposing outcomes, so a contrast transition is needed."),
]

TRANSITION_PAIRS = [
    ("The first trial showed a steady decline in soil moisture.",
     "the second trial recorded almost no change over the same period."),
    ("The museum extended its weekend hours.",
     "attendance rose by nearly a third within a month."),
    ("The older algorithm required hours of calibration.",
     "the newer version performs the same task in minutes."),
    ("The city planted drought-resistant trees along the avenue.",
     "several nearby districts have begun similar plantings."),
    ("The survey found that most students preferred printed texts.",
     "one participant described reading on paper as easier to annotate."),
    ("The first prototype failed under cold conditions.",
     "the revised model operated reliably below freezing."),
]


def gen_transitions_volume():
    items = []
    for gi, (correct, wrongs, label, why) in enumerate(TRANSITION_GROUPS):
        for pi, (first, second) in enumerate(TRANSITION_PAIRS):
            diff = D_E if pi < 2 else D_M if pi < 4 else D_H
            stim = f"{first} ______, {second}"
            items.append(mc(
                f"RW-EOI-9{gi}{pi}",
                RW, "Expression of Ideas", "Transitions", diff,
                stim,
                "Which choice completes the text with the most logical transition?",
                correct, wrongs,
                why,
                [f"'{w}' signals a different relationship ({label} is what the sentences actually show)." for w in wrongs],
            ))
    return items


# ---------------------------------------------------------------------------
# Rhetorical Synthesis
# ---------------------------------------------------------------------------
SYNTHESIS_ITEMS = [
    (["A 2024 census found 312 nesting pairs of least terns on the restored spit.",
      "The spit was rebuilt with dredged sand in 2019.",
      "Tern numbers on unrestored beaches nearby fell by 9 percent.",
      "The restoration cost $2.4 million."],
     "The student wants to emphasize the effect of the restoration on tern numbers.",
     "After the spit was rebuilt with dredged sand in 2019, the site hosted 312 nesting pairs of least terns, while nearby unrestored beaches lost 9 percent of their pairs.",
     ["The restoration cost $2.4 million and involved dredged sand.",
      "Least terns nest on beaches and are monitored by volunteers.",
      "The 2024 census counted nesting pairs on several beaches."]),
    (["The library's evening program began in March.",
      "Attendance averaged 46 people per session.",
      "The program offers childcare during talks.",
      "Two nearby libraries have asked to copy the format."],
     "The student wants to show that the program attracted interest beyond its own branch.",
     "Two nearby libraries have asked to copy the format after the evening program averaged 46 attendees per session.",
     ["The program began in March and offers childcare.",
      "Attendance at library programs varies by season.",
      "The library runs several programs for families."]),
    (["A pilot program gave commuters free bus transfers for six months.",
      "Ridership on connecting routes rose 18 percent.",
      "The program cost $900,000.",
      "Surveys found 71 percent of riders wanted it continued."],
     "The student wants to highlight rider support for continuing the program.",
     "In surveys, 71 percent of riders said they wanted the free-transfer program continued after ridership on connecting routes rose 18 percent.",
     ["The pilot program lasted six months.",
      "The program cost $900,000 to operate.",
      "Connecting routes serve several neighborhoods."]),
    (["Researchers tested a new insulation in 12 homes.",
      "Heating bills fell by an average of 22 percent.",
      "Installation took one day per home.",
      "The material is made from recycled denim."],
     "The student wants to emphasize the financial benefit for households.",
     "In the 12 homes tested, the new insulation cut heating bills by an average of 22 percent.",
     ["The insulation is made from recycled denim.",
      "Installation took one day per home.",
      "The study included homes of different sizes."]),
    (["A trail crew rebuilt 3.2 miles of switchbacks.",
      "Erosion complaints dropped from 41 to 6 in one season.",
      "The crew worked with volunteer students.",
      "The project was completed in August."],
     "The student wants to emphasize the reduction in erosion complaints.",
     "After the crew rebuilt 3.2 miles of switchbacks, erosion complaints fell from 41 to 6 in a single season.",
     ["The project was completed in August.",
      "Volunteer students joined the trail crew.",
      "The trail crosses a popular ridge."]),
    (["The museum digitized 8,000 photographs.",
      "Requests for reproductions doubled.",
      "The archive is now searchable by date.",
      "Digitization took 14 months."],
     "The student wants to emphasize the increase in demand for reproductions.",
     "After 8,000 photographs were digitized, requests for reproductions doubled.",
     ["Digitization took 14 months.",
      "The archive can now be searched by date.",
      "The museum holds a large photography collection."]),
    (["A school swapped late starts for a 25-minute morning reading block.",
      "Reading scores rose 7 points.",
      "Teachers reported calmer mornings.",
      "The change affected 640 students."],
     "The student wants to emphasize the improvement in reading scores.",
     "After the school added a 25-minute morning reading block, reading scores rose 7 points across 640 students.",
     ["Teachers reported calmer mornings.",
      "The school previously used late starts.",
      "The reading block lasts 25 minutes."]),
    (["A coastal town installed 40 permeable parking spaces.",
      "Flooding on the adjacent street fell by 30 percent.",
      "The spaces cost less than conventional paving.",
      "Installation finished before the rainy season."],
     "The student wants to emphasize the reduction in street flooding.",
     "Installing 40 permeable parking spaces cut flooding on the adjacent street by 30 percent.",
     ["The spaces cost less than conventional paving.",
      "Installation finished before the rainy season.",
      "The town operates several parking areas."]),
    (["A food bank added weekend distribution.",
      "Weekend visits rose from 90 to 260 families.",
      "The bank recruited 35 new volunteers.",
      "The change began in January."],
     "The student wants to emphasize the growth in weekend use.",
     "After weekend distribution was added, visits rose from 90 to 260 families.",
     ["The bank recruited 35 new volunteers.",
      "The change began in January.",
      "The food bank serves the whole county."]),
    (["An orchestra began offering free ticket lotteries.",
      "Under-30 attendance rose from 12 to 31 percent.",
      "The lottery runs two hours before each concert.",
      "The orchestra performs 24 concerts a season."],
     "The student wants to emphasize the change in younger audience attendance.",
     "Free ticket lotteries raised under-30 attendance from 12 to 31 percent.",
     ["The orchestra performs 24 concerts a season.",
      "The lottery opens two hours before each concert.",
      "The orchestra has several ticket programs."]),
]


def gen_rhetorical_volume():
    items = []
    for idx, (notes, goal, correct, wrongs) in enumerate(SYNTHESIS_ITEMS):
        bullets = "\n".join(f"• {note}" for note in notes)
        stim = f"While researching a topic, a student has taken the following notes:\n{bullets}"
        prompt = f"{goal}\n\nWhich choice most effectively uses relevant information from the notes to accomplish this goal?"
        items.append(mc(
            f"RW-EOI-9{100 + idx:04d}",
            RW, "Expression of Ideas", "Rhetorical Synthesis", D_M if idx % 2 else D_E,
            stim, prompt, correct, wrongs,
            f"The correct choice uses the note that directly serves the stated goal; the other options describe related details without answering it.",
            ["This option includes accurate details but does not accomplish the stated goal." for _ in wrongs],
        ))
    return items


# ---------------------------------------------------------------------------
# Central Ideas and Details
# ---------------------------------------------------------------------------
CID_PASSAGES = [
    ("In the 1890s, Chicago engineers reversed the flow of the Chicago River to keep sewage out of the city's drinking-water intake. The project required digging a 28-mile canal and lifting water with enormous pumps. Within a decade, typhoid deaths had fallen sharply, but the diverted sewage fouled downstream towns, which sued the city.",
     "Reversing the river improved Chicago's water quality while creating a pollution problem for downstream communities.",
     ["Chicago abandoned the canal project after a decade of lawsuits.",
      "Typhoid deaths rose after the river was reversed.",
      "The river reversal required no mechanical pumping."]),
    ("Bamboo grows faster than almost any other plant, which makes it attractive as a building material. However, untreated bamboo is vulnerable to insects and moisture. Engineers now treat bamboo with borax solutions and laminate strips under pressure, producing panels strong enough for structural walls.",
     "Treating and laminating bamboo turns a fast-growing plant into a durable structural material.",
     ["Bamboo grows more slowly than timber species used in construction.",
      "Untreated bamboo is stronger than laminated bamboo panels.",
      "Borax treatment makes bamboo unsuitable for building."]),
    ("Some desert ants navigate by counting their steps. Researchers glued stilts to ants' legs, making their strides longer; the ants overshot the nest on the return trip. Ants with shortened legs undershot it. The results supported the idea that the insects integrate distance from a step counter.",
     "Experiments with altered leg length showed that desert ants estimate distance by counting steps.",
     ["Desert ants navigate entirely by following scent trails.",
      "Ants with longer legs returned to the nest more accurately.",
      "The experiments showed that ants cannot estimate distance at all."]),
    ("The first public libraries in many American towns were funded by private donors who required matching municipal support. The requirement doubled the cost to local governments, but it also gave towns a financial stake in the libraries' success. By 1900, more than a thousand such libraries operated.",
     "Private donations combined with matching public funds helped establish lasting public libraries.",
     ["Private donors paid the entire cost of early public libraries.",
      "Towns without matching funds built the largest libraries.",
      "Public libraries declined after 1900."]),
    ("Migratory birds use Earth's magnetic field, the position of the sun, and familiar landmarks. When researchers disrupted one cue at a time, the birds compensated using the others. Only when two cues were removed at once did the birds lose their bearings.",
     "Migratory birds rely on multiple navigation cues that can substitute for one another.",
     ["Birds navigate using a single, dominant cue.",
      "Disrupting the magnetic field completely prevents migration.",
      "Landmarks are irrelevant to migratory birds."]),
    ("Roman roads were built in layers: a foundation of large stones, a middle layer of gravel, and a surface of fitted paving blocks. The layered design spread the weight of carts and shed water quickly, which is why some routes remained usable for centuries.",
     "The layered construction of Roman roads made them durable and long-lasting.",
     ["Roman roads were built from a single layer of paving blocks.",
      "Roman roads were abandoned because they trapped water.",
      "The surface layer carried most of the structural load."]),
    ("When wolves were reintroduced to Yellowstone in 1995, elk behavior changed: they avoided open valleys where they were vulnerable. Willow and aspen regrew along streams, and beaver populations increased. Researchers caution that other factors, including drought and hunting, also shaped the recovery.",
     "Wolf reintroduction contributed to vegetation recovery, though other factors also played a role.",
     ["Wolf reintroduction was the only cause of vegetation recovery.",
      "Elk populations increased immediately after wolves returned.",
      "Beaver populations declined after willows regrew."]),
    ("The invention of the shipping container in the 1950s reduced the cost of loading cargo by more than 90 percent. Ports that adopted container handling grew rapidly, while older docks that could not accommodate the new cranes declined.",
     "Container shipping sharply lowered cargo costs and reshaped which ports prospered.",
     ["Container shipping increased the cost of loading cargo.",
      "Older docks grew faster than container ports.",
      "The container was invented in the nineteenth century."]),
]


def gen_cid_volume():
    items = []
    qid = 0
    for passage, main, wrongs in CID_PASSAGES:
        for prompt, correct in [
            ("Which choice best states the main idea of the text?", main),
            ("Which choice best describes a detail that supports the main idea?", main),
        ]:
            qid += 1
            items.append(mc(
                f"RW-INF-9{qid:04d}",
                RW, "Information and Ideas", "Central Ideas and Details",
                D_E if qid % 3 == 1 else D_M if qid % 3 == 2 else D_H,
                passage, prompt, correct, wrongs,
                f"The passage's central claim is that {main[0].lower() + main[1:]}",
                ["This statement is not supported by the passage." for _ in wrongs],
            ))
    return items


# ---------------------------------------------------------------------------
# Inferences
# ---------------------------------------------------------------------------
INFERENCE_ITEMS = [
    ("A greenhouse study found that tomato plants grown with a fungal partner absorbed 30 percent more phosphorus than plants grown alone, even when both groups received identical fertilizer.",
     "the fungal partner helped the plants take up more phosphorus from the same amount of fertilizer",
     ["tomato plants cannot grow without added fertilizer",
      "the fungal partner reduced the plants' need for water",
      "fertilizer application decreased phosphorus uptake"]),
    ("In a library survey, visitors who used the quiet reading room stayed an average of 70 minutes, while visitors in the lobby stayed 25 minutes. The lobby has no seating near outlets.",
     "access to seating and power may lengthen visits more than quiet does",
     ["visitors disliked the library's book collection",
      "the reading room was closed during the survey",
      "visitors who stayed longer read more books"]),
    ("A bakery began labeling loaves with the time they were baked. Sales of day-old bread fell, but total bread sales rose slightly.",
     "customers preferred fresher loaves but still bought bread when only day-old loaves remained",
     ["customers stopped buying bread entirely",
      "the bakery raised prices on fresh loaves",
      "day-old bread was more popular than fresh bread"]),
    ("A city replaced 200 parking meters with a mobile payment app. Revenue rose 12 percent, and the number of parking tickets fell.",
     "the app made it easier to pay, increasing compliance",
     ["drivers stopped parking downtown",
      "the city reduced parking enforcement staff",
      "meter rates were lowered significantly"]),
    ("Researchers recorded bird calls at 40 sites. Sites near highways had calls with higher minimum frequencies than quiet rural sites.",
     "traffic noise may favor birds whose calls are pitched above the low rumble",
     ["highways attract birds with deeper calls",
      "rural birds sing less often than city birds",
      "traffic noise has no effect on bird communication"]),
    ("A museum moved its most fragile textiles to a gallery with dimmer lighting. Fading rates measured over two years fell by half.",
     "light exposure is a major cause of the textiles' fading",
     ["the textiles were damaged by visitors touching them",
      "the new gallery had higher humidity",
      "fading is unrelated to lighting"]),
    ("A farm planted a cover crop between cash-crop seasons. The following season's soil held more moisture and needed less irrigation.",
     "the cover crop improved the soil's ability to retain water",
     ["the cover crop consumed all available soil moisture",
      "irrigation was unnecessary in that region",
      "cash-crop yields fell after cover cropping"]),
    ("A school replaced its vending machines with a water station. Students reported drinking more water, and visits to the nurse for headaches fell.",
     "easier access to water may have reduced dehydration-related headaches",
     ["students preferred sugary drinks to water",
      "the water station was rarely used",
      "headaches increased after the change"]),
]


def gen_inference_volume():
    items = []
    for idx, (premise, corr, wrongs) in enumerate(INFERENCE_ITEMS):
        stim = f"{premise} Taken together, the evidence implies that ______"
        items.append(mc(
            f"RW-INF-9{500 + idx:04d}",
            RW, "Information and Ideas", "Inferences",
            D_E if idx % 3 == 0 else D_M if idx % 3 == 1 else D_H,
            stim,
            "Which choice most logically completes the text?",
            corr, wrongs,
            f"The evidence contrasts two conditions and their outcomes; '{corr}' accounts for both without adding unsupported claims.",
            ["This conclusion goes beyond or contradicts the evidence in the passage." for _ in wrongs],
        ))
    return items


# ---------------------------------------------------------------------------
# Text Structure and Purpose
# ---------------------------------------------------------------------------
TSP_ITEMS = [
    ("Some historians assume that medieval towns grew only where rivers made transport easy. Yet excavations at upland settlements show dense craft production and long-distance imports, suggesting that overland routes and seasonal markets mattered far more than the river map implies.",
     "It introduces a common assumption and then presents evidence that challenges it.",
     ["It lists the stages of a process in chronological order.",
      "It compares two historians and argues that both are mistaken.",
      "It defines a term and then gives a fictional illustration."]),
    ("To measure how quickly a new pavement drains, engineers pour a known volume of water onto a test patch and time how long the surface takes to clear. The procedure is repeated after simulated traffic wear so that the results reflect conditions months after installation.",
     "It explains a measurement procedure and why it is repeated.",
     ["It argues that the new pavement is unnecessary.",
      "It describes the history of road construction.",
      "It compares two cities' drainage systems."]),
    ("For decades, seed banks focused on storing crops that farmers already grew. More recently, collectors have begun preserving wild relatives of those crops, whose genes may confer resistance to heat or disease that cultivated varieties lack.",
     "It contrasts an earlier approach with a newer, broader collecting strategy.",
     ["It describes the physical layout of a seed bank.",
      "It argues that cultivated crops are more valuable than wild ones.",
      "It explains how seeds germinate in storage."]),
    ("The first sentence of the passage asks why some corals survive heat waves that bleach their neighbors. The second sentence answers by pointing to a partnership with heat-tolerant algae.",
     "It poses a question and then provides an explanation.",
     ["It offers two competing theories without choosing between them.",
      "It describes a sequence of events over several decades.",
      "It criticizes a widely accepted conclusion."]),
    ("A new study of urban trees found that shade during the afternoon mattered more for cooling streets than total leaf cover. The finding complicates city policies that reward planting density alone.",
     "It summarizes a finding and notes its implications for current policy.",
     ["It describes the history of urban forestry.",
      "It argues that trees have no effect on street temperature.",
      "It lists the species planted in a single city."]),
    ("Initially, the researchers expected the birds to avoid the noisy highway. Instead, the recordings showed them singing louder and at higher pitches, a response that may help their calls carry over traffic.",
     "It contrasts an expectation with an unexpected observation.",
     ["It traces a debate between two research teams.",
      "It explains how traffic noise is measured.",
      "It recommends a change in highway policy."]),
    ("The passage first describes how the archive catalogued its maps by date. It then explains that researchers searching by region had to consult a separate index, which is why a new cross-referenced catalogue was created.",
     "It describes an earlier system and the problem that prompted a new one.",
     ["It compares two archives and argues that both are outdated.",
      "It outlines the steps of map restoration.",
      "It defines a technical term in cartography."]),
    ("Although the device is small enough to hold in one hand, it can detect trace gases at concentrations of a few parts per billion. Field teams have begun carrying it to sites where laboratory analysis would take weeks.",
     "It emphasizes a capability of the device and an advantage it offers in the field.",
     ["It describes the device's manufacturing process in detail.",
      "It argues that laboratory analysis is no longer useful.",
      "It lists the materials used to build the device."]),
]


def gen_tsp_volume():
    items = []
    for idx, (stim, corr, wrongs) in enumerate(TSP_ITEMS):
        items.append(mc(
            f"RW-CRF-9{700 + idx:04d}",
            RW, "Craft and Structure", "Text Structure and Purpose",
            D_E if idx % 3 == 0 else D_M if idx % 3 == 1 else D_H,
            stim,
            "Which choice best describes the overall structure of the text?",
            corr, wrongs,
            f"The passage moves from setup to development in the way '{corr.lower()}' describes.",
            ["This option mischaracterizes how the sentences relate to one another." for _ in wrongs],
        ))
    return items


# ---------------------------------------------------------------------------
# Cross-Text Connections
# ---------------------------------------------------------------------------
CTC_ITEMS = [
    ("Text 1\nThe novelist argued that writing by hand slows composition enough to improve sentence rhythm, because the pace forces writers to rehearse each phrase before committing it.\n\nText 2\nThe writing researcher agreed that pace affects rhythm but noted that dictation can produce comparable rehearsal, since speakers must plan whole clauses before voicing them.",
     "Both texts value planning before committing words, though they name different tools for it.",
     ["Text 1 rejects the idea that rhythm matters, while Text 2 defends it.",
      "Both texts claim that typing is the best way to compose.",
      "Text 2 argues that planning has no effect on rhythm."]),
    ("Text 1\nThe ecologist argued that reintroducing a native predator would restore balance to the river food web.\n\nText 2\nA fisheries manager warned that the same predator might also reduce populations of a protected fish during its first years, and recommended a staged release with monitoring.",
     "The second text accepts the first text's goal but urges caution about an early side effect.",
     ["The second text rejects the first text's goal entirely.",
      "Both texts agree that no monitoring is needed.",
      "The first text argues that predators harm river ecosystems."]),
    ("Text 1\nAn education researcher found that short, frequent quizzes improved retention more than a single long exam.\n\nText 2\nA testing specialist agreed but added that the benefit depended on feedback: quizzes without review produced no lasting gain.",
     "The second text qualifies the first text's finding by identifying a necessary condition.",
     ["The second text denies that quizzes can improve retention.",
      "The first text claims feedback is irrelevant.",
      "Both texts prefer a single long exam."]),
    ("Text 1\nThe architect praised the building's open plan for encouraging spontaneous meetings.\n\nText 2\nAn acoustics study found that the same open plan raised background noise enough to make focused work difficult.",
     "The two texts assess the same design from different, potentially conflicting standpoints.",
     ["Both texts praise the design for the same reason.",
      "The second text describes a building unrelated to the first.",
      "The first text focuses on noise rather than meetings."]),
    ("Text 1\nA historian argued that the telegraph accelerated commerce by making price information immediate.\n\nText 2\nAn economic geographer noted that the benefit was uneven, since regions without telegraph offices continued to rely on slower correspondence.",
     "The second text adds a limit to the scope of the first text's claim.",
     ["The second text proves the telegraph had no commercial effect.",
      "The first text denies that price information mattered.",
      "Both texts describe the same region's experience."]),
    ("Text 1\nA nutritionist recommended replacing refined grains with whole grains to increase fiber intake.\n\nText 2\nA food scientist agreed about fiber but cautioned that whole-grain products vary widely, and some contain added sugars that offset the benefit.",
     "The second text supports the general recommendation while warning about how products are formulated.",
     ["The second text argues that fiber has no health benefit.",
      "The first text recommends added sugars.",
      "Both texts reject whole grains."]),
]


def gen_ctc_volume():
    items = []
    for idx, (stim, corr, wrongs) in enumerate(CTC_ITEMS):
        items.append(mc(
            f"RW-CRF-9{800 + idx:04d}",
            RW, "Craft and Structure", "Cross-Text Connections",
            D_E if idx % 3 == 0 else D_M if idx % 3 == 1 else D_H,
            stim,
            "Which choice best describes the relationship between the two texts?",
            corr, wrongs,
            "The second text responds to the first by adding a qualification, condition, or competing consideration.",
            ["This option misstates one or both texts' positions." for _ in wrongs],
        ))
    return items


def build():
    items = []
    items.extend(gen_wic_volume())
    items.extend(gen_boundaries_volume())
    items.extend(gen_form_volume())
    items.extend(gen_transitions_volume())
    items.extend(gen_rhetorical_volume())
    items.extend(gen_cid_volume())
    items.extend(gen_inference_volume())
    items.extend(gen_tsp_volume())
    items.extend(gen_ctc_volume())
    return items


def main():
    items = build()
    os.makedirs(EXP_DIR, exist_ok=True)
    out = os.path.join(EXP_DIR, "extra_rw.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"questions": items}, fh, ensure_ascii=False, indent=1)
    by_skill = {}
    for item in items:
        by_skill[item["skill"]] = by_skill.get(item["skill"], 0) + 1
    print(f"wrote {len(items)} R&W items to {out}")
    print(by_skill)


if __name__ == "__main__":
    main()

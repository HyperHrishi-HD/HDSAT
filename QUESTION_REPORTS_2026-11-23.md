# HDSAT — Full-test question reports, 22–23 November 2026

**Snapshot.** 14 reports, all submitted by the owner during one full-test run, all still
`status = received`. Reports were pulled from `public.question_reports` and matched to
the live `questions` and `question_keys` rows on **23 November 2026**. Nothing described
here has been changed yet.

**Raw source of truth for this snapshot**

- `artifacts/question-reports-2026-11-23.json` — the 14 report rows (emails masked), plus
  the 14 corresponding question rows and keys exactly as the live database returned them.
- `.pa/triage_log.jsonl` — unchanged; no reply, resolve or delete was issued.

This file is the **context prompt** for the later repair session. It is deliberately
written so that a fresh session can act on it without re-reading the console or the
database.

---

## 0. Read this first

1. **Nothing here is a request to change a question now.** The 14 reports stay
   `received` until the fixes below ship and are verified.
2. **Every content fix must touch both copies of the bank.** `src/data/questionBank.json`
   is the guest/offline source of truth; `public.questions` + `public.question_keys` are
   the server copy every cloud RPC grades against. Fixing one copy only creates a
   guest/cloud divergence.
3. **The three answer-key defects are release blockers, not copy polish.** A student
   cannot answer those items correctly, so any score that includes them is unfair.
4. **Report text is evidence, kept verbatim.** Typos in the quotes are the owner's, not
   transcription errors.
5. Counts in §7 come from the bundled `src/data/questionBank.json` (10,024 items: 6,388
   Math / 3,636 Reading & Writing). The live REST endpoint pages at 1,000 rows per
   request, so Phase 0 must re-derive the lists from the live tables before editing.

---

## 1. Summary

| # | Report | Question | Owner's concern | What is actually wrong | Priority | Fix size |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `e657818f` | `M13-DATA-T004` | Same `f(9)` type as an earlier item | Same template family as T001/T005, 8 siblings in the bank; keys correct | P2 | Engine + generator |
| 2 | `ec1af164` | `M13-DATA-T005` | Same table type back to back | Same family again; no skill/family spacing in Math ordering | P2 | Engine |
| 3 | `f96c382a` | `M13-DATA-T001` | Marking the first of the run | Same family; context sentence is semantically nonsense | P2 | Engine + generator |
| 4 | `d6560df1` | `M13-DATA-B001` | Repetition; module percentages "inaccurate" | Stitched context is unrelated to the bike-rental chart; skill tagged `Percentages` but task is graph subtraction. **Key is correct.** Blueprint percentages are within College Board's ranges | P1 | Content + metadata |
| 5 | `c6b5b78e` | `M13-DATA-E006` | Three exponential tables in a row | Same generated family; Math ordering only sorts by difficulty | P2 | Engine |
| 6 | `d6f616ee` | `RW-EXP-89022` | "I don't understand the answers" | **Item is sound and correctly keyed.** Longest-choice cue is the only weakness | — | No key change |
| 7 | `58716e21` | `RW-INF-002` | Missing end-of-passage blank | **Confirmed:** "completes the text" item has no blank at all. 88 such items in the bank | P1 | Data + QA rule |
| 8 | `44056818` | `RW-INF-003` | Hard items are cheatable via the long answer | Key is correct; keyed choice is the longest (160 vs 100–121 characters); explanation has a capital-letter error and says "the keyed choice" | P1 | Item design + explanation |
| 9 | `20a1ead2` | `RW-INF-88807` | Same question in the previous module | Bank has 3 ids (`…88807/8/9`) on the identical passage. Within one plan the stimulus key is enforced, so this needs the attempt seed to reproduce | P2 | Engine + bank dedupe decision |
| 10 | `23524bce` | `RW-SEC-89358` | Grammar at Q11–13 instead of the end | Order is **correct per College Board** (see §6). The item itself is unsolvable: every choice asserts a consequence the premise contradicts | **P0** | Rewrite item |
| 11 | `74da108c` | `RW-CRF-88420` | "Text 2" not bold / merged | **Confirmed:** stored stimulus has `gains. Text 2` on one line, so the heading renderer never fires. 39 of 86 cross-text items affected | P1 | Data + normaliser |
| 12 | `39dd5b91` | `RW-SEC-9003` | Item in the wrong place | Order is correct. **Both `;` and `—` are valid**, and `:` is arguable — three defensible answers, one keyed | **P0** | Rewrite choices |
| 13 | `cdfa83fc` | `RW-SEC-9033` | Would never appear at Q12 | Order is correct. **The colon is at least as correct as the keyed dash** — the item is unanswerable as keyed | **P0** | Re-key or rewrite |
| 14 | `cf6e3cf4` | `RW-CRF-88406` | "Text 2" not bold / merged | Same stored-newline defect as 88420 | P1 | Data + normaliser |

**Verdict distribution:** 3 answer-key defects (P0) · 5 content/presentation defects (P1) ·
5 repetition/selection findings (P2) · 1 item that needs no change.

---

## 2. Answer-key defects (P0 — fix before the next scored test)

### 2.1 `RW-SEC-9003` — three defensible punctuation marks, one keyed

**Report `39dd5b91`** · `other` · 2026-11-22 22:51 UTC

> same problem with this one as my previous report q12 where this is in the wrong place

**Item as shown**

> The field station lost power for six hours ______ the backup generator kept the freezers running.

*Which choice completes the text so that it conforms to the conventions of Standard English?*

| Choice | Text | Status |
| --- | --- | --- |
| A | `—` | **Also correct** |
| B | `,` | Wrong (comma splice) |
| C | `;` | **Keyed** |
| D | `:` | Arguable (colon after a complete clause can introduce the explanation) |

**Explanation as shipped:** "The two clauses are independent, so a semicolon marks the
boundary. Reread the sentence with the chosen answer in place to confirm it fits."

**Verdict.** The item is ambiguous. An em dash joining two independent clauses is
standard English, and the contrast ("lost power … the generator kept running") is exactly
the kind of sharp break a dash is used for. A colon is also defensible because the second
clause explains how the station survived. Only the comma is unambiguously wrong.

**Repair.** Keep the semicolon as the target and remove the competition:
`;` (key), `,` (comma splice), `:` (reject: the second clause is a contrast, not an
elaboration of "six hours"), and `and` with no punctuation (run-on). Do **not** offer an
em dash. Alternative: make the second clause a list or definition so the colon becomes
the unique answer and key that instead.

**Acceptance.** Exactly one choice produces a sentence a copy-editor would accept; the
other three fail for a stated, distinct reason.

---

### 2.2 `RW-SEC-9033` — the colon is at least as good as the keyed dash

**Report `cdfa83fc`** · `other` · 2026-11-22 22:50 UTC

> not a problem with question i think but the question will never be placed here like around question 12, these types of questions will be near end, no?

**Item as shown**

> The plan rested on a single assumption ______ that demand would stay flat.

| Choice | Text | Status |
| --- | --- | --- |
| A | `;` | Wrong (second element is not an independent clause) |
| B | `—` | **Keyed** |
| C | `,` | Wrong (comma splice / no such appositive comma) |
| D | `:` | **At least as correct as the key** |

**Explanation as shipped:** "A dash introduces the assumption that the plan depends on.
Reread the sentence with the chosen answer in place to confirm it fits."

**Verdict.** `The plan rested on a single assumption: that demand would stay flat.` is the
textbook colon-as-appositive sentence — many style guides prefer it to the dash. Keying
the dash while offering the colon makes the item unanswerable by rule. This is a **wrong
key**, not a formatting quibble.

**Repair (recommended).** Re-key to `:` and replace the dash distractor with a comma.
Keep the explanation focused on the colon introducing the content of the assumption.
If the dash must remain the target, remove the colon from the choices entirely.

**Acceptance.** One punctuation mark is correct under a named rule; every distractor
violates a different rule.

---

### 2.3 `RW-SEC-89358` — the sentence's logic is inverted; no choice is true

**Report `23524bce`** · `other` · 2026-11-22 23:20 UTC

> Questions 11-13 in this specific mock test( all grammer etc qestions) are here in middle instead of end. pls research and tell me if that is correct framework for question order because i reported before also but idk

**Item as shown**

> Copper printing plates wear down after roughly two thousand impressions—a feature documented across three seasons—____

| Choice | Text | Status |
| --- | --- | --- |
| A | `; so editions of ten thousand prints become practical without recutting.` | Grammatically wrong (`; so`) |
| B | `editions of ten thousand prints become practical without recutting.` | Run-on |
| C | `so editions of ten thousand prints become practical without recutting.` | **Keyed**, but false |
| D | `and, editions of ten thousand prints become practical without recutting.` | Wrong comma |

**Explanation as shipped:** "After the second em-dash closes the parenthetical
interrupting phrase, 'so' introduces the resulting independent clause."

**Verdict.** The key follows grammar and ignores meaning. If a plate wears out after
~2,000 impressions, a 10,000-print edition **cannot** be produced "without recutting" —
it requires recutting several times. All four choices assert the same false consequence,
so the item has **no defensible answer**. This is the most serious of the three key
defects: a strong student is punished for reading the sentence correctly.

**Repair.** Rewrite the consequence so it follows from the premise, e.g.:

> Copper printing plates wear down after roughly two thousand impressions—a feature
> documented across three seasons—____
>
> **Key:** `so editions of ten thousand prints require the plates to be recut several times.`

Then rebuild the three distractors around other punctuation/connection errors, not around
the same false claim. Keep the parenthetical dash pair intact so the boundary skill is
still what is tested.

**Acceptance.** Only the keyed completion is both grammatical and true; every distractor
is either ungrammatical or contradicts the premise.

> The report's stated concern was ordering, not the sentence. Ordering is answered in §6;
> the item still needs this rewrite.

---

## 3. Content and presentation defects (P1)

### 3.1 `RW-INF-002` — "completes the text" with nothing to complete

**Report `58716e21`** · `unclear_formatting` · 2026-11-22 23:28 UTC

> This question is missing the blank line at end of passage that would normally be with inference questions and is different cause not left/hanging

**Item as shown**

> In medieval European scriptoria, parchment made from calfskin (vellum) was prized for
> illuminated manuscripts because its smooth, low-lipid surface accepted gold leaf and
> mineral pigments evenly. However, archival multispectral imaging of twelfth-century
> parish registries—documents intended for routine administrative tracking rather than
> liturgical display—shows that scribes overwhelmingly selected coarser sheepskin
> parchment, which split easily if scraped to remove ink.

*Which choice most logically completes the text?*

Choices A–D follow; **A is keyed** ("Because parish registries did not require decorative
illumination, scribes prioritized sheepskin's resistance to undetected erasure and lower
cost over vellum's smooth finish.").

**Verdict.** Confirmed defect: the passage ends in a full stop and contains no `______`.
The student is asked to "complete" a text that has no gap, and the correct inference is
only recoverable by guessing that the last sentence was meant to end in a blank. The key
itself is a reasonable inference.

**Repair.** End the stimulus with a blank:

> …shows that scribes overwhelmingly selected coarser sheepskin parchment, which split
> easily if scraped to remove ink, ______

Re-check that choice A still completes that sentence grammatically (it does: "…remove ink,
because parish registries did not require decorative illumination…"). Then update the bank
JSON and the live `questions` row.

**Scope.** 88 items share this pattern (see §7). This is a class fix, not one row.

---

### 3.2 `RW-CRF-88406` — "Text 2" is glued to the end of Text 1

**Report `cf6e3cf4`** · `unclear_formatting` · 2026-11-22 22:42 UTC

> The "text 2" text is not bolded and it is connected with the text 1 paragraph that may lead to confustion

**Stored stimulus (note the missing newline):**

> `Text 1\nIn a study of open-plan municipal libraries, architect Leo Sterling argues that
> removing interior walls fosters collaborative civic engagement. According to architect
> Leo Sterling, expanding this practice across comparable sites would yield immediate,
> measurable gains. Text 2\nEvaluating the same open-plan municipal libraries, acoustics
> researcher Priya Nair observes that …`

**Verdict.** Confirmed. `StimulusView` draws a bold heading only when a line is exactly
`Text 1` / `Text 2` (or matches `Text N:` inline). Here `Text 2` sits after `gains.` on the
Text 1 line, so it renders as ordinary prose at the end of the paragraph — exactly the
merge the owner described. The generator writes `\n\nText 2` correctly, so a downstream
store/normalise pass is collapsing the blank line.

**Repair.** Restore `\n\nText 2\n` in the stored stimulus. Then find the collapsing pass
(candidate: the text normaliser used when writing the bank JSON / seed SQL) and make it
preserve paragraph breaks. Add a renderer test for the inline case only if the stored copy
is expected to be dirty; otherwise fix the data and keep the renderer strict.

**Scope.** 39 of 86 cross-text items have `Text 2` off the start of a line.

---

### 3.3 `RW-CRF-88420` — same defect, second cross-text item

**Report `74da108c`** · `other` · 2026-11-22 23:13 UTC

> "Text 2" not bolded and in subheading

**Stored stimulus:** `Text 1\nIn a study of digital restoration of silent films, … measurable
gains. Text 2\nEvaluating the same digital restoration of silent films, …`

**Verdict.** Same root cause as 88406. The key (B) is correct; the item is only a
presentation failure. Fix both rows in the same pass.

**Note on item design (not reported).** In both cross-text items the keyed choice is the
longest, and the "primary performance advantage / secondary operational trade-off" frame
in 88406 is not clearly supported by the texts (the noise problem is not obviously
"secondary"). Shorten/parallelise the choices while the row is open so the length cue
disappears.

---

### 3.4 `M13-DATA-B001` — stitched context, wrong skill tag

**Report `d6560df1`** · `other` · 2026-11-23 00:16 UTC

> same duplicate problems with questions. different story and values but the question types are same repeated and boring. also volume percent of questions per module you can search online feel inaccurate

**Item as shown**

> A stage carpenter is comparing weekly counts at a roof brace for a coastal boardwalk. The
> bar graph shows bike rentals recorded over the periods shown.

*How many more rentals were recorded in Thu than in Mon?*

Bar chart: Mon 24, Tue 36, Wed 30, Thu 42. Choices 66 / 28 / **18 (key)** / 42.

**Verdict.**

- **Key is correct:** 42 − 24 = 18.
- **Context is nonsense.** `generate_bank_m13.py`'s `ctx()` draws a maker, an object and a
  place from three independent pools, then the bar-chart template appends its own subject
  ("bike rentals"). A stage carpenter does not compare weekly counts "at a roof brace".
  The same composer produced "A horticulturist is tracking a culture in a raised planter"
  and "A set builder is recording output from a corner brace".
- **Skill is wrong.** The row is tagged `Percentages`, but the task is reading a bar chart
  and subtracting. Retag to `One-variable data: distributions and measures` (or rewrite
  the prompt as a percent-change question, e.g. "Thu is what percent greater than Mon?" →
  75%, which would justify `Percentages`).
- **Module percentages are not demonstrably wrong.** The Math blueprint is 8 Algebra /
  7 Advanced / 4 PSDA / 3 Geometry = 36 / 32 / 18 / 14%, against College Board's published
  approximate ranges (~35 / ~35 / ~15 / ~15%). The R&W blueprint is 7 / 6 / 7 / 7 of 27,
  which matches the framework's per-domain sequence. Do not change the mix without a
  cited source.

**Repair.** Generate the context from the figure's own subject (bike rentals / periods),
or drop the context sentence for chart items. Retag the skill. Do the same audit for the
whole `M13-DATA-B` series.

---

### 3.5 `RW-INF-003` — correct key, but the explanation is visibly broken

**Report `44056818`** · `other` · 2026-11-22 23:23 UTC

> Not necessarily a problem but these types of "hard" questions are easily cheatbale because there is one long answer that ends up to be the right choice. you need to do a lot more work in the questions somehow but idk

**Item as shown** — cover-crop table (Crimson Clover 68 kg/ha, 54%; Winter Rye 42, 89%;
Clover + Rye 64, 86%; Tillage Radish 51, 72%). Key **A**:
"The Clover + Winter Rye mix achieved 86% weed suppression (close to Winter Rye's 89%)
while retaining 64 kg/ha of nitrogen (close to Crimson Clover's 68 kg/ha)."

**Verdict.** Key is correct and the item is well formed. Two real weaknesses:

1. **Length cue.** The key is a long, data-rich sentence; B/C/D are short. On a hard item
   that is a reliable test-wiseness shortcut, exactly as reported.
2. **Broken explanation.** The shipped text reads: "…without sacrificing the legume's
   nitrogen retention, **The keyed choice** directly cites…" — a capital letter after a
   comma plus internal jargon ("keyed choice") shown to students. It also never names the
   mix or the benchmarks in a clean sentence.

**Repair.** Rewrite the explanation to name the treatment and both comparisons in one
sentence, e.g.: "The 50/50 mix reaches 86% suppression, close to Winter Rye's 89%, while
retaining 64 kg/ha, close to Crimson Clover's 68 kg/ha — so it keeps most of both
benefits." Then rebalance distractor lengths so the key is not the outlier.

**Broader cue (measured).** Six of the seven substantive R&W items in this batch key the
**unique longest** choice: INF-003, EXP-89022, INF-002, INF-88807, CRF-88406 and
CRF-88420. The remaining two are one-character punctuation items, where every choice ties
at one character. That is not a coincidence in the authored bank — it is the dominant
answer signal. Treat "key is the unique longest choice" as a QA rule for new items.

---

## 4. Repetition and selection (P2)

### 4.1 `M13-DATA-T001`, `T004`, `T005` — one template, eight siblings, three in one run

**Reports `f96c382a`, `e657818f`, `ec1af164`** · 2026-11-23 00:31–00:36 UTC

> tbale linear function question 1. im just marking this for my next prompt report

> question 3 number 17. same exact question type as previous reported. even t he (f(9)) asking is same bruh. this is sad lowk

> table question 2. you can see last previous question 14 and this is 15. same exact type of question one after another. this shows the real duplication and lazy production of these questions instead of getting real sat questions. it also shows the defect of the algorithm where these too were together??? but yeah

**The family**

| id | Stimulus (truncated) | Table | Key | `f(9)` |
| --- | --- | --- | --- | --- |
| T000–T007 | generated `ctx()` sentence + "The table shows values of a linear function f." | 4 rows, constant step | varies | 35 / 71 / 83 … |
| **T001** | "A stage carpenter is recording output from a roof brace for a coastal boardwalk." | 11, 14, 17, 20 | C = 35 | 3·9 + 8 |
| **T004** | "A land surveyor is recording output from a tarp cover for a city plaza." | 23, 29, 35, 41 | B = 71 | 6·9 + 17 |
| **T005** | "A set builder is recording output from a corner brace for a sports pavilion." | 27, 34, 41, 48 | C = 83 | 7·9 + 20 |

All three keys are arithmetically correct. The problem is that all eight siblings share the
same prompt (`What is the value of f(9)?`), the same four-row table, the same skill and the
same operation; only the slope/intercept change.

**Why the engine allowed it.** `takeMatching` dedupes by id, content key, stimulus key,
template key and archetype key. The template key includes the normalised *stimulus*, and
each sibling has a different (nonsense) context sentence — so their template and archetype
keys differ, and all three pass as "fresh". Nothing caps how many members of a generated
family may appear in one module. Math ordering then sorts by difficulty only, so siblings
with the same difficulty land adjacent.

**Repair (engine).**

1. Give generated items an explicit `template_family` (e.g. `M13-DATA-T`) written by the
   generator, and fold it into `questionFamilyKeys`.
2. In `buildTestPlan`, cap a family at **one item per full test** while the pool allows it
   (`fresh`/`similar` already exist; add a used-family set to the pick predicate).
3. In `orderModuleQuestions` for Math, add the same neighbour rule practice already uses:
   never place two items of the same skill/family back to back when an alternative exists.

**Repair (content).** Rewrite `ctx()` so the maker, object and verb agree, or drop the
context sentence for table items. "Recording output from a roof brace" is not English a
student should see on a SAT-style item.

---

### 4.2 `M13-DATA-E006` — three exponential tables at the start

**Report `c6b5b78e`** · `other` · 2026-11-23 00:11 UTC

> not a problem but problem with these test questions algorithm i mentioned before same in maths. so i got three xponential table questions in a row at start by chance. thats the problem this randomized or non efficient method of questions etc causing random inconsistencies with how accurate it is to the real sat.
>
> ALSO, i found that many questions were easy which is accurate to sat math however some do need to be actually hard. but the thing is that, all the questions that ever exsisted here in hdsat are all repeats of the same question type with different values. kinda lame in inaccurate compared to real sat. may need to fix all of that perfectly next.

**Item.** "A horticulturist is tracking a culture in a raised planter for a farm cooperative."
Table x = 0,1,2,3 → g = 7,14,28,56. *By what factor does g(x) change each time x
increases by 1?* Key **D = 2**. Correct (14/7 = 2).

**Verdict.** No item defect. The finding is selection/ordering: the E-family (same table
shape, same ratio question) was drawn three times near the module start because Math
ordering is a strict Easy → Medium → Hard sort with no diversity constraint. The comment
about difficulty is consistent with the blueprint: Module 1 opens Easy by design; the
"some need to be actually hard" concern belongs to a later bank-quality pass, not this
report.

**Repair.** Same engine work as §4.1. No change to E006's content.

---

### 4.3 `RW-INF-88807` — one passage, three ids

**Report `20a1ead2`** · `other` · 2026-11-22 23:22 UTC

> Yo i got this same question in the last module (currently in englihs m2). so the question adaptive algorithm or whatever doesnt work? i cant have repeating right...

**Item.** Blackbird dawn-chorus passage; key **A** (2.4 kHz urban vs 1.8 kHz rural). Correct.

**Bank finding.** The identical stimulus exists under three ids:

- `RW-INF-88807` — "Which finding … would most directly support …?"
- `RW-INF-88808` — "Which quotation … would most effectively illustrate …?"
- `RW-INF-88809` — "Which empirical observation … would provide the strongest direct evidence …?"

They are three task variants on one passage, not exact duplicates, so an id-based check
never sees them as the same question.

**What the engine actually guarantees.** Inside a single `buildTestPlan` call,
`markQuestionUsed` records the stimulus key and `takeMatching` refuses a second item with
the same key. A repeat between Module 1 and Module 2 of one freshly built plan should
therefore be impossible. The observation needs the saved attempt seed to reproduce before
any engine change; plausible paths are a resumed/rebuilt plan or the pass-6 id-only
fallback in a very narrow pool. **Do not "fix" the engine on the assumption that the
in-plan guard is missing — it is present.**

**Repair, in order.**

1. Reproduce from the attempt's `pausedState.seed` / `seenQuestionIds`; if it reproduces,
   the plan rebuild path is the bug.
2. Regardless of reproduction, make the three siblings one family (same stimulus key is
   already shared, but the plan-level cap in §4.1 would also stop the trio appearing in
   one test).
3. Decide whether the bank should keep three prompts on one passage at all. Keeping them
   is defensible if they never co-occur; removing two is simpler.

---

## 5. Report that needs no item change

### `RW-EXP-89022` — item is sound; the length cue is the only weakness

**Report `d6f616ee`** · `incorrect_answer` · 2026-11-22 23:28 UTC

> i just dont understand this question answers. i dont know if they are wrong or not

**Item.** Five notes on *Lingulodinium polyedra*; prompt asks for **two distinct ways**
bioluminescence protects the cell. Choices: A (fish see prey), B (circadian rhythm lost
under constant light), C (startles copepods, cutting feeding 55%, **and** exposes them to
predatory fish), D (flash duration/wavelength). Key **C**.

**Verdict.** C is the only choice covering both mechanisms named in the notes, and the
distractors are each true-but-incomplete or irrelevant. The key is not wrong. The likely
cause of the report is that C is a long compound sentence while the others are short
single facts — the same cue as INF-003. The explanation is accurate but generic ("the only
choice that satisfies every part of that goal accurately") and never spells out the two
mechanisms.

**Repair.** No key change. Tighten the explanation to name the two mechanisms explicitly.
If the row is touched anyway, shorten C and lengthen A/D so length stops signalling the
answer. Mark the report resolved with an explanation reply, not a content fix.

---

## 6. The ordering question — the app is right, the drift is not

Four reports (`23524bce`, `39dd5b91`, `cdfa83fc`, and implicitly the two cross-text
reports) say grammar/"these types" appeared around Q11–13 instead of near the end.

**Official answer.** College Board's *Assessment Framework for the Digital SAT Suite*
(Table 9) specifies the domain sequence in **both** modules as:

> Craft and Structure → Information and Ideas → Standard English Conventions → Expression of Ideas

and:

> Within each content domain except Standard English Conventions, questions are ordered
> first by skill/knowledge element and then by question difficulty from easiest to
> hardest. Standard English Conventions questions are ordered from easiest to hardest
> irrespective of skill/knowledge element tested.

Sources:
- https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf
- https://satsuite.collegeboard.org/media/pdf/digital-sat-test-spec-overview.pdf

So **Standard English Conventions belongs in the middle, not at the end.** Expression of
Ideas (Transitions, Rhetorical Synthesis) is the final band. The owner's expectation is
the paper-SAT habit, not the digital blueprint.

**Where the app diverges.** Two concrete deviations from the official sequence:

1. `interleaveDomainBands` lets band boundaries **drift by up to three items**. That is
   how Conventions items reached Q11–13 while Information and Ideas was still running.
   College Board keeps the four domains in strict order; only the *counts* vary.
2. `buildRwModuleQuestions` sorts Standard English Conventions by **skill rank first**
   (Boundaries, then Form, Structure, and Sense), then difficulty. The framework says SEC
   is ordered by difficulty **irrespective of skill**. The app should interleave the two
   SEC skills by difficulty.

**Repair.** Remove the ±3 drift (strict domain blocks) and sort SEC by difficulty only.
That makes the observed Q11–13 placement impossible and matches the published framework.
This is a blueprint change, so pair it with the existing engine tests and update the
sequence test's expectations.

---

## 7. Cross-cutting defect classes and scope

Counts from `src/data/questionBank.json` (10,024 items). Re-derive from live in Phase 0.

| Class | Detector | Count | Examples | Fix layer |
| --- | --- | --- | --- | --- |
| "Completes the text" with no blank | prompt matches `completes? the text` and stimulus lacks `___` | **88** (all Inferences) | `RW-INF-002`, `RW-INF-006`, `RW-INF-301`, `RW-M10P-0151…` | Data repair + QA rule |
| `Text 2` not at line start | cross-text stimulus does not match `(^\|\n)Text 2` | **39 of 86** | `RW-CRF-88406`, `RW-CRF-88420`, M17/M37 batches | Data + normaliser + QA rule |
| Generated `f(9)` family | prompt exactly `What is the value of f(9)?` | **8** (`T000–T007`) | T001/T004/T005 reported | Engine family cap + generator |
| Same passage, different ids | identical normalised stimulus | **3** (`RW-INF-88807/8/9`) | reported 88807 | Engine + bank decision |
| Boundaries item offering both `;` and `—` | choice set contains both marks | **66** (audit pool, not all broken) | `RW-SEC-9000…` | Manual audit; 9003 confirmed |
| Key is the unique longest choice | key length strictly greater than every distractor | **6 of 7** substantive R&W items (the other two are one-character ties) | INF-002, INF-003, INF-88807, EXP-89022, CRF-88406/20 | Item-design pass + QA rule |
| Stitched math context | figure subject absent from stem's context | B series, T series | `M13-DATA-B001`, T001/T004/T005 | Generator |
| Explanation meta-language / capital after comma | `, The` or `keyed choice` | at least INF-003 | `RW-INF-003` | Data repair |

No exact duplicate `(stimulus + prompt)` rows exist in the bank (0 groups). The problem is
**same-family and same-passage reuse**, not literal copy-paste.

The existing QA gate (`tools/content_qa.py`) does not check blank presence, cross-text
heading line starts, duplicate passages across ids, or key-length bias — which is why all
of the above shipped.

---

## 8. Root-cause map

| Layer | Location | What happens |
| --- | --- | --- |
| Seed authoring | `supabase/import/import_questions.py:79-91` | `RW-INF-002` was authored with a complete passage and a "completes the text" prompt — the missing blank is in the source fixture, not a renderer bug |
| Generator (Math) | `supabase/import/generate_bank_m13.py:42-84` | `ctx()` composes maker + object + place from independent pools with no semantic agreement; `:610-620` appends an unrelated chart subject and tags the bar-chart task `Percentages` |
| Generator (R&W) | `supabase/import/generate_bank_scale.py:1152-1160` | Inferences correctly append `______`; the same file's cross-text generator writes `\n\nText 2` correctly — so the stored glue comes from a later pass |
| Store/normalise | bank/seed write path | Some stage collapses the blank line before `Text 2`; find and fix it before repairing 39 rows by hand |
| Renderer | `src/components/FigureView.tsx:589-655` | `StimulusView` only bolds a heading when the line is exactly `Text N` (or `Text N:`); it cannot rescue a glued label |
| Engine — dedupe | `src/lib/examEngine.ts:371-431` | `markQuestionUsed` records id + content + stimulus + template + archetype keys; `takeMatching` enforces them inside one plan. Pass 6 falls back to id-only in tiny fixtures |
| Engine — families | `src/lib/examEngine.ts:785+` | `buildTestPlan` builds family history from *previously attempted* ids only; generated siblings with different context sentences get different template keys |
| Engine — Math order | `src/lib/examEngine.ts:917-947` | `orderModuleQuestions` sorts Math by difficulty only; no skill/family neighbour rule |
| Engine — R&W order | `src/lib/examEngine.ts:547-645` | Domain blueprint + `interleaveDomainBands` drift ±3; SEC sorted by skill then difficulty (framework says difficulty only) |
| QA gate | `tools/content_qa.py` | No blank / heading / duplicate-passage / length-bias rules |

---

## 9. Repair plan for the later session

Do these in order. Each phase ends with a check; do not deploy unless the owner asks.

### Phase 0 — Re-derive the lists (read-only)

- Pull the 14 rows again and confirm they are still `received`.
- Run detectors for the seven classes in §7 against **live** data and the bundled bank;
  write the id lists to `artifacts/question-repair-<date>/`.
- Confirm the `Text 2` collapse stage by diffing a generator output against the stored row.

**Exit:** exact id lists, no data changed.

### Phase 1 — P0 keys (3 items)

- `RW-SEC-9003`: rebuild choices so only `;` works.
- `RW-SEC-9033`: re-key to `:` (recommended) or remove the colon; rewrite explanation.
- `RW-SEC-89358`: rewrite the consequence so the keyed completion is true; rebuild
  distractors.

**Exit:** for each item, a one-line rule that makes exactly one choice correct; a reviewer
can defend the key without seeing it.

### Phase 2 — P1 content and presentation (class fixes)

- Append `______` to the 88 Inferences stems (review each tail for grammar).
- Restore `\n\nText 2` in the 39 cross-text stems; fix the collapsing pass.
- Fix `M13-DATA-B001` context + skill tag; audit the `M13-DATA-B` series.
- Rewrite `RW-INF-003`'s explanation; rebalance choice lengths in the four long-key items.
- Update **both** copies: bank JSON, seed SQL, then the live tables via
  `python supabase/import/apply_seed.py` (or `tools/sync_live_bank.py` for a targeted
  patch). Read back each changed row and compare.

**Exit:** detectors return 0 for blank/heading classes; live and bank agree on every
changed id; `npm run check:questions` passes.

### Phase 3 — Engine selection and ordering

- Add `template_family` to generated items; fold it into `questionFamilyKeys`.
- Cap one item per family per full test; add Math neighbour spacing by skill/family.
- Remove the R&W ±3 band drift; sort SEC by difficulty only.
- Reproduce `RW-INF-88807` from its saved seed before touching the in-plan guard.

**Exit:** a generated full test contains no two members of one generated family; the
blueprint test asserts strict domain order and SEC difficulty-only ordering; all existing
engine tests updated and green.

### Phase 4 — Generator and QA gate

- Fix `ctx()` agreement (or drop context for figure items).
- Make the store preserve paragraph breaks.
- Add QA rules: blank required for "completes the text"; `Text N` must start a line;
  duplicate stimulus across ids is an error; key must not be the unique longest choice;
  boundary items may not offer two defensible marks.
- Add a regression fixture per fixed item.

**Exit:** `python tools/test_content_qa.py` covers the new rules; importing the current
bank produces 0 errors for these classes.

### Phase 5 — Close the reports

- Reply to each report with the fixed-shape template (`wrong_key`, `typo_or_format`,
  `explanation`, `mistagged`), naming what changed.
- Resolve only after the live item is verified by read-back.

**Verification commands**

```bash
npm run typecheck
npx vitest run
npm run check:questions
python tools/test_content_qa.py
python tools/admin_triage.py reports --status received
```

---

## 10. Copy-paste prompt for the repair session

```text
Read QUESTION_REPORTS_2026-11-23.md in the repo root and
artifacts/question-reports-2026-11-23.json. They contain 14 question reports from a
full-test run, the live question rows and the keys, and a prioritised analysis.

Task: repair these reported items and the defect classes they expose. Work in the order
in §9 (P0 keys -> P1 content -> engine -> generator/QA). Do not deploy unless I ask.

Rules:
- Fix both copies: src/data/questionBank.json and the live questions/question_keys tables.
  Read back every changed row and confirm bank == live.
- Do not change unrelated questions. Use explicit id allowlists for batch repairs.
- Do not weaken tests or the QA gate. Add a regression fixture for each fixed item.
- Keep all 14 reports at status "received" until the live item is verified, then reply and
  resolve them with tools/admin_triage.py.
- Never print or commit keys, emails or credentials.

Start with Phase 0: re-derive the id lists from live data and confirm the three P0 defects
(SEC-9003, SEC-9033, SEC-89358) still exist. Report the lists and the proposed edits
before writing anything.
```

---

## Appendix A — Report IDs and close-out commands

| Question | Report id | Suggested reply template |
| --- | --- | --- |
| `RW-SEC-9003` | `39dd5b91-5fb8-4445-b2a6-d3a65b5bd6bd` | `wrong_key` |
| `RW-SEC-9033` | `cdfa83fc-fa0b-4770-9ed1-de659ffc47e0` | `wrong_key` |
| `RW-SEC-89358` | `23524bce-3799-44ba-b379-0d01b2b42f01` | `wrong_key` |
| `RW-INF-002` | `58716e21-ffdb-414d-84b6-9cdf4eff996d` | `typo_or_format` |
| `RW-CRF-88406` | `cf6e3cf4-a816-48ea-85f1-0b2480cf4b00` | `typo_or_format` |
| `RW-CRF-88420` | `74da108c-81bc-4098-b4c2-1d1c6f629ab3` | `typo_or_format` |
| `M13-DATA-B001` | `d6560df1-dde4-4a72-9b8f-6f3c1f596524` | `mistagged` |
| `RW-INF-003` | `44056818-c64d-46cf-989c-6c112c453af6` | `explanation` |
| `M13-DATA-T001` | `f96c382a-b65e-4de5-958a-19ec0793303c` | `explanation` |
| `M13-DATA-T004` | `e657818f-b371-48dc-b516-dbf2abf08d68` | `explanation` |
| `M13-DATA-T005` | `ec1af164-9391-46ff-966f-1b4706170276` | `explanation` |
| `M13-DATA-E006` | `c6b5b78e-7545-47c4-8c87-0d2e84951c04` | `explanation` |
| `RW-INF-88807` | `20a1ead2-d3c6-4e7d-9a23-8ee314f609f5` | `explanation` |
| `RW-EXP-89022` | `d6f616ee-89c7-462d-8ff6-735e5b280e3f` | `explanation` |

```bash
python tools/admin_triage.py reply report <id> --template wrong_key --finding "..." --dry-run
python tools/admin_triage.py resolve <id>
```

---

## Appendix B — Method and limits

- Reports were fetched with `tools/admin_triage.py` (service key read from `.pa/`, never
  printed). Emails in the snapshot are masked; the document contains no addresses.
- The 14 rows were joined to `questions` and `question_keys` by `question_id`; all 14
  matched, so every analysis is based on exactly what the student saw and what the server
  would grade.
- Bank-wide counts come from `src/data/questionBank.json`. The live REST endpoint caps a
  single response at 1,000 rows, so live totals were not asserted here.
- **Not verified by reproduction:** the cross-module repeat in `RW-INF-88807`. The in-plan
  stimulus guard exists in code; reproducing needs the attempt's saved seed/seen list.
- **Not done:** no question row, key, bank file, report status or deployment was changed.

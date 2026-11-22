"""Append the reviewed external study resources to src/data/resources.json.

Every URL in this list was requested and answered with 200 before the entry was
added, so the page behind each card is live. Entries are keyed by URL: running
the script twice cannot duplicate a card, and an existing URL is never replaced.
"""

from __future__ import annotations

import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src" / "data" / "resources.json"

# (title, provider, url, type, tags, description)
ADD: list[tuple[str, str, str, str, list[str], str]] = [
    (
        "Practice and Preparation: the official hub",
        "College Board",
        "https://satsuite.collegeboard.org/practice",
        "reference",
        ["sat", "official", "practice-tests", "planning"],
        "One page that links every official practice tool: Bluebook tests, the question bank and score review.",
    ),
    (
        "Full-length digital practice tests in Bluebook",
        "College Board",
        "https://satsuite.collegeboard.org/practice/practice-tests/bluebook",
        "reference",
        ["sat", "official", "full-length", "digital"],
        "The adaptive practice tests that match test day, with scoring and answer explanations.",
    ),
    (
        "Download the Bluebook testing app",
        "College Board",
        "https://bluebook.collegeboard.org/students/download-bluebook",
        "tool",
        ["sat", "official", "tool", "digital"],
        "The app used for official practice tests and for the digital test itself. Install it early.",
    ),
    (
        "Printable practice tests with answer keys",
        "College Board",
        "https://satsuite.collegeboard.org/practice/practice-tests/paper",
        "reference",
        ["sat", "official", "practice-tests", "worksheets"],
        "Linear-format tests as PDFs, useful for untimed work and for marking up by hand.",
    ),
    (
        "Official SAT Question of the Day",
        "College Board",
        "https://qotd.collegeboard.org/",
        "tool",
        ["sat", "official", "drill", "digital"],
        "One official question a day, with streaks. A free account keeps the history.",
    ),
    (
        "SAT test dates and registration deadlines",
        "College Board",
        "https://satsuite.collegeboard.org/sat/dates-deadlines",
        "reference",
        ["sat", "official", "logistics", "planning"],
        "Current weekend dates, in-school windows and the deadline for each one.",
    ),
    (
        "SAT fee waivers",
        "College Board",
        "https://satsuite.collegeboard.org/sat/registration/fee-waivers",
        "reference",
        ["sat", "official", "college-planning", "logistics"],
        "Who qualifies, what the waiver covers and how a school counselor submits it.",
    ),
    (
        "Registering with testing accommodations",
        "College Board",
        "https://satsuite.collegeboard.org/sat/registration/additional-registration-options/accommodations",
        "reference",
        ["sat", "official", "accessibility", "logistics"],
        "How accommodations are requested, approved and confirmed for test day.",
    ),
    (
        "How SAT scores are calculated",
        "College Board",
        "https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated",
        "reference",
        ["sat", "official", "structure", "digital"],
        "The adaptive modules, the 400-1600 scale and how raw answers become section scores.",
    ),
    (
        "Free full-length SAT practice test",
        "The Princeton Review",
        "https://www.princetonreview.com/college/free-sat-practice-test",
        "course",
        ["sat", "practice-tests", "full-length"],
        "A timed full test with an instant score report. A free account is required.",
    ),
    (
        "Free SAT practice tests and section drills",
        "Magoosh",
        "https://sat.magoosh.com/practice_tests/free",
        "course",
        ["sat", "practice-tests", "full-length", "math", "reading"],
        "Full-length or single-section practice with estimated scores and a breakdown by skill.",
    ),
    (
        "SAT practice test with answer explanations",
        "Mometrix Test Preparation",
        "https://www.mometrix.com/academy/sat-practice-test/",
        "course",
        ["sat", "practice-tests", "math", "reading"],
        "A free online practice set, plus links to separate math and reading practice.",
    ),
    (
        "Digital SAT practice tests and printable PDFs",
        "Test Ninjas",
        "https://test-ninjas.com/digital-sat-practice-tests",
        "course",
        ["sat", "practice-tests", "full-length", "digital"],
        "Module-by-module digital practice with PDFs. Explanations need a free account.",
    ),
    (
        "Free adaptive digital SAT practice",
        "Test Ninjas",
        "https://test-ninjas.com/free-sat-practice",
        "tool",
        ["sat", "drill", "digital", "practice-tests"],
        "Daily questions and a short adaptive set, good for a five-minute session.",
    ),
    (
        "Full-length SAT practice tests",
        "Quad Education",
        "https://www.quadeducationgroup.com/sat-practice-tests",
        "course",
        ["sat", "practice-tests", "full-length"],
        "Downloadable practice tests with explanations, built to the digital format.",
    ),
    (
        "SAT practice test archive",
        "E Math Academy",
        "https://www.emathacademy.com/sat-practice-tests.html",
        "course",
        ["sat", "practice-tests", "worksheets"],
        "Print-ready practice tests, answer keys and scoring sheets in one place.",
    ),
    (
        "Are free adaptive digital tests actually adaptive?",
        "Piqosity",
        "https://www.piqosity.com/2024/02/01/digital-sat-practice-tests-free-full-length-adaptive/",
        "reference",
        ["sat", "practice-tests", "digital", "structure"],
        "Explains what adaptive means on the digital SAT and how free tests compare.",
    ),
    (
        "SAT Math course",
        "Khan Academy",
        "https://www.khanacademy.org/test-prep/v2-sat-math",
        "course",
        ["sat", "math", "official", "drill"],
        "The official math course: lessons, worked examples and skill practice by domain.",
    ),
    (
        "SAT Reading and Writing course",
        "Khan Academy",
        "https://www.khanacademy.org/test-prep/sat-reading-and-writing",
        "course",
        ["sat", "reading", "writing", "official"],
        "The official reading and writing course, organised by question type.",
    ),
    (
        "Get ready for SAT Reading and Writing",
        "Khan Academy",
        "https://www.khanacademy.org/test-prep/get-ready-for-sat-prep-reading-and-writing",
        "course",
        ["sat", "reading", "writing", "foundations"],
        "A gentler on-ramp for students who want the basics before the full course.",
    ),
    (
        "Reference information on the digital SAT math test",
        "Khan Academy",
        "https://www.khanacademy.org/test-prep/v2-sat-math/x0fcc98a58ba3bea7:about-the-digital-sat/x0fcc98a58ba3bea7:preparing-for-the-sat/a/reference-information-on-the-digital-sat-math-test",
        "reference",
        ["sat", "math", "formulas", "official"],
        "What the in-test reference sheet contains, and what it deliberately leaves out.",
    ),
    (
        "SAT Math articles and sample problems",
        "The College Panda",
        "https://www.thecollegepanda.com/categories/sat-math/",
        "course",
        ["sat", "math", "algebra", "advanced-math"],
        "Free strategy articles from a well-known SAT math author. Some predates the digital test.",
    ),
    (
        "Free SAT resources preview",
        "1600.io",
        "https://1600.io/p/sat-resources-free-trial",
        "course",
        ["sat", "math", "reading", "video"],
        "Sample chapters and explanations from the Orange Book series, free with an account.",
    ),
    (
        "SAT math facts and formulas",
        "Erik Jacobsen (Erik the Red)",
        "https://www.erikthered.com/tutor/",
        "reference",
        ["sat", "math", "formulas", "reference"],
        "Condensed formula sheets and quizzes. Check that a sheet matches the digital test.",
    ),
    (
        "Digital SAT practice by topic",
        "SATPanda",
        "https://www.satpanda.com/",
        "tool",
        ["sat", "drill", "question-bank", "digital"],
        "Topic drills and mock tests with explanations. Third-party questions, not official ones.",
    ),
    (
        "SAT Bootcamp practice tests",
        "Schoolhouse.world",
        "https://schoolhouse.world/sat-bootcamp/practice-tests",
        "course",
        ["sat", "practice-tests", "full-length", "math", "reading"],
        "Free timed math and reading/writing sets, organised by domain. Tutoring is free too.",
    ),
    (
        "Official question bank, browsable",
        "SATQuestionBank.org",
        "https://satquestionbank.org/",
        "tool",
        ["sat", "question-bank", "drill", "official"],
        "A third-party front end for the College Board question bank, easier to filter by skill.",
    ),
    (
        "Digital SAT Math practice-test walkthroughs",
        "Scalar Learning",
        "https://www.youtube.com/playlist?list=PLZBnAG03572oS5Q86ZoTdLVp-RUboVb4l",
        "reference",
        ["sat", "math", "video", "worked-examples"],
        "A teacher solves full digital math modules on screen, question by question.",
    ),
    (
        "Desmos for digital SAT Math",
        "The Admission Hackers",
        "https://www.youtube.com/playlist?list=PLf3ypEs9Kobgascv5bwpOadB0UiVI5IQS",
        "reference",
        ["sat", "math", "calculator", "graphing", "video"],
        "Short lessons on solving SAT problems in Desmos instead of by hand.",
    ),
    (
        "SAT Math concept summaries",
        "The Admission Hackers",
        "https://www.youtube.com/playlist?list=PLJEsnzUGdlBOeK1ClXZT3dGztgxqLXi61",
        "reference",
        ["sat", "math", "video", "formulas"],
        "Every math topic on the test, summarised in a few minutes each.",
    ),
    (
        "All of SAT Reading and Writing in 22 minutes",
        "SAT (YouTube)",
        "https://www.youtube.com/watch?v=jTkfge6FeE8",
        "reference",
        ["sat", "reading", "writing", "video"],
        "A fast tour of the reading and writing skills and the strategies for each.",
    ),
    (
        "All SAT punctuation rules in 15 minutes",
        "SAT Writing (YouTube)",
        "https://www.youtube.com/watch?v=WCHyeJKWD84",
        "reference",
        ["sat", "writing", "grammar", "punctuation", "video"],
        "Commas, colons, dashes and boundaries in one sitting, aimed at the test.",
    ),
    (
        "Reading and Writing walkthroughs on real modules",
        "MyGuru Tutoring",
        "https://www.youtube.com/playlist?list=PLE39rYnOi8ZongqglV5YsPny4DhyNnrc1",
        "reference",
        ["sat", "reading", "writing", "video", "worked-examples"],
        "A tutor works through Bluebook reading and writing modules, reasoning out loud.",
    ),
    (
        "Desmos cheat sheet for the digital SAT",
        "Acely",
        "https://acely.com/sat-prep/desmos-cheat-sheet",
        "reference",
        ["sat", "math", "calculator", "graphing", "reference"],
        "Which problems to hand to Desmos, and the keystrokes that solve them.",
    ),
    (
        "Free Desmos course for SAT Math",
        "Aniko",
        "https://www.aniko.ai/free-resources/sat/courses/desmos",
        "course",
        ["sat", "math", "calculator", "graphing"],
        "Thirty short lessons and practice sets on calculator-first solving.",
    ),
    (
        "Printable SAT formula sheet",
        "Mashup Math",
        "https://mashupmath.com/sat-formula-sheet",
        "reference",
        ["sat", "math", "formulas", "worksheets"],
        "A two-page formula reference, with notes on when each formula is worth using.",
    ),
    (
        "Desmos on the digital SAT",
        "Desmos",
        "https://www.desmos.com/testing/digital-sat",
        "tool",
        ["sat", "math", "calculator", "graphing", "official"],
        "The exact calculator build the test uses, so practice matches test day.",
    ),
    (
        "Grammar introduction",
        "Purdue OWL",
        "https://owl.purdue.edu/owl/general_writing/grammar/index.html",
        "reference",
        ["grammar", "writing", "conventions", "reference"],
        "Clear explanations of sentence-level grammar, with exercises for each topic.",
    ),
    (
        "Brief overview of punctuation",
        "Purdue OWL",
        "https://owl.purdue.edu/owl/general_writing/punctuation/punctuation/index.html",
        "reference",
        ["grammar", "writing", "punctuation", "conventions"],
        "Commas, semicolons, colons and dashes, which is most of the writing section.",
    ),
    (
        "Making subjects and verbs agree",
        "Purdue OWL",
        "https://owl.purdue.edu/owl/general_writing/grammar/subject_verb_agreement.html",
        "reference",
        ["grammar", "writing", "conventions", "reference"],
        "The agreement rules the test leans on, including the tricky interrupting phrases.",
    ),
    (
        "Sentence structure exercises",
        "Purdue OWL",
        "https://owl.purdue.edu/owl_exercises/sentence_structure/index.html",
        "tool",
        ["grammar", "writing", "conventions", "drill"],
        "Self-marking exercises on fragments, run-ons, clauses and sentence variety.",
    ),
    (
        "Tips and tools for academic writing",
        "UNC Writing Center",
        "https://writingcenter.unc.edu/tips-and-tools/",
        "reference",
        ["writing", "grammar", "revision", "reference"],
        "Short handouts on transitions, concision, parallelism and sentence patterns.",
    ),
    (
        "Complete SAT and ACT grammar rules",
        "Erica L. Meltzer, The Critical Reader",
        "https://thecriticalreader.com/complete-sat-grammar-rules/",
        "reference",
        ["sat", "writing", "grammar", "conventions", "reference"],
        "Every rule the writing section tests, in one continuously updated page.",
    ),
    (
        "Adaptive SAT practice and diagnostics",
        "Test Innovators",
        "https://testinnovators.com/sat",
        "course",
        ["sat", "practice-tests", "digital", "drill"],
        "An adaptive test engine with targeted question sets; check what is free.",
    ),
]


def main() -> None:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    resources = data["resources"]
    known = {item["url"] for item in resources}
    next_number = max(int(item["id"].split("-")[1]) for item in resources) + 1
    added = 0
    for title, provider, url, kind, tags, description in ADD:
        if url in known:
            continue
        resources.append(
            {
                "id": f"R-{next_number:03d}",
                "title": title,
                "provider": provider,
                "url": url,
                "type": kind,
                "cost": "free",
                "description": description,
                "tags": tags,
            }
        )
        known.add(url)
        next_number += 1
        added += 1
    PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"added {added} resources, {len(resources)} total")


if __name__ == "__main__":
    main()

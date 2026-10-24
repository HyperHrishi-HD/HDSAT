#!/usr/bin/env python3
"""Offline tests for tools/content_qa.py (no network, no credentials).

Run: python tools/test_content_qa.py
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("content_qa", HERE / "content_qa.py")
qa = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(qa)

SOURCE = {
    "source_id": "test-source",
    "name": "Test Source",
    "license": "CC-BY-4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "provenance_summary": "Synthetic items used only by the test suite.",
    "is_released_practice_set": False,
    "is_official_college_board": False,
    "record_count": 1,
}


def item(question_id: str = "T-001", **overrides):
    base = {
        "id": question_id,
        "external_id": f"EXT-{question_id}",
        "assessments": ["SAT"],
        "section": "Math",
        "domain": "Algebra",
        "skill": "Linear equations in one variable",
        "difficulty": "Easy",
        "format": "multiple_choice",
        "stimulus": "A store sells notebooks for a fixed price each and pens for a fixed price each.",
        "prompt": "If three notebooks and two pens cost 19 dollars, which equation models the cost?",
        "choices": [
            {"id": "A", "text": "3n + 2p = 19"},
            {"id": "B", "text": "2n + 3p = 19"},
            {"id": "C", "text": "3n - 2p = 19"},
            {"id": "D", "text": "n + p = 19"},
        ],
        "figure_metadata": None,
        "source_id": "test-source",
        "source_name": "Test Source",
        "license": "CC-BY-4.0",
        "attribution": "Test Source (CC-BY-4.0)",
        "is_released_practice_set": False,
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": "Three notebooks at n dollars plus two pens at p dollars gives 3n + 2p = 19, so choice A is the model.",
        "distractor_rationales": {
            "B": "This swaps the quantities of notebooks and pens.",
            "C": "Subtracting the pen cost is not what the receipt describes.",
            "D": "This assumes one of each item, not three and two.",
        },
    }
    base.update(overrides)
    return base


def bank(*questions, sources=None):
    return {
        "bank_version": "test-1",
        "licensing_note": "Test data.",
        "sources": sources if sources is not None else [dict(SOURCE)],
        "questions": list(questions),
    }


def categories(report, severity=None):
    return [
        issue["category"]
        for issue in report.issues
        if severity is None or issue["severity"] == severity
    ]


class CleanBankTests(unittest.TestCase):
    def test_clean_synthetic_bank_passes_with_no_warnings(self):
        report = qa.check_bank(bank(item()))
        self.assertEqual(report.errors, 0, categories(report))
        self.assertEqual(report.warnings, 0, categories(report))
        self.assertEqual(qa.exit_code_for(report, "error"), 0)
        self.assertEqual(qa.exit_code_for(report, "warn"), 0)

    def test_exit_code_thresholds(self):
        report = qa.check_bank(bank(item(explanation="Too short to explain the reasoning.")))
        self.assertEqual(report.errors, 0)
        self.assertGreaterEqual(report.warnings, 1)
        self.assertEqual(qa.exit_code_for(report, "error"), 0)
        self.assertEqual(qa.exit_code_for(report, "warn"), 1)
        self.assertEqual(qa.exit_code_for(report, "none"), 0)


class DuplicateTests(unittest.TestCase):
    def test_duplicate_ids_are_errors(self):
        report = qa.check_bank(bank(item("DUP-1"), item("DUP-1", prompt="Different prompt for the second copy?")))
        self.assertIn("duplicate_id", categories(report))
        self.assertGreater(report.errors, 0)

    def test_identical_stems_are_errors(self):
        report = qa.check_bank(bank(item("S-1"), item("S-2")))
        self.assertIn("duplicate_stem", categories(report))

    def test_near_duplicate_stems_are_warned_once_per_pair(self):
        near = item(
            "N-2",
            prompt="If four notebooks and two pens cost 19 dollars, which equation models this cost?",
        )
        report = qa.check_bank(bank(item("N-1"), near))
        self.assertIn("near_duplicate_stem", categories(report))
        near_issue = next(issue for issue in report.issues if issue["category"] == "near_duplicate_stem")
        self.assertEqual(near_issue["count"], 1)
        self.assertEqual(near_issue["severity"], "warn")

    def test_distinct_stems_are_not_flagged(self):
        other = item(
            "N-3",
            skill="Linear equations in one variable",
            stimulus="A cyclist rides at a steady speed along a straight coastal road for two hours.",
            prompt="Which graph shows distance from the start as a function of time for a constant speed?",
        )
        report = qa.check_bank(bank(item("N-1"), other))
        self.assertNotIn("near_duplicate_stem", categories(report))

    def test_near_duplicates_are_scoped_to_a_skill(self):
        other_skill = item("N-4", skill="Linear functions", prompt=item()["prompt"])
        report = qa.check_bank(bank(item("N-1"), other_skill))
        self.assertNotIn("near_duplicate_stem", categories(report))

    def test_a_shared_prompt_template_over_different_stimuli_is_not_flagged(self):
        prompt = "Which choice best describes the relationship between the two variables shown in the table?"
        first = item("P-1", section="Reading and Writing", domain="Information and Ideas", skill="Command of Evidence (Quantitative)", stimulus="Table one lists hours of sunlight.", prompt=prompt, format="spr", choices=None, acceptable_answers=["A"], correct_answer="A", distractor_rationales={})
        second = item("P-2", section="Reading and Writing", domain="Information and Ideas", skill="Command of Evidence (Quantitative)", stimulus="Table two lists rainfall totals.", prompt=prompt, format="spr", choices=None, acceptable_answers=["A"], correct_answer="A", distractor_rationales={})
        report = qa.check_bank(bank(first, second))
        self.assertNotIn("duplicate_long_prompt", categories(report))
        self.assertEqual(report.errors, 0, categories(report))


class AnswerKeyTests(unittest.TestCase):
    def test_key_must_be_one_of_the_choices(self):
        report = qa.check_bank(bank(item(correct_answer="Z")))
        self.assertIn("answer_key.not_in_choices", categories(report))
        self.assertGreater(report.errors, 0)

    def test_spr_requires_acceptable_answers(self):
        spr = item(
            "S-9",
            format="spr",
            choices=None,
            correct_answer="12",
            acceptable_answers=[],
            distractor_rationales={},
            prompt="A rectangle is 3 units wide and 4 units tall. What is its area, in square units?",
        )
        report = qa.check_bank(bank(spr))
        self.assertIn("answer_key.no_acceptable_answers", categories(report))

    def test_spr_key_must_be_accepted(self):
        spr = item(
            "S-10",
            format="spr",
            choices=None,
            correct_answer="13",
            acceptable_answers=["12"],
            distractor_rationales={},
            prompt="A rectangle is 3 units wide and 4 units tall. What is its area, in square units?",
        )
        report = qa.check_bank(bank(spr))
        self.assertIn("answer_key.key_not_accepted", categories(report))

    def test_duplicate_choice_text_is_warned(self):
        duplicate = item(
            "C-2",
            choices=[
                {"id": "A", "text": "3n + 2p = 19"},
                {"id": "B", "text": "3n + 2p = 19"},
                {"id": "C", "text": "3n - 2p = 19"},
                {"id": "D", "text": "n + p = 19"},
            ],
        )
        report = qa.check_bank(bank(duplicate))
        self.assertIn("answer_key.duplicate_choice_text", categories(report, "warn"))

    def test_punctuation_options_are_not_duplicates(self):
        # A Boundaries item may offer ", but", "but" and "; but". They differ
        # only in punctuation, which is the whole point of the item.
        boundaries = item(
            "C-2b",
            section="Reading and Writing",
            domain="Standard English Conventions",
            skill="Boundaries",
            stimulus="The storm had passed ______ the crew still waited for the swell to settle.",
            prompt="Which choice completes the text so that it conforms to the conventions of Standard English?",
            choices=[
                {"id": "A", "text": ", but"},
                {"id": "B", "text": " but"},
                {"id": "C", "text": "; but"},
                {"id": "D", "text": ", however"},
            ],
            correct_answer="A",
            acceptable_answers=["A"],
            explanation="Two independent clauses joined by 'but' take a comma before the conjunction.",
            distractor_rationales={
                "B": "Without the comma the clauses run together.",
                "C": "A semicolon before a coordinating conjunction is nonstandard.",
                "D": "A comma alone before 'however' creates a comma splice.",
            },
        )
        report = qa.check_bank(bank(boundaries))
        self.assertNotIn("answer_key.duplicate_choice_text", categories(report, "warn"))

    def test_all_of_the_above_style_choices_are_warned(self):
        style = item(
            "C-3",
            choices=[
                {"id": "A", "text": "3n + 2p = 19"},
                {"id": "B", "text": "2n + 3p = 19"},
                {"id": "C", "text": "All of the above"},
                {"id": "D", "text": "None of the above"},
            ],
        )
        report = qa.check_bank(bank(style))
        self.assertIn("answer_key.above_style_choice", categories(report, "warn"))


class KeyBiasTests(unittest.TestCase):
    def _family(self, letters):
        words = ["alpha", "bravo", "charlie", "delta", "echo"]
        items = []
        for index, letter in enumerate(letters):
            word = words[index % len(words)]
            items.append(
                item(
                    f"B-{index:03d}",
                    prompt=f"A {word} shipment {index} contains crates arranged in rows of {index + 2}. Which equation gives the total?",
                    stimulus=f"Warehouse {index} stores {word} goods in a rectangular layout with a unique aisle count of {index + 5}.",
                    correct_answer=letter,
                )
            )
        return items

    def test_skewed_key_distribution_is_flagged(self):
        report = qa.check_bank(bank(*self._family(["A"] * 20)))
        self.assertIn("key_bias", categories(report, "warn"))

    def test_balanced_key_distribution_is_not_flagged(self):
        report = qa.check_bank(bank(*self._family(["A", "B", "C", "D"] * 5)))
        self.assertNotIn("key_bias", categories(report, "warn"))


class FigureTests(unittest.TestCase):
    def test_unknown_figure_type_is_an_error(self):
        report = qa.check_bank(bank(item(figure_metadata={"type": "pie_chart", "values": [1, 2]})))
        self.assertIn("figure.unknown_type", categories(report, "error"))

    def test_table_width_mismatch_is_an_error(self):
        meta = {"type": "table", "headers": ["A", "B"], "rows": [["1", "2"], ["3"]]}
        report = qa.check_bank(bank(item(figure_metadata=meta)))
        self.assertIn("figure.invalid", categories(report, "error"))

    def test_supported_figures_pass(self):
        figures = [
            {"type": "table", "headers": ["x", "y"], "rows": [["1", "2"], ["3", "4"]]},
            {"type": "bar_chart", "series": [{"label": "2024", "value": 4}]},
            {"type": "line_chart", "series": [{"label": "Q1", "value": 1.5}]},
            {"type": "coordinate_plane", "x_min": -5, "x_max": 5, "y_min": -4, "y_max": 4},
            {"type": "geometry_figure", "shape": "right_triangle"},
        ]
        for index, figure in enumerate(figures):
            with self.subTest(figure=figure["type"]):
                single = item(
                    f"F-{index}",
                    prompt=f"Figure {index} shows a relationship. Which statement describes figure {index}?",
                    stimulus=f"Context {index} introduces the figure for problem {index}.",
                    figure_metadata=figure,
                )
                report = qa.check_bank(bank(single))
                self.assertEqual(report.errors, 0, categories(report))


class MetadataTests(unittest.TestCase):
    def test_missing_and_unknown_metadata_is_an_error(self):
        broken = item("M-1", section="Science", difficulty="Extreme", format="essay", assessments=[])
        broken["domain"] = ""
        broken["skill"] = ""
        broken["source_id"] = "not-in-sources"
        broken["license"] = ""
        broken["attribution"] = ""
        report = qa.check_bank(bank(broken))
        found = set(categories(report, "error"))
        for expected in {
            "metadata.unknown_section",
            "metadata.unknown_difficulty",
            "metadata.unknown_format",
            "metadata.unknown_assessment",
            "metadata.missing_domain",
            "metadata.missing_skill",
            "metadata.unknown_source",
            "source.missing_item_license",
            "source.missing_item_attribution",
        }:
            self.assertIn(expected, found)

    def test_official_source_needs_a_licence_url_and_attribution(self):
        official = dict(SOURCE)
        official.update(
            source_id="official-cb",
            name="College Board Educator Question Bank",
            is_official_college_board=True,
            license_url="",
        )
        question = item("O-1", source_id="official-cb", attribution="College Board Educator Question Bank")
        report = qa.check_bank(bank(question, sources=[official]))
        found = set(categories(report, "error"))
        self.assertIn("source.official_without_license_url", found)

        question["attribution"] = "Educator bank"
        report = qa.check_bank(bank(question, sources=[official]))
        self.assertIn("source.official_attribution", set(categories(report, "error")))

    def test_missing_rationale_is_warned_not_fatal(self):
        partial = item(
            "R-1",
            distractor_rationales={"B": "Wrong orientation.", "C": "Subtracts instead of adds."},
        )
        report = qa.check_bank(bank(partial))
        self.assertIn("rationale.missing", categories(report, "warn"))
        self.assertEqual(report.errors, 0)


class ReportTests(unittest.TestCase):
    def test_json_report_shape(self):
        report = qa.check_bank(bank(item("J-1"), item("J-1")))
        payload = qa.build_json(report, "error", qa.exit_code_for(report, "error"))
        self.assertEqual(
            set(payload),
            {"bank", "version", "items", "sources", "issues", "summary", "fail_on", "exit_code"},
        )
        self.assertEqual(payload["items"], 2)
        self.assertEqual(payload["exit_code"], 1)
        self.assertGreaterEqual(payload["summary"]["errors"], 1)
        self.assertIsInstance(payload["summary"]["by_category"], dict)
        for issue in payload["issues"]:
            self.assertEqual(set(issue), {"category", "severity", "message", "count", "ids"})
            self.assertIn(issue["severity"], {"error", "warn"})
            self.assertLessEqual(len(issue["ids"]), 5)

    def test_text_and_json_are_plain_ascii(self):
        unicode_item = item("U-1", prompt="Which choice explains the r\u00e9sum\u00e9 \u2014 and why?")
        report = qa.check_bank(bank(unicode_item))
        text = qa.render_text(report)
        self.assertTrue(all(ord(char) < 128 for char in text), "text report must be ASCII")
        payload = json.dumps(qa.build_json(report, "error", 0))
        self.assertTrue(all(ord(char) < 128 for char in payload), "json report must be ASCII")

    def test_main_returns_two_on_unreadable_bank(self):
        missing = str(HERE / "does-not-exist.json")
        self.assertEqual(qa.main(["--bank", missing]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)

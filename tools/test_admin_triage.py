#!/usr/bin/env python3
"""Offline tests for tools/admin_triage.py (no network, no credentials).

Run: python tools/test_admin_triage.py
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("admin_triage", HERE / "admin_triage.py")
triage = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(triage)

NOW = dt.datetime(2026, 10, 23, 12, 0, tzinfo=dt.timezone.utc)


def iso(hours_ago: float) -> str:
    return (NOW - dt.timedelta(hours=hours_ago)).isoformat().replace("+00:00", "Z")


def report(**overrides):
    row = {
        "id": "11111111-2222-3333-4444-555555555555",
        "question_id": "rw-0001",
        "reason": "incorrect_answer",
        "details": "Choice B looks right",
        "contact_email": "student@example.com",
        "status": "received",
        "created_at": iso(2),
        "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }
    row.update(overrides)
    return row


def appeal(**overrides):
    row = {
        "id": "99999999-8888-7777-6666-555555555555",
        "reference": "HDSAT-EC0048E9",
        "category": "question_error",
        "subject": "Typo in the graph question",
        "details": "The axis label is wrong",
        "contact_email": None,
        "status": "received",
        "created_at": iso(5),
        "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }
    row.update(overrides)
    return row


class MaskEmailTests(unittest.TestCase):
    def test_masks_local_part_keeps_domain(self):
        self.assertEqual(triage.mask_email("student@example.com"), "s***@example.com")

    def test_empty_and_malformed(self):
        self.assertEqual(triage.mask_email(None), "")
        self.assertEqual(triage.mask_email("   "), "")
        self.assertEqual(triage.mask_email("not-an-email"), "***")

    def test_reporter_label_prefers_email_then_student_id(self):
        self.assertEqual(triage.reporter_label({"contact_email": "a@b.co"}, True), "a***@b.co")
        self.assertEqual(triage.reporter_label({"contact_email": "a@b.co"}, False), "a@b.co")
        self.assertEqual(
            triage.reporter_label({"user_id": "12345678-9999"}, True), "student 12345678"
        )
        self.assertEqual(triage.reporter_label({}, True), "guest")


class AgeTests(unittest.TestCase):
    def test_buckets(self):
        self.assertEqual(triage.age(iso(0.2), NOW), "12 min")
        self.assertEqual(triage.age(iso(3), NOW), "3 h")
        self.assertEqual(triage.age(iso(50), NOW), "2 d")

    def test_invalid_date(self):
        self.assertEqual(triage.age("not a date", NOW), "?")

    def test_hours_open(self):
        self.assertAlmostEqual(triage.hours_open(iso(100), NOW), 100, places=1)


class TemplateTests(unittest.TestCase):
    def test_every_template_renders_the_shared_shape(self):
        for name in triage.TEMPLATE_NAMES:
            title, body = triage.render_reply(name, "HDSAT-TEST1234", 'question rw-0001 - "typo"')
            self.assertTrue(title)
            for heading in ("What you sent", "What we found", "What changed", "Next step"):
                self.assertIn(heading, body, name)
            self.assertIn("HDSAT-TEST1234", body)
            self.assertLess(len(body), 1200, f"{name} reply is too long")
            self.assertTrue(all(ord(ch) < 128 for ch in body), f"{name} must be ASCII")

    def test_finding_override_replaces_default(self):
        _, body = triage.render_reply("wrong_key", "REF", "submitted", "  The stem had two answers.  ")
        self.assertIn("The stem had two answers.", body)
        self.assertNotIn(triage.TEMPLATES["wrong_key"].finding, body)

    def test_unknown_template_is_refused(self):
        with self.assertRaises(SystemExit):
            triage.render_reply("does_not_exist", "REF", "submitted")

    def test_templates_are_short_and_distinct(self):
        self.assertGreaterEqual(len(triage.TEMPLATE_NAMES), 6)
        titles = [triage.TEMPLATES[name].title for name in triage.TEMPLATE_NAMES]
        self.assertEqual(len(titles), len(set(titles)))


class DigestTests(unittest.TestCase):
    def test_clear_queue(self):
        out = triage.build_digest([], [], NOW)
        self.assertIn("Queue is clear", out)

    def test_counts_overdue_and_orders_oldest_first(self):
        rows = [report(created_at=iso(1)), report(id="r2", created_at=iso(100), question_id="rw-0002")]
        out = triage.build_digest(rows, [appeal()], NOW)
        self.assertIn("2 open reports", out)
        self.assertIn("1 open appeals", out)
        self.assertIn("Overdue (past 72 h): 1", out)
        # Oldest item first in the open list.
        self.assertLess(out.index("rw-0002"), out.index("rw-0001"))

    def test_emails_are_masked_by_default(self):
        out = triage.build_digest([report()], [], NOW)
        self.assertNotIn("student@example.com", out)
        self.assertIn("s***@example.com", out)
        shown = triage.build_digest([report()], [], NOW, redact=False)
        self.assertIn("student@example.com", shown)

    def test_repeated_question_and_reporter_are_grouped(self):
        rows = [report(), report(id="r3", details="also wrong")]
        out = triage.build_digest(rows, [], NOW)
        self.assertIn("Questions reported more than once", out)
        self.assertIn("x 2", out)
        self.assertIn("Reporters with multiple open reports", out)

    def test_digest_is_plain_ascii(self):
        # Windows consoles default to cp1252; a decorative glyph must never
        # replace the brief or crash the run.
        out = triage.build_digest([report(), report(id="r3")], [appeal()], NOW)
        self.assertTrue(all(ord(ch) < 128 for ch in out), "digest must be ASCII")

    def test_reply_columns_only_name_real_table_columns(self):
        self.assertIn("question_id", triage.reply_columns("report"))
        self.assertNotIn("question_id", triage.reply_columns("appeal"))
        # Every reply needs the sender and the status it moves to in_review.
        for kind in ("report", "appeal"):
            self.assertIn("user_id", triage.reply_columns(kind))
            self.assertIn("status", triage.reply_columns(kind))

    def test_closed_rows_do_not_appear_as_open(self):
        out = triage.build_digest([report(status="resolved")], [], NOW)
        self.assertIn("Queue is clear", out)

    def test_groups(self):
        groups = triage.group_reports([report(), report(reason="mistagged", question_id="m-1")])
        self.assertEqual(groups["by_reason"], {"incorrect_answer": 1, "mistagged": 1})
        self.assertEqual(groups["by_question"]["rw-0001"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)

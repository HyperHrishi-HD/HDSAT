#!/usr/bin/env python3
"""Merge the R2-M10 Reading & Writing expansion into the shipped bank.

The shipped `src/data/questionBank.json` is the source of truth for guest mode
and for what students already see. Rebuilding it from the expansion files would
move hundreds of existing items, so this script only ever *adds*:

  1. loads the current bank unchanged,
  2. loads `expansion/extra_rw_m10.json`,
  3. refuses any item whose id or stimulus+prompt already exists,
  4. runs the content QA gate over the incoming items (errors block the merge),
  5. shuffles each new item's choices deterministically, as the importer does,
  6. writes the bank with a new version and regenerates a seed file that
     contains only the new rows (idempotent upserts).

Usage:
    python supabase/import/merge_bank_m10.py --dry-run
    python supabase/import/merge_bank_m10.py
# A later batch reuses the same merge with its own inputs and seed file:
    python supabase/import/merge_bank_m10.py \
        --incoming expansion/extra_rw_m10b.json \
        --seed 0003_m10b_rw_expansion.sql \
        --version 2026.10.30-open-core-5
"""

import argparse
import collections
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tools"))

import import_questions as iq  # noqa: E402
import content_qa  # noqa: E402

BANK = ROOT / "src" / "data" / "questionBank.json"
INCOMING = HERE / "expansion" / "extra_rw_m10.json"
SEED_OUT = ROOT / "supabase" / "seed" / "0002_m10_rw_expansion.sql"
NEW_VERSION = "2026.10.27-open-core-4"
DEFAULT_SEED_NAME = "0002_m10_rw_expansion.sql"


def stem(question):
    return (
        (question.get("stimulus") or "").strip()
        + "||"
        + (question.get("prompt") or "").strip()
        + "||"
        + json.dumps(question.get("figure_metadata") or {}, sort_keys=True)
    )


def seed_for(records, sources):
    """Seed SQL for question rows only, reusing the importer's escaping."""
    source_index = iq._source_index(sources)
    lines = [
        "-- HDSAT Reading & Writing expansion (generated)",
        f"-- generated_at: {datetime.now(timezone.utc).isoformat()}",
        "-- Idempotent upserts; applies only the new items.",
        "",
        "BEGIN;",
        "",
    ]
    for q in records:
        source = source_index[q["source_id"]]
        lines.append(
            "INSERT INTO public.questions (id, external_id, assessments, section, domain, skill, difficulty, "
            "format, stimulus, prompt, choices, figure_metadata, source_id, source_name, license, attribution, "
            "is_released_practice_set, status) VALUES ("
            f"{iq._sql_str(q['id'])}, {iq._sql_str(q.get('external_id'))}, "
            f"{iq._sql_array(q.get('assessments', []))}, {iq._sql_str(q['section'])}, "
            f"{iq._sql_str(q['domain'])}, {iq._sql_str(q['skill'])}, {iq._sql_str(q['difficulty'])}, "
            f"{iq._sql_str(q['format'])}, {iq._sql_str(q.get('stimulus'))}, {iq._sql_str(q['prompt'])}, "
            f"{iq._sql_json(q.get('choices')) if q.get('choices') else 'NULL'}, "
            f"{iq._sql_json(q.get('figure_metadata')) if q.get('figure_metadata') else 'NULL'}, "
            f"{iq._sql_str(q['source_id'])}, {iq._sql_str(source['name'])}, {iq._sql_str(source['license'])}, "
            f"{iq._sql_str(q.get('attribution') or source['name'] + ' (' + source['license'] + ')')}, "
            f"{str(bool(q.get('is_released_practice_set', source['is_released_practice_set']))).upper()}, 'active') "
            "ON CONFLICT (id) DO UPDATE SET external_id = EXCLUDED.external_id, "
            "assessments = EXCLUDED.assessments, section = EXCLUDED.section, domain = EXCLUDED.domain, "
            "skill = EXCLUDED.skill, difficulty = EXCLUDED.difficulty, format = EXCLUDED.format, "
            "stimulus = EXCLUDED.stimulus, prompt = EXCLUDED.prompt, choices = EXCLUDED.choices, "
            "figure_metadata = EXCLUDED.figure_metadata, source_id = EXCLUDED.source_id, "
            "source_name = EXCLUDED.source_name, license = EXCLUDED.license, "
            "attribution = EXCLUDED.attribution, "
            "is_released_practice_set = EXCLUDED.is_released_practice_set, status = 'active';"
        )
        lines.append(
            "INSERT INTO public.question_keys (question_id, correct_answer, acceptable_answers, explanation, "
            "distractor_rationales) VALUES ("
            f"{iq._sql_str(q['id'])}, {iq._sql_str(q.get('correct_answer'))}, "
            f"{iq._sql_array(q.get('acceptable_answers', []))}, {iq._sql_str(q.get('explanation', ''))}, "
            f"{iq._sql_json(q.get('distractor_rationales') or {})}) "
            "ON CONFLICT (question_id) DO UPDATE SET correct_answer = EXCLUDED.correct_answer, "
            "acceptable_answers = EXCLUDED.acceptable_answers, explanation = EXCLUDED.explanation, "
            "distractor_rationales = EXCLUDED.distractor_rationales;"
        )
    lines.append("")
    lines.append("COMMIT;")
    lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--incoming",
        default=str(INCOMING),
        help="expansion JSON to merge (default: the first R&W batch)",
    )
    parser.add_argument(
        "--seed",
        default=DEFAULT_SEED_NAME,
        help="file name under supabase/seed for the new rows",
    )
    parser.add_argument("--version", default=NEW_VERSION, help="bank_version to write")
    args = parser.parse_args()
    incoming_path = pathlib.Path(args.incoming)
    if not incoming_path.is_absolute():
        incoming_path = HERE / incoming_path
    seed_path = ROOT / "supabase" / "seed" / args.seed

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    existing = bank["questions"]
    sources = [dict(s) for s in bank["sources"]]
    incoming = json.loads(incoming_path.read_text(encoding="utf-8"))["questions"]
    print(f"bank: {len(existing)} items; incoming: {len(incoming)} from {incoming_path.name}")

    known_ids = {q["id"] for q in existing}
    known_stems = {stem(q) for q in existing}
    fresh, updates, skipped_ids, skipped_stems = [], {}, 0, 0
    for q in incoming:
        if q["id"] in known_ids:
            # Re-running after a content fix replaces this expansion's own rows
            # rather than skipping them; anything from the shipped bank is
            # never overwritten.
            if str(q["id"]).startswith("RW-M10"):
                updates[q["id"]] = dict(q)
            else:
                skipped_ids += 1
            continue
        if stem(q) in known_stems:
            skipped_stems += 1
            continue
        q = dict(q)
        q.setdefault("external_id", "HDSAT-" + q["id"])
        if "trigonometr" in str(q.get("skill", "")).lower():
            q["assessments"] = [a for a in q.get("assessments", []) if a != "PSAT 8/9"]
        q.setdefault(
            "assessments", ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"]
        )
        q = iq.deterministic_shuffle(q)
        known_ids.add(q["id"])
        known_stems.add(stem(q))
        fresh.append(q)

    print(f"fresh: {len(fresh)} (skipped {skipped_ids} duplicate ids, {skipped_stems} duplicate stems)")

    if updates:
        for old_id, replacement in updates.items():
            if "trigonometr" in str(replacement.get("skill", "")).lower():
                replacement["assessments"] = [
                    a for a in replacement.get("assessments", []) if a != "PSAT 8/9"
                ]
            replacement.setdefault("external_id", "HDSAT-" + old_id)
            replacement = iq.deterministic_shuffle(replacement)
            updates[old_id] = replacement
        fresh.extend(updates.values())

    # The QA gate reads item-level licence and attribution, which the client
    # record builder attaches from the source row.
    public_new = [iq._public_record(q, sources) for q in fresh]
    fresh_public = [q for q in public_new if q["id"] not in updates]
    updated_public = {q["id"]: q for q in public_new if q["id"] in updates}
    report = content_qa.check_bank(
        {"questions": public_new, "sources": sources, "bank_version": args.version},
        bank_path=str(incoming_path),
        sample=8,
        max_near_duplicates=20,
    )
    print(f"QA on incoming: {report.errors} error(s), {report.warnings} warning(s)")
    for issue in report.issues:
        print(f"  {issue['severity']}: {issue['category']} ({issue['count']}) {issue['ids'][:3]}")
    if report.errors:
        sys.exit("incoming items did not pass the QA gate; nothing written")

    by_skill = collections.Counter(q["skill"] for q in fresh)
    for skill, count in sorted(by_skill.items()):
        print(f"  {skill}: {count}")

    merged = [updated_public.get(q["id"], q) for q in existing] + fresh_public
    by_section = collections.Counter(q["section"] for q in merged)
    print(f"merged bank: {len(merged)} items {dict(by_section)}")

    seed = seed_for(public_new, sources)
    if args.dry_run:
        print(f"dry run: would write {BANK} and {seed_path} ({len(seed):,} bytes)")
        return

    counts = collections.Counter(q["source_id"] for q in merged)
    bank["bank_version"] = args.version
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    bank["sources"] = [
        {**s, "record_count": counts.get(s["source_id"], 0)} for s in sources
    ]
    bank["questions"] = merged
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    seed_path.parent.mkdir(parents=True, exist_ok=True)
    seed_path.write_text(seed, encoding="utf-8")
    print(f"wrote {BANK} ({BANK.stat().st_size:,} bytes)")
    print(f"wrote {seed_path} ({len(seed):,} bytes)")


if __name__ == "__main__":
    main()

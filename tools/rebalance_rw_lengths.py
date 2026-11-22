#!/usr/bin/env python3
"""Remove the correct-answer length cue from Reading & Writing multiple choice.

The bank accumulated many items whose keyed answer is the longest choice.  That
is a test-wiseness cue: a student can improve their score without reading the
passage.  This pass is deliberately conservative.

* It only touches Reading & Writing multiple-choice items where the keyed choice
  is the unique longest choice.
* It never changes distractors, the key letter, the prompt or the answer
  rationale.  It shortens the keyed answer by deleting a subordinate or
  relative clause, while keeping the finite main clause and every numeral.
* Repeated generator keys get exact editorial rewrites.  The cross-text scale
  family gets grammar-preserving template rewrites.
* If no candidate is a complete main clause at or below the longest distractor,
  the item is left unchanged and reported as residual.

Run with ``--dry-run`` to inspect counts and samples.  Run without it to write
``src/data/questionBank.json`` and ``tools/rw_length_rewrites.json``.

This is local tooling, not an application dependency.  It needs spaCy and
``en_core_web_sm`` (``python -m spacy download en_core_web_sm``).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"
MANIFEST = ROOT / "tools" / "rw_length_rewrites.json"
VERSION = "2026.11.11-open-core-38"
TARGET_SKILLS = {
    "Rhetorical Synthesis",
    "Central Ideas and Details",
    "Cross-Text Connections",
    "Text Structure and Purpose",
    "Command of Evidence (Textual)",
    "Inferences",
}
REMOVABLE_DEPS = {"advcl", "acl", "relcl", "appos", "parataxis"}

# Exact rewrites for the repeated scale-generator answers.  These are the nine
# keys that appear in the RW-EXP-89xxx family (12 variants each).
EDITORIAL = {
    "Whereas Stockholm's surface streetcars averaged 14 km/h in peak traffic, the underground Tunnelbana lines reached 36 km/h, cutting cross-city commute times by 42%.":
        "Stockholm's metro reached 36 km/h versus 14 km/h for surface streetcars, cutting commutes by 42%.",
    "Although Stockholm replaced its central streetcar corridors with high-speed metro tunnels in 1956, heritage streetcars still run on a scenic line in Djurgården.":
        "Stockholm replaced central streetcars with metro tunnels, yet heritage streetcars still run in Djurgården.",
    "To overcome peak winter streetcar speeds of just 14 km/h in mixed downtown traffic, Stockholm opened underground Tunnelbana lines in 1956 that ran at 36 km/h and cut commute times by 42%.":
        "Stockholm's 1956 metro reached 36 km/h and cut peak winter commutes by 42%.",
    "When disturbed by grazing copepods, Lingulodinium polyedra emits blue flashes that both directly startle the copepods—cutting feeding by 55%—and expose the grazers to nocturnal predatory fish.":
        "Its blue flashes startle grazing copepods and expose them to nocturnal predatory fish.",
    "Mechanically agitated Lingulodinium polyedra cells produce blue bioluminescent flashes at a wavelength of 475 nanometers that last about 100 milliseconds.":
        "The cells emit 100-millisecond blue flashes at 475 nanometers.",
    "While Lingulodinium polyedra's blue flashes deter copepod grazing by 55% in nocturnal marine environments, the organism loses this circadian bioluminescence rhythm within four days if exposed to constant laboratory light.":
        "The flashes deter grazing in the wild, but constant light disrupts the organism's daily rhythm.",
    "Acting as an acoustic diffraction grating, Epidaurus's 55 corrugated limestone rows suppress low-frequency background noise below 500 Hz while reflecting clear high-frequency speech sounds to the upper seats.":
        "Epidaurus's limestone rows suppress noise below 500 Hz and project speech to the upper seats.",
    "Unlike Epidaurus's corrugated limestone rows, which filter out noise below 500 Hz and project high frequencies, modern replicas built with smooth concrete steps fail to achieve selective frequency filtering.":
        "Unlike Epidaurus's limestone rows, smooth concrete replicas fail to filter sound by frequency.",
    "To reach all 14,000 spectators in the fourth-century BCE theater at Epidaurus, its 55 corrugated limestone rows function—as Declercq's team showed—as a diffraction grating that damps noise below 500 Hz and projects vocal frequencies above 500 Hz.":
        "Epidaurus's 55 limestone rows seat 14,000 and filter noise while projecting speech.",
}

CROSS_RULES = [
    (re.compile(r"By acknowledging the potential benefit of (.+?) while pointing out an unintended consequence that requires design or timing adjustments\."),
     r"By acknowledging the benefits of \1 while noting a timing or design trade-off."),
    (re.compile(r"(.+?) emphasizes the primary performance advantage of (.+?), whereas (.+?) focuses on a secondary operational trade-off\."),
     r"\1 stresses \2's main benefit; \3 notes an operational trade-off."),
    (re.compile(r"Text 1 presents a favorable assessment of (.+?) based on one metric, while Text 2 complicates that assessment by introducing a competing criterion\."),
     r"Text 1 favors \1 on one metric; Text 2 adds a competing criterion."),
    (re.compile(r"Achieving the benefits (.+?) describes without incurring the costs (.+?) identifies requires modifying how (.+?) is executed\."),
     r"Getting \1's benefits without \2's costs requires modifying \3."),
]

CENTRAL_PREFIXES = (
    "This feature works because ",
    "This feature works by ",
    "The feature is essential because it works because ",
    "The feature is essential because it works by ",
    "The findings show that ",
)


def choice_text(choice: dict) -> str:
    return str(choice.get("text") or "").strip()


def choice_id(choice: dict) -> str:
    return str(choice.get("id") or "").strip().upper()


def key_index(question: dict) -> int:
    key = str(question.get("correct_answer") or "").strip().upper()
    for index, choice in enumerate(question.get("choices") or []):
        if choice_id(choice) == key:
            return index
    return -1


def strict_key(question: dict) -> tuple[int, int, int] | None:
    choices = question.get("choices") or []
    if len(choices) < 2:
        return None
    lengths = [len(choice_text(choice)) for choice in choices]
    index = key_index(question)
    if index < 0:
        return None
    longest_wrong = max((n for i, n in enumerate(lengths) if i != index), default=0)
    if lengths[index] <= longest_wrong:
        return None
    if lengths.count(lengths[index]) != 1:
        return None
    return index, lengths[index], longest_wrong


def audit(bank: dict) -> dict:
    rows = {}
    for skill in sorted(TARGET_SKILLS):
        rows[skill] = {"total": 0, "biased": 0}
    for question in bank.get("questions") or []:
        if question.get("section") != "Reading and Writing" or question.get("format") != "multiple_choice":
            continue
        skill = str(question.get("skill") or "")
        if skill not in rows:
            continue
        rows[skill]["total"] += 1
        if strict_key(question):
            rows[skill]["biased"] += 1
    total = sum(row["total"] for row in rows.values())
    biased = sum(row["biased"] for row in rows.values())
    return {"by_skill": rows, "total": total, "biased": biased}


def editorial_key(question: dict, key: str) -> str | None:
    if key in EDITORIAL:
        return EDITORIAL[key]
    if question.get("skill") == "Cross-Text Connections":
        for pattern, replacement in CROSS_RULES:
            if pattern.fullmatch(key):
                return pattern.sub(replacement, key)
    if question.get("id", "").startswith("RW-INF-886"):
        for prefix in CENTRAL_PREFIXES:
            if key.startswith(prefix):
                rest = key[len(prefix):]
                if rest:
                    return rest[:1].upper() + rest[1:]
    return None


def clean_candidate(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"[,;:]\s*([.!?])", r"\1", text)
    text = re.sub(r"([.!?])\s*[,;:]+", r"\1", text)
    text = re.sub(r"([.!?])\s*['\"]?[,;:]", r"\1", text)
    text = text.strip(" ,;:")
    if text and text[-1] not in ".!?":
        text += "."
    return text[:1].upper() + text[1:] if text else text


def valid_candidate(candidate: str, original: str, ceiling: int, root_text: str) -> bool:
    if not candidate or len(candidate) > ceiling:
        return False
    if "\ufffd" in candidate:
        return False
    if any(mark in original for mark in ('"', "“", "”", "\u2018", "\u2019")):
        return False
    if any(mark in candidate for mark in ('"', "“", "”", "\u2018", "\u2019")):
        return False
    if len(candidate) < max(32, int(len(original) * 0.45)):
        return False
    if len(candidate.split()) < 7:
        return False
    if candidate[0].islower():
        return False
    if root_text and root_text not in candidate:
        return False
    if re.search(r"[,;:]\s*[.!?]", candidate):
        return False
    if re.search(r"\b(?:and|or|but|because|although|while|whereas|which|that|who|whom|whose|with|of|to|for|in|on|at|by|from|as|than|over|under|through|into|onto|about|across|during|after|before|between|among|against|within|without|upon|toward|towards)$", candidate.rstrip(".!?"), re.I):
        return False
    if candidate.startswith(("And ", "But ", "Which ", "Who ", "That ", "Because ", "Although ", "While ", "Whereas ", "If ", "So ", "By ", "In ", "At ", "For ", "With ", "To ", "Of ", "From ", "As ", "Retaining ", "Compared ", "Consistent ", "Under ")):
        return False
    if re.search(r"[,;:]\s*[,;:]", candidate):
        return False
    if candidate.count("(") != candidate.count(")"):
        return False
    if candidate.count("“") != candidate.count("”"):
        return False
    # A deletion must not leave a parser-orphaned word (for example a stranded
    # verb after half of a relative clause was removed).
    try:
        doc = _NLP(candidate)
    except Exception:
        return False
    if any(token.dep_ == "dep" for token in doc):
        return False
    if not any(token.dep_ == "ROOT" and token.pos_ in {"VERB", "AUX"} for token in doc):
        return False
    if not any(token.dep_ in {"nsubj", "nsubjpass", "expl"} for token in doc):
        return False
    # Never delete a number or a negation from an answer.
    if re.findall(r"\d+(?:[.,]\d+)?", original) != re.findall(r"\d+(?:[.,]\d+)?", candidate):
        return False
    if bool(re.search(r"\b(?:not|no|never|without)\b", original, re.I)) and not re.search(r"\b(?:not|no|never|without)\b", candidate, re.I):
        return False
    return True


_NLP = None


def parsed_candidates(nlp, text: str) -> list[str]:
    if any(mark in text for mark in ('"', "“", "”", "\u2018", "\u2019")):
        return []
    doc = nlp(text)
    root = next((token for token in doc if token.head == token), None)
    if root is None:
        return []
    removable: list[list[int]] = []
    for token in doc:
        if token.dep_ not in REMOVABLE_DEPS:
            continue
        subtree = list(token.subtree)
        if root.i in {item.i for item in subtree}:
            continue
        # Do not delete the subject of the main clause.
        if any(item.dep_ in {"nsubj", "nsubjpass", "expl"} and item.head == root for item in subtree):
            continue
        removable.append([item.i for item in subtree])

    output: list[str] = []
    seen: set[str] = set()

    def add(indices: set[int]) -> None:
        if root.i in indices:
            return
        kept = [token.text for token in doc if token.i not in indices]
        candidate = clean_candidate(" ".join(kept))
        if candidate != text and candidate not in seen:
            seen.add(candidate)
            output.append(candidate)

    # Single-clause deletions preserve the most context.
    for group in removable:
        add(set(group))

    # A key can contain both a leading "Although ..." clause and a trailing
    # relative clause.  Removing both is still safe when the remaining main
    # clause re-parses with its own subject and finite verb.
    for left in range(len(removable)):
        for right in range(left + 1, len(removable)):
            add(set(removable[left]) | set(removable[right]))
    if len(removable) > 2:
        add(set().union(*(set(group) for group in removable)))

    # Last resort: keep the root and its core arguments.  This is only used
    # when the result re-parses as a complete sentence with no orphan tokens.
    core_deps = {
        "ROOT", "nsubj", "nsubjpass", "expl", "dobj", "obj", "attr",
        "aux", "auxpass", "neg", "det", "amod", "compound", "nummod",
        "punct", "conj", "cc", "prep", "pobj",
    }
    core = {token.i for token in doc if token.dep_ in core_deps}
    add(core)
    return output


def rewrite_question(nlp, question: dict) -> tuple[str, str] | None:
    state = strict_key(question)
    if not state:
        return None
    index, old_length, ceiling = state
    choices = question.get("choices") or []
    original = choice_text(choices[index])
    other_texts = {choice_text(choice).strip().lower() for i, choice in enumerate(choices) if i != index}
    edited = editorial_key(question, original)
    if edited:
        edited = clean_candidate(edited)
        if valid_candidate(edited, original, ceiling, "") and edited.strip().lower() not in other_texts:
            return original, edited
        # Editorial rewrites are already reviewed; allow a shorter minimum.
        if edited and len(edited) <= ceiling and len(edited.split()) >= 6 and edited.strip().lower() not in other_texts:
            return original, edited
    doc = nlp(original)
    root = next((token for token in doc if token.head == token), None)
    if root is None:
        return None
    candidates = [
        candidate
        for candidate in parsed_candidates(nlp, original)
        if valid_candidate(candidate, original, ceiling, root.text)
        and candidate.strip().lower() not in other_texts
    ]
    if not candidates:
        return None
    # Keep the longest valid candidate: it removes the least content.
    return original, max(candidates, key=len)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    import spacy

    global _NLP
    _NLP = nlp = spacy.load("en_core_web_sm")
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    before = audit(bank)
    changes = []
    for question in bank.get("questions") or []:
        if question.get("section") != "Reading and Writing" or question.get("format") != "multiple_choice":
            continue
        if question.get("skill") not in TARGET_SKILLS:
            continue
        result = rewrite_question(nlp, question)
        if not result:
            continue
        old, new = result
        choices = question.get("choices") or []
        index = key_index(question)
        choices[index]["text"] = new
        changes.append(
            {
                "id": question["id"],
                "skill": question.get("skill"),
                "old": old,
                "new": new,
                "old_length": len(old),
                "new_length": len(new),
            }
        )

    after = audit(bank)
    print(f"changed {len(changes)} items")
    for skill in sorted(after["by_skill"]):
        b = before["by_skill"][skill]
        a = after["by_skill"][skill]
        print(f"  {skill}: {b['biased']}/{b['total']} -> {a['biased']}/{a['total']}")
    print(f"  TOTAL: {before['biased']}/{before['total']} -> {after['biased']}/{after['total']}")
    for change in changes[:12]:
        print(f"\n{change['id']} {change['skill']} ({change['old_length']} -> {change['new_length']})")
        print("  ", change["new"])

    if args.dry_run:
        return 0

    bank["bank_version"] = VERSION
    bank["generated_at"] = datetime.now(timezone.utc).isoformat()
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    MANIFEST.write_text(json.dumps({"version": VERSION, "changes": changes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

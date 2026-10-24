#!/usr/bin/env python3
"""Add the R2-M11 flashcards to the shipped deck without touching existing ones.

The vocabulary corpus is already fully used (all 1,615 CC0 words are in the
deck), so the vocabulary additions are new authored words only; the script
skips any word already present. Math cards are new formula references.

Writes src/data/flashcards.json and a seed file with only the new cards.
"""

import json
import pathlib
import re
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import import_questions as iq  # noqa: E402

DECK = ROOT / "src" / "data" / "flashcards.json"
INCOMING = HERE / "data" / "m10" / "deck_extra.json"
SEED_OUT = ROOT / "supabase" / "seed" / "0003_m11_flashcards.sql"


def next_number(cards, prefix):
    numbers = [
        int(m.group(1))
        for card in cards
        if (m := re.match(rf"^{prefix}-(\d+)$", str(card.get("id", ""))))
    ]
    return max(numbers, default=0) + 1


def word_of(card):
    return str(card.get("front", "")).split(" (")[0].strip().lower()


def seed_for(cards):
    lines = [
        "-- HDSAT R2-M11 flashcard additions (generated)",
        f"-- generated_at: {datetime.now(timezone.utc).isoformat()}",
        "BEGIN;",
        "",
    ]
    for card in cards:
        # The schema stores the deck as vocabulary|formula, not the client id.
        deck_type = "formula" if card["deck"] == "math_formula" else "vocabulary"
        category = (card.get("tags") or ["formula"])[0]
        lines.append(
            "INSERT INTO public.flashcards (id, deck_type, category, front_prompt, part_of_speech, "
            "back_definition, example_or_application, synonyms_or_related, source_attribution) VALUES ("
            f"{iq._sql_str(card['id'])}, {iq._sql_str(deck_type)}, {iq._sql_str(category)}, "
            f"{iq._sql_str(card['front'])}, NULL, {iq._sql_str(card['back'])}, "
            f"{iq._sql_str(card.get('latex'))}, {iq._sql_array(card.get('tags', []))}, "
            f"{iq._sql_str('HDSAT Study Deck (CC-BY-4.0)')}) "
            "ON CONFLICT (id) DO UPDATE SET deck_type = EXCLUDED.deck_type, "
            "category = EXCLUDED.category, front_prompt = EXCLUDED.front_prompt, "
            "back_definition = EXCLUDED.back_definition, "
            "example_or_application = EXCLUDED.example_or_application, "
            "synonyms_or_related = EXCLUDED.synonyms_or_related;"
        )
    lines += ["", "COMMIT;", ""]
    return "\n".join(lines)


def main():
    deck = json.loads(DECK.read_text(encoding="utf-8"))
    cards = deck["cards"]
    incoming = json.loads(INCOMING.read_text(encoding="utf-8"))

    known_words = {word_of(c) for c in cards if c["deck"] == "vocabulary"}
    known_titles = {str(c["front"]).strip().lower() for c in cards if c["deck"] == "math_formula"}

    added = []
    # Rows to (re)apply to the database: the new cards plus any previous M11
    # card already merged into the deck, so re-running always produces a
    # complete seed file.
    seed_cards = []
    skipped = 0
    math_number = next_number(cards, "F")
    vocab_number = next_number(cards, "V")
    by_title = {str(c["front"]).strip().lower(): c for c in cards if c["deck"] == "math_formula"}
    by_word = {
        word_of(c): c for c in cards if c["deck"] == "vocabulary"
    }

    for item in incoming.get("math", []):
        title = str(item["front"]).strip()
        if title.lower() in known_titles:
            skipped += 1
            existing = by_title.get(title.lower())
            if existing:
                seed_cards.append(existing)
            continue
        known_titles.add(title.lower())
        added.append(
            {
                "id": f"F-{math_number:03d}",
                "deck": "math_formula",
                "front": title,
                "latex": item.get("latex", ""),
                "back": str(item["back"]).strip(),
                "tags": item.get("tags", ["formula"]),
            }
        )
        math_number += 1

    for item in incoming.get("vocabulary", []):
        word = str(item["word"]).strip()
        if word.lower() in known_words:
            skipped += 1
            existing = by_word.get(word.lower())
            # Only this expansion's authored cards (V-036 onward) belong in the
            # M11 seed; the CC0 corpus is part of the main seed.
            if existing and existing["id"].startswith("V-") and int(existing["id"][2:]) >= 36:
                seed_cards.append(existing)
            continue
        known_words.add(word.lower())
        pos = str(item.get("pos", "")).strip()
        added.append(
            {
                "id": f"V-{vocab_number:04d}",
                "deck": "vocabulary",
                "front": f"{word} ({pos})" if pos else word,
                "back": str(item["definition"]).strip(),
                "tags": ["vocabulary"],
            }
        )
        vocab_number += 1

    print(f"deck: {len(cards)} cards; adding {len(added)} (skipped {skipped} already present)")
    for card in added[:3] + added[-3:]:
        print(f"  {card['id']}  {card['front']}")

    seed = seed_for(seed_cards + added)
    deck["cards"] = cards + added
    DECK.write_text(json.dumps(deck, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    SEED_OUT.write_text(seed, encoding="utf-8")
    print(f"wrote {DECK} ({len(deck['cards'])} cards)")
    print(f"wrote {SEED_OUT} ({len(seed_cards) + len(added)} card upserts, {len(seed):,} bytes)")


if __name__ == "__main__":
    main()

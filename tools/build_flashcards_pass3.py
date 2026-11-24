#!/usr/bin/env python3
"""Build the Pass 3 flashcard decks from licensed, local sources.

The source CSVs and Open English WordNet JSON are downloaded into an ignored
cache. The generated src/data/flashcards.json is the committed artifact; raw
downloads never enter git. Run with:

    python tools/build_flashcards_pass3.py \
      --wordnet-dir "C:/Users/venky/AppData/Local/Temp/oewn"

If --wordnet-dir is omitted the script downloads and extracts the official
2025 JSON zip into tools/.flashcard-cache.
"""

from __future__ import annotations

import argparse
import bz2
import csv
import html
import io
import json
import re
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tools" / ".flashcard-cache"
FLASHCARDS = ROOT / "src" / "data" / "flashcards.json"
OFFICIAL_BANK = ROOT / "public" / "collegeBoardBank.json"

NAWL_URL = "https://www.newgeneralservicelist.com/s/NAWL_12_lemmatized_for_teaching.csv"
NGSL_URL = "https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv"
WORDNET_URL = "https://en-word.net/static/english-wordnet-2025-json.zip"
TATOEBA_URL = "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2"

POS_NAMES = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
POS_ORDER = ("n", "v", "a", "s", "r")


def download(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    print(f"download {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "HDSAT-flashcard-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())
    return destination


def ensure_wordnet(directory: Path | None) -> Path:
    if directory:
        return directory
    target = CACHE / "oewn-2025-json"
    if target.exists() and any(target.glob("entries-*.json")):
        return target
    archive = download(WORDNET_URL, CACHE / "english-wordnet-2025-json.zip")
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(target)
    # The archive can contain a nested directory in some releases.
    candidates = [target, *target.iterdir()]
    for candidate in candidates:
        if candidate.is_dir() and any(candidate.glob("entries-*.json")):
            return candidate
    return target


def read_csv(url: str, name: str) -> bytes:
    return download(url, CACHE / name).read_bytes()


def decode_csv(raw: bytes) -> str:
    # NAWL is distributed as Windows-1252; NGSL is UTF-8. Keep both readable
    # without silently replacing accented headwords.
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_nawl(raw: bytes) -> list[tuple[str, list[str]]]:
    rows: list[tuple[str, list[str]]] = []
    for row in csv.reader(io.StringIO(decode_csv(raw))):
        if not row or not row[0].strip():
            continue
        rows.append((row[0].strip().lower(), [cell.strip() for cell in row if cell.strip()]))
    return rows


def parse_ngsl(raw: bytes) -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    reader = csv.DictReader(io.StringIO(decode_csv(raw)))
    for row in reader:
        lemma = (row.get("Lemma") or "").strip().lower()
        rank = (row.get("SFI Rank") or "").strip()
        if not lemma or not rank.isdigit():
            continue
        value = int(rank)
        if value > 500:
            rows.append((lemma, value))
    return rows


def clean_html(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = html.unescape(re.sub(r"<[^>]+>", " ", value))
    return re.sub(r"\s+", " ", text).strip()


def first_text(values: Any) -> str:
    if not isinstance(values, list):
        return ""
    for value in values:
        if isinstance(value, str):
            cleaned = clean_html(value)
        elif isinstance(value, dict):
            cleaned = clean_html(value.get("text") or value.get("definition") or "")
        else:
            cleaned = ""
        if cleaned:
            return cleaned
    return ""


def sentence_with_blank(stimulus: str | None) -> str:
    text = clean_html(stimulus)
    text = re.sub(r"_{2,}\s*blank\b", "______", text, flags=re.IGNORECASE)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chosen = next((sentence for sentence in sentences if "______" in sentence), sentences[0] if sentences else text)
    chosen = re.sub(r"\s+", " ", chosen).strip()
    if len(chosen) > 430:
        chosen = chosen[:427].rstrip() + "..."
    return chosen


def load_tatoeba(words: set[str]) -> dict[str, str]:
    """Return the first short CC0 English sentence containing each word.

    Only the requested words are indexed. The bz2 export is streamed rather
    than extracted, and the cache stays under the ignored tools cache folder.
    """
    if not words:
        return {}
    try:
        archive = download(TATOEBA_URL, CACHE / "eng_sentences.tsv.bz2")
        found: dict[str, str] = {}
        with bz2.open(archive, "rt", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if "\t" not in line:
                    continue
                columns = line.rstrip("\n").split("\t")
                if len(columns) < 2:
                    continue
                # Tatoeba's per-language export is id<TAB>lang<TAB>sentence.
                sentence = columns[-1]
                if not (18 <= len(sentence) <= 180):
                    continue
                tokens = set(re.findall(r"[a-z][a-z'-]*", sentence.lower()))
                for word in tokens & words:
                    if word not in found:
                        found[word] = sentence
                if len(found) == len(words):
                    break
        print(f"Tatoeba examples: {len(found)} of {len(words)} missing WordNet words")
        return found
    except Exception as error:  # network/format failure must not block the build
        print(f"Tatoeba unavailable ({error}); using original examples")
        return {}


class WordNet:
    def __init__(self, directory: Path):
        self.directory = directory
        self.entries: dict[str, dict[str, Any]] = {}
        self.tatoeba: dict[str, str] = {}
        for path in sorted(directory.glob("entries-*.json")):
            with path.open(encoding="utf-8") as handle:
                self.entries.update(json.load(handle))

    def lookup(self, word: str) -> tuple[str, str, str, str] | None:
        entry = self.entries.get(word.lower())
        if not entry:
            return None
        for pos in POS_ORDER:
            senses = entry.get(pos) or []
            if isinstance(senses, dict):
                senses = senses.get("sense") or []
            synset_id = senses[0].get("synset") if senses else None
            if not synset_id:
                continue
            synset = self.synsets.get(synset_id)
            if not synset:
                continue
            definitions = synset.get("definition") or []
            if not definitions:
                continue
            definition = first_text(definitions)
            if not definition:
                continue
            examples = synset.get("example") or []
            example = first_text(examples)
            # A synset example can belong to a synonym rather than the
            # headword itself ("trigger a reaction" for *activate*). For a
            # vocabulary card the sentence must contain the word the learner
            # is studying, so fall through to Tatoeba when it does not.
            if example and re.search(rf"\b{re.escape(word)}\b", example, re.IGNORECASE):
                source = "wordnet"
            else:
                example = self.tatoeba.get(word.lower(), "")
                source = "tatoeba" if example else ""
            return POS_NAMES.get(pos, pos), definition, example, source
        return None
    def load_synsets(self, ids: set[str]) -> None:
        self.synsets: dict[str, dict[str, Any]] = {}
        for path in sorted(self.directory.glob("*.json")):
            if path.name.startswith("entries-"):
                continue
            if path.name in {"frames.json", "lexicographer_ids.json"}:
                continue
            try:
                with path.open(encoding="utf-8") as handle:
                    data = json.load(handle)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if not isinstance(data, dict):
                continue
            for synset_id in ids:
                value = data.get(synset_id)
                if value:
                    self.synsets[synset_id] = value

    def collect_synset_ids(self, words: list[str]) -> set[str]:
        ids: set[str] = set()
        for word in words:
            entry = self.entries.get(word)
            if not entry:
                continue
            for pos in POS_ORDER:
                senses = entry.get(pos) or []
                if isinstance(senses, dict):
                    senses = senses.get("sense") or []
                for sense in senses:
                    if sense.get("synset"):
                        ids.add(sense["synset"])
        return ids


def existing_words(cards: list[dict[str, Any]]) -> set[str]:
    seen: set[str] = set()
    for card in cards:
        front = card.get("front", "")
        match = re.match(r"^(.+?)\s*\((?:noun|verb|adjective|adverb|noun/verb)\)$", front, re.IGNORECASE)
        seen.add((match.group(1) if match else front).strip().lower())
    return seen


def wordnet_cards(
    words: list[tuple[str, str, list[str]]],
    wordnet: WordNet,
    seen: set[str],
    deck: str,
    prefix: str,
    source_tag: str,
    extra_tag: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    cards: list[dict[str, Any]] = []
    skipped: list[str] = []
    for word, source_label, extra_tags in words:
        normalized = word.lower()
        if normalized in seen:
            continue
        result = wordnet.lookup(normalized)
        if not result:
            skipped.append(word)
            continue
        pos, definition, example, example_source = result
        example_source = example_source or "original"
        if not example:
            # WordNet does not carry an example for every sense. Generate a
            # short original usage sentence and label it, rather than inventing
            # an unmarked attribution or silently dropping the headword.
            # A metalinguistic frame stays grammatical for every part of speech
            # and for noun senses that are not naturally countable in a generic
            # template; the quoted word makes the example honest about its
            # original, non-corpus source.
            example = f'The class reviewed the word \u201c{word}\u201d during the vocabulary lesson.'
            example_source = "original"
        back = definition
        if example:
            separator = " " if definition.rstrip().endswith((".", "!", "?")) else ". "
            back += f"{separator}Example: \u201c{example}\u201d"
        cards.append(
            {
                "id": f"{prefix}-{len(cards) + 1:04d}",
                "deck": deck,
                "front": f"{word} ({pos})",
                "back": back,
                "source": f"{source_label} (CC BY-SA 4.0) + Open English WordNet 2025 (CC BY 4.0)",
                "example_source": example_source,
                "tags": [source_tag, extra_tag, *extra_tags],
            }
        )
        seen.add(normalized)
    return cards, skipped


def official_cards(wordnet: WordNet, seen: set[str]) -> list[dict[str, Any]]:
    if not OFFICIAL_BANK.exists():
        print(f"skip official Words-in-Context: {OFFICIAL_BANK} is not present")
        return []
    with OFFICIAL_BANK.open(encoding="utf-8") as handle:
        bank = json.load(handle)
    questions = bank.get("questions", []) if isinstance(bank, dict) else bank
    cards: list[dict[str, Any]] = []
    official_seen: set[str] = set()
    for question in questions:
        if question.get("skill") != "Words in Context":
            continue
        choices = question.get("choices") or []
        correct = next(
            (choice for choice in choices if choice.get("id") == question.get("correct_answer")),
            None,
        )
        if not correct:
            continue
        answer = clean_html(correct.get("text"))
        if not answer:
            continue
        target_word = answer.split()[0].strip(".,;:!?\"\u201c\u201d").lower()
        if target_word and target_word in official_seen:
            continue
        if target_word:
            official_seen.add(target_word)
        context = sentence_with_blank(question.get("stimulus"))
        explanation = clean_html(question.get("explanation"))
        if len(explanation) > 360:
            explanation = explanation[:357].rstrip() + "..."
        word = answer.split()[0].strip(".,;:!?\"\u201c\u201d")
        definition = wordnet.lookup(word.lower()) if word else None
        back = f"Official answer: {answer}."
        if explanation:
            back += f" {explanation}"
        if definition:
            back += f" WordNet: {definition[1]}"
        cards.append(
            {
                "id": f"CBW-{len(cards) + 1:04d}",
                "deck": "official_context",
                "front": f"Fill the blank: {context}",
                "back": back,
                "source": "College Board released Words-in-Context item (local deployment asset; not in the reference repo)",
                "example_source": "official-question",
                "tags": [
                    "official-context",
                    "words-in-context",
                    f"difficulty-{str(question.get('difficulty', 'unknown')).lower()}",
                    "college-board",
                ],
            }
        )
        seen.add(word.lower())
    return cards


def official_word_candidates() -> list[str]:
    if not OFFICIAL_BANK.exists():
        return []
    with OFFICIAL_BANK.open(encoding="utf-8") as handle:
        bank = json.load(handle)
    questions = bank.get("questions", []) if isinstance(bank, dict) else bank
    words: list[str] = []
    for question in questions:
        if question.get("skill") != "Words in Context":
            continue
        choices = question.get("choices") or []
        correct = next(
            (choice for choice in choices if choice.get("id") == question.get("correct_answer")),
            None,
        )
        if correct:
            answer = clean_html(correct.get("text"))
            word = answer.split()[0].strip(".,;:!?\"\u201c\u201d") if answer else ""
            if word:
                words.append(word.lower())
    return words


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wordnet-dir", type=Path, default=None)
    parser.add_argument(
        "--official-output",
        type=Path,
        default=ROOT / "public" / "officialContextCards.json",
    )
    args = parser.parse_args()

    wordnet_dir = ensure_wordnet(args.wordnet_dir)
    nawl_rows = parse_nawl(read_csv(NAWL_URL, "nawl.csv"))
    ngsl_rows = parse_ngsl(read_csv(NGSL_URL, "ngsl.csv"))

    with FLASHCARDS.open(encoding="utf-8") as handle:
        data = json.load(handle)
    # Rebuild only the generated decks; every pre-existing vocabulary and
    # formula card is preserved byte-for-byte. This also removes any stale
    # generated copy of the local-only official deck from an earlier run.
    cards: list[dict[str, Any]] = [
        card for card in data["cards"] if card.get("deck") in {"vocabulary", "math_formula"}
    ]
    seen = existing_words(cards)

    requested = (
        [word for word, _ in nawl_rows]
        + [word for word, _ in ngsl_rows]
        + official_word_candidates()
    )
    wordnet = WordNet(wordnet_dir)
    wordnet.load_synsets(wordnet.collect_synset_ids(requested))
    missing_examples: set[str] = set()
    for word in requested:
        result = wordnet.lookup(word.lower())
        # Load a Tatoeba sentence when WordNet has no example *or* when its
        # example belongs to a synonym instead of the headword.
        if result and (
            not result[2]
            or not re.search(rf"\b{re.escape(word)}\b", result[2], re.IGNORECASE)
        ):
            missing_examples.add(word.lower())
    wordnet.tatoeba = load_tatoeba(missing_examples)

    nawl_cards, nawl_skipped = wordnet_cards(
        [(word, "NAWL", ["academic-vocabulary"]) for word, _ in nawl_rows],
        wordnet,
        seen,
        "nawl",
        "NAWL",
        "nawl",
        "academic",
    )
    ngsl_cards, ngsl_skipped = wordnet_cards(
        [(word, "NGSL", [f"rank-{rank}"]) for word, rank in ngsl_rows],
        wordnet,
        seen,
        "ngsl",
        "NGSL",
        "ngsl",
        "general-vocabulary",
    )
    official = official_cards(wordnet, seen)

    existing_count = len(cards)
    cards.extend(nawl_cards)
    cards.extend(ngsl_cards)

    # Official prompts and rationales stay a deployment-side asset, matching
    # the existing collegeBoardBank.json policy: generated locally, ignored by
    # git, fetched by the app when present. The reference repo never carries
    # official question content.
    args.official_output.parent.mkdir(parents=True, exist_ok=True)
    with args.official_output.open("w", encoding="utf-8") as handle:
        json.dump(
            {
                "deck_version": "2026.11.23-pass3",
                "source": "College Board released Words-in-Context items",
                "cards": official,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )
        handle.write("\n")

    data["cards"] = cards
    data["deck_version"] = "2026.11.23-pass3"
    data["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    data["license"] = "Mixed: see vocabulary_sources; authored formulas and original cards are CC-BY-4.0."
    data["attribution"] = (
        "HDSAT Study Deck (CC-BY-4.0). NAWL and NGSL word lists (CC BY-SA 4.0); "
        "Open English WordNet 2025 definitions (CC BY 4.0); released College Board "
        "Words-in-Context items. Full attribution on the Credits page."
    )
    data["vocabulary_sources"] = [
        {
            "name": "New Academic Word List (NAWL)",
            "url": "https://www.newgeneralservicelist.com/new-general-service-list",
            "license": "CC BY-SA 4.0",
            "note": "Headwords from the 12th edition lemmatized teaching list; definitions and examples from Open English WordNet 2025.",
        },
        {
            "name": "New General Service List (NGSL), ranks beyond 500",
            "url": "https://www.newgeneralservicelist.com/new-general-service-list",
            "license": "CC BY-SA 4.0",
            "note": "Lemmas ranked beyond the first 500 by SFI Rank; definitions and examples from Open English WordNet 2025.",
        },
        {
            "name": "Open English WordNet 2025",
            "url": "https://en-word.net/",
            "license": "CC BY 4.0",
            "note": "Definitions and usage examples. WordNet 3.0 is the underlying Princeton WordNet database, also CC BY 4.0.",
        },
        {
            "name": "Tatoeba English sentence export",
            "url": TATOEBA_URL,
            "license": "CC0 1.0",
            "note": "CC0 example sentences used when the selected WordNet sense has no suitable headword-containing example; only short sentences containing the exact headword.",
        },
        {
            "name": "College Board Official SAT Question Bank \u2014 Words in Context",
            "url": "https://satsuiteeducatorquestionbank.collegeboard.org/",
            "license": "College Board public question bank",
            "note": "Released official Words-in-Context prompts, answer choices and rationales. Official content is not redistributed in the public repository.",
        },
    ]
    data["source_counts"] = {
        "existing_cards": existing_count,
        "nawl_cards": len(nawl_cards),
        "ngsl_cards": len(ngsl_cards),
        "official_context_cards": len(official),
        "total_cards": len(cards),
    }
    data["official_deck"] = {
        "cards": len(official),
        "asset": str(args.official_output.relative_to(ROOT)).replace("\\", "/"),
        "note": "Deployment-side asset generated from the locally imported official bank; not committed to the reference repo.",
    }

    with FLASHCARDS.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    counts = Counter(card["deck"] for card in cards)
    print(f"NAWL: {len(nawl_cards)} cards ({len(nawl_skipped)} skipped, no WordNet definition)")
    print(f"NGSL: {len(ngsl_cards)} cards ({len(ngsl_skipped)} skipped, no WordNet definition)")
    print(f"Official Words in Context: {len(official)} cards -> {args.official_output}")
    print(f"Total: {len(cards)} cards; {dict(counts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

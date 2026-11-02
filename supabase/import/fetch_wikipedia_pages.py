#!/usr/bin/env python3
"""Fetch English Wikipedia plain-text extracts into a batch pages.json.

Usage::

    python supabase/import/fetch_wikipedia_pages.py --data m18 \
        --titles "Sleep deprivation" "Circadian rhythm" ...

The API text is stored unchanged except for trimming to the first whole
sentences within ``--chars`` characters, so generators can rely on every
stimulus being a verbatim prefix of the article.
"""

import argparse
import json
import pathlib
import time
import urllib.parse
import urllib.request

API = "https://en.wikipedia.org/w/api.php"
UA = "HDSAT-question-bank/1.0 (educational content; contact hyperhrishi@users.noreply.github.com)"


def fetch(titles: list[str]) -> dict:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "extracts|info",
        "inprop": "url",
        "explaintext": "1",
        "redirects": "1",
        "titles": "|".join(titles),
        "exlimit": "max",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def trim(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    return cut[: end + 1] if end > 200 else cut


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--titles", nargs="+", required=True)
    ap.add_argument("--chars", type=int, default=1500)
    args = ap.parse_args()

    out_dir = pathlib.Path(__file__).resolve().parent / "data" / args.data
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "pages.json"
    pages = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}

    missing = []
    for start in range(0, len(args.titles), 1):
        chunk = args.titles[start : start + 1]
        data = fetch(chunk)
        by_title = {}
        for page in data["query"]["pages"]:
            if "missing" in page:
                continue
            by_title[page["title"]] = page
        alias = {}
        for key in ("normalized", "redirects"):
            for entry in data["query"].get(key, []):
                alias[entry["from"]] = entry["to"]
        for requested in chunk:
            canonical = requested
            for _ in range(3):
                canonical = alias.get(canonical, canonical)
            page = by_title.get(canonical)
            if page is None:
                missing.append(requested)
                continue
            pages[page["title"]] = {
                "title": page["title"],
                "extract": trim(page.get("extract", ""), args.chars),
                "url": page["fullurl"],
                "revision": page.get("lastrevid"),
            }
        time.sleep(0.5)

    out_path.write_text(
        json.dumps(pages, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"cached {len(pages)} pages in {out_path}")
    for title in missing:
        print(f"  MISSING: {title}")
    short = [t for t, p in pages.items() if len(p["extract"]) < 400]
    for title in short:
        print(f"  SHORT: {title} ({len(pages[title]['extract'])} chars)")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())

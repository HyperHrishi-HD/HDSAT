#!/usr/bin/env python3
"""Check every resource URL in the bundled catalogue.

A dead resource is worse than no resource: the student clicks it, leaves the
app and lands on a 404. HEAD is enough for almost every host; a handful refuse
HEAD, so those fall back to a ranged GET. A 403 means the site is blocking
automation, not that the page is gone — the report calls that out separately so
it is not mistaken for a dead link.
"""
from __future__ import annotations

import concurrent.futures
import json
import pathlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "src" / "data" / "resources.json"
UA = "Mozilla/5.0 (compatible; HDSAT link check; +https://hdsat.pythonanywhere.com)"


def probe(url: str) -> tuple[str, str, int | str]:
    for method in ("HEAD", "GET"):
        request = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return url, "ok", response.status
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429):
                return url, "blocked", exc.code
            if exc.code in (405, 501) and method == "HEAD":
                continue
            return url, "dead", exc.code
        except Exception as exc:  # DNS, TLS, timeout
            if method == "HEAD":
                continue
            return url, "dead", type(exc).__name__
    return url, "dead", "no-response"


def main() -> int:
    payload = json.loads(RESOURCES.read_text(encoding="utf-8"))
    items = payload if isinstance(payload, list) else payload["resources"]
    by_url = {item["url"]: item for item in items}
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for result in pool.map(probe, by_url):
            results.append(result)
    dead = [row for row in results if row[1] == "dead"]
    blocked = [row for row in results if row[1] == "blocked"]
    print(f"checked {len(results)} resources: {len(results) - len(dead)} reachable, {len(dead)} dead, {len(blocked)} bot-blocked")
    for url, _, code in dead:
        print("  DEAD", code, url, "|", by_url[url]["title"])
    for url, _, code in blocked:
        print("  blocked", code, url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

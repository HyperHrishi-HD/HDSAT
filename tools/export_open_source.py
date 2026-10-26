#!/usr/bin/env python3
"""Build the public, offline HDSAT tree — the repo that ships to GitHub.

This is the *export* half of the open-source task (the history purge is a
separate, deliberate action; see the runbook at the bottom of this docstring).
It copies the working tree, drops everything that only exists to run the hosted
site, and cuts the question bank down to a representative 1,000 items.

What is removed, and why:

  .pa/, .env*                  operator credentials and live project config
  supabase/                    migrations, seeds, email templates, importers
  backend/                     the Flask host that serves the built app
  .github/                     deploy/refresh workflows wired to that host
  artifacts/                   screenshots of the private deployment
  tools/admin_triage.py        talks to the service role
  tools/security_audit.py      needs a project token
  DEPLOY_PYTHONANYWHERE.txt    deployment notes
  README.md                    replaced with the offline README

What is changed:

  src/data/questionBank.json   1,000 items, stratified by section/domain
  src/data/flashcards.json     300 cards
  src/data/resources.json      kept (public links only)
  src/pages/Admin.tsx          removed, along with its route and helpers
  src/lib/supabaseClient.ts    env-free stub, so `cloudConfigured` is false
  .env.example                 no keys at all

The result runs entirely on `localStorage`: guest mode is already a supported
path in the app, so the UI, the engine, the arcade and the tests are the same
code as the hosted site.

    python tools/export_open_source.py --out ../HDSAT-open --verify

`--verify` symlinks this checkout's node_modules into the export and runs
`tsc --noEmit`, then removes the link. Nothing is committed: the target is left
as a plain directory for `git init` (a fresh single-commit history is the point
of the purge).

History purge runbook (run only when the hosted site is final, from a clean
checkout, with the working tree committed and a second backup of the repo):

    git clone --mirror . ../HDSAT-backup.git          # safety copy
    git checkout --orphan clean-main                  # one commit, no parents
    git add -A && git commit -m "HDSAT open source"
    git branch -M clean-main main
    git remote add public <new empty repo>
    git push public main
    # then, locally: git reflog expire --expire=now --all && git gc --prune=now

Rotation comes first: a secret that was ever committed is compromised even
after the history is rewritten.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import random
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

DROP_DIRS = {
    ".pa",
    ".git",
    "supabase",
    "backend",
    "node_modules",
    "dist",
    "artifacts",
    ".github",
    ".freebuff",
}
DROP_FILES = {
    "DEPLOY_PYTHONANYWHERE.txt",
    "SECURITY.md",
    "README.md",
    "wsgi.py",
    "requirements.txt",
    "tools/admin_triage.py",
    "tools/test_admin_triage.py",
    "tools/triage_live_test.py",
    "tools/security_audit.py",
    "tools/export_open_source.py",
    "tools/update_triage_log.py",
}
DROP_SUFFIXES = (".pyc",)


def tracked_files() -> list[pathlib.Path]:
    """Everything git would ship: tracked, plus new files that are not ignored."""
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    return [pathlib.Path(line) for line in out if line.strip()]


def keep(rel: pathlib.Path) -> bool:
    parts = rel.parts
    if not parts:
        return False
    if parts[0] in DROP_DIRS:
        return False
    if rel.as_posix() in DROP_FILES:
        return False
    if rel.name.endswith(DROP_SUFFIXES):
        return False
    if rel.name.startswith(".env"):
        return False
    return True


def stratified_sample(items: list[dict], target: int, seed: int = 20261103) -> list[dict]:
    """Take `target` items spread across section × domain × difficulty."""
    rng = random.Random(seed)
    buckets: dict[tuple, list[dict]] = {}
    for item in items:
        key = (
            item.get("section") or "?",
            item.get("domain") or "?",
            item.get("difficulty") or "?",
        )
        buckets.setdefault(key, []).append(item)
    for bucket in buckets.values():
        rng.shuffle(bucket)
    ordered = sorted(buckets)
    picked: list[dict] = []
    index = 0
    while len(picked) < target and ordered:
        progressed = False
        for key in ordered:
            bucket = buckets[key]
            if index < len(bucket) and len(picked) < target:
                picked.append(bucket[index])
                progressed = True
        if not progressed:
            break
        index += 1
    picked.sort(key=lambda item: str(item.get("id")))
    return picked


SUPABASE_STUB = '''import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cloud accounts are not part of the open-source build.
 *
 * The hosted app talks to Supabase; this file keeps the same surface and reports
 * "not configured", which every caller already handles: the Account page says so
 * and the whole app runs in Guest Mode on this browser's localStorage.
 */
export const isCloudConfigured = false;

export const supabaseUrl = '';

export function getSupabase(): SupabaseClient | null {
  return null;
}
'''


def strip_admin(path: pathlib.Path) -> None:
    """Remove the operator console from the public app."""
    app = path / "src" / "App.tsx"
    if app.exists():
        text = app.read_text(encoding="utf-8")
        text = text.replace("import { AdminPage } from './pages/Admin';\n", "")
        text = text.replace(
            '        <Route path="/admin" element={<AdminPage />} />\n', ""
        )
        app.write_text(text, encoding="utf-8")
    (path / "src" / "pages" / "Admin.tsx").unlink(missing_ok=True)
    for helper in (
        path / "src" / "lib" / "adminToken.ts",
        path / "src" / "components" / "AdminGate.tsx",
    ):
        helper.unlink(missing_ok=True)


OFFLINE_README = """# HDSAT

A local-first Digital SAT / PSAT study app: adaptive full tests, targeted
practice, a 1,000-item question bank with figures, flashcards on a spaced
repetition schedule, and a small arcade where the games are built out of real
questions.

This is the open-source build. **There is no server and no account system.**
Everything — progress, coins, streaks, flashcard scheduling, saved questions —
lives in this browser's `localStorage`, and it works with no connection at all
once the app has loaded.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + rendering tests
npm run build      # static build in dist/
```

The build is a plain static bundle: serve `dist/` from any web server, or open
it from a `file://` path for a single-device copy.

## What is in here

| Path | What it holds |
| --- | --- |
| `src/lib/` | the exam engine, grading, scheduling, storage, arcade maths |
| `src/pages/` | practice, full test, question bank, flashcards, arcade, rewards |
| `src/components/` | the Bluebook-style runner, figures, tools, games |
| `src/data/` | 1,000 questions, 300 flashcards, public study resources |
| `tools/` | content QA and the icon generator |

## Content licences

Every question carries its own `source_name`, `license` and `attribution`, and
the app shows them on the card and in Credits. The bundled bank is a
representative sample of public, redistributable practice material; the
`tools/content_qa.py` gate is what stops an item from shipping without them.

## Credits

Built by HyperHrishi HD. Math rendering by KaTeX (MIT). Icons by Lucide (ISC).
"""

ENV_EXAMPLE = """# This build needs no environment variables.
# Cloud accounts, email and the operator console are not part of it.
VITE_APP_NAME=HDSAT
"""


def build(out: pathlib.Path, sample: int) -> None:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    copied = 0
    for rel in tracked_files():
        if not keep(rel):
            continue
        source = ROOT / rel
        if not source.is_file():
            continue
        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied += 1

    # The bank and the deck are sampled, not copied.
    bank_path = out / "src" / "data" / "questionBank.json"
    bank = json.loads(bank_path.read_text(encoding="utf-8"))
    items = bank["questions"] if isinstance(bank, dict) else bank
    sampled = stratified_sample(items, sample)
    if isinstance(bank, dict):
        bank["questions"] = sampled
        bank["version"] = f"{bank.get('version', 'open')}-sample-{len(sampled)}"
    else:
        bank = sampled
    bank_path.write_text(json.dumps(bank, ensure_ascii=False, indent=1), encoding="utf-8")

    deck_path = out / "src" / "data" / "flashcards.json"
    if deck_path.exists():
        deck = json.loads(deck_path.read_text(encoding="utf-8"))
        cards = deck["cards"] if isinstance(deck, dict) else deck
        trimmed = cards[:300]
        if isinstance(deck, dict):
            deck["cards"] = trimmed
        else:
            deck = trimmed
        deck_path.write_text(json.dumps(deck, ensure_ascii=False, indent=1), encoding="utf-8")

    (out / "src" / "lib" / "supabaseClient.ts").write_text(SUPABASE_STUB, encoding="utf-8")
    (out / ".env.example").write_text(ENV_EXAMPLE, encoding="utf-8")
    (out / "README.md").write_text(OFFLINE_README, encoding="utf-8")
    strip_admin(out)

    print(f"copied {copied} files")
    print(f"bank: {len(sampled)} items")
    sections: dict[str, int] = {}
    for item in sampled:
        sections[str(item.get("section"))] = sections.get(str(item.get("section")), 0) + 1
    print("by section:", ", ".join(f"{k}={v}" for k, v in sorted(sections.items())))

def verify_export(sample: int) -> None:
    """Build the export under node_modules and typecheck it there."""
    staging = ROOT / "node_modules" / ".hdsat-verify"
    try:
        build(staging, sample=sample)
        npx = shutil.which("npx") or shutil.which("npx.cmd") or "npx"
        result = subprocess.run(
            [npx, "tsc", "--noEmit"],
            cwd=staging,
            capture_output=True,
            text=True,
        )
        print("typecheck:", "clean" if result.returncode == 0 else "FAILED")
        if result.returncode != 0:
            print(result.stdout[-4000:])
            print(result.stderr[-2000:])
            sys.exit(1)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="../HDSAT-open", help="target directory")
    parser.add_argument("--verify", action="store_true", help="typecheck the export")
    parser.add_argument("--sample", type=int, default=1000, help="bank size")
    args = parser.parse_args()
    if args.verify:
        verify_export(args.sample)
        print("export verified and removed; rerun without --verify to keep it")
        return
    out = pathlib.Path(os.path.abspath(args.out))
    build(out, sample=args.sample)
    print(f"export at {out}")


if __name__ == "__main__":
    main()

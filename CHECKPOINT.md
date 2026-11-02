# PythonAnywhere checkpoint

Snapshot of the **entire deployed site** pulled from the live account, kept
outside git under `checkpoints/` (58 MB). Use it to restore or diff production.

| | |
| --- | --- |
| Snapshot | `checkpoints/pythonanywhere-20261102T192542Z/` |
| Taken | 2026-11-02 19:25–19:28 UTC |
| Source | `/home/HDSAT/HDSAT` on PythonAnywhere (account `HDSAT`) |
| Files | 101 unique (200 API paths, the tree endpoint repeats entries) |
| Size | 58.2 MB |
| Bank | `2026.11.01-open-core-7` — 7,132 questions, 1,804 cards, 105 resources |
| Bundle | `dist/index.html` byte-identical to the live `/` (sha256 match) |

## What is inside

```
checkpoints/pythonanywhere-<stamp>/
  dist/            deployed bundle (index.html, hashed assets, icons, reference, sw.js)
  backend/         Flask app served by WSGI (app.py, test_app.py)
  src/data/        questionBank.json, flashcards.json, resources.json (the bundle's source)
  wsgi.py          dashboard WSGI entrypoint
  api/             live /api/health, /api/config, /api/legal payloads
  http/            every hashed asset a browser actually received
  index.html       byte copy of the live landing document
  checkpoint-manifest.json   per-file size + sha256, plus the HTTP surface table
```

No credentials are in the snapshot (`.pa/` is never deployed; a scan for
`.env`, `pa_credentials`, `supabase_service_key`, `*.pem` returned nothing).

## Verify it

```bash
python tools/checkpoint_pa.py --discover      # remote file count (200 paths)
python tools/checkpoint_pa.py --files --http  # take a fresh snapshot
```

`checkpoint-manifest.json` → `http[]` holds status, content-type, bytes and
sha256 for `/`, `/api/health`, `/api/config`, `/api/legal`, `sw.js`,
`manifest.webmanifest`, `favicon.svg` and every hashed asset.

## Restore / deploy from it

```bash
cd "checkpoints/pythonanywhere-20261102T192542Z"
python -m flask --app backend.app run          # local: http://127.0.0.1:5000
```

To push it back to PythonAnywhere, either run `python .pa/deploy.py` from the
repository (rebuilds `dist/` first) or upload `dist/ backend/ src/data/
wsgi.py requirements.txt` with the same Files API the checkpoint tool uses.

## Not included

Supabase (accounts, history, catalogue tables) is a separate service; this
snapshot covers the PythonAnywhere site only. A database export is the next
checkpoint step if we want the full stack.

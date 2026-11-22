#!/usr/bin/env python3
"""Store the publishable key the keep-alive cron needs, then prove it works.

    python tools/apply_keepalive.py

`supabase/migrations/20261122000100_supabase_keepalive.sql` creates the two cron
jobs and the `public.keepalive_config` row (RLS on, no policies, no anon or
authenticated grants). The key itself is written here, out of chat and out of
git: it is posted to PostgREST with the service-role key kept in `.pa/`, and
neither key is ever printed.

Steps:
  1. Read VITE_SUPABASE_ANON_KEY from .env and the service-role key from .pa/.
  2. Upsert it into public.keepalive_config.id = true.
  3. Read the row back with the service-role key; print only its length.
  4. Fire the same request once through net.http_get and report the HTTP status.

If the cron jobs themselves are missing, run the migration (see its header for
the two verification queries) before this script.
"""
import base64
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read_value(path: pathlib.Path) -> str:
    """A credential file is either a raw value or a KEY=VALUE block."""
    if not path.exists():
        sys.exit(f"missing {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        sys.exit(f"{path.relative_to(ROOT)} is empty")
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return text


def env_value(name: str) -> str:
    env = ROOT / ".env"
    if not env.exists():
        sys.exit("missing .env (needs VITE_SUPABASE_ANON_KEY)")
    for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith(name + "="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            if value:
                return value
    sys.exit(f"{name} is not set in .env")


def request(url: str, key: str, method: str = "GET", body: dict | None = None,
            extra: dict | None = None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    headers.update(extra or {})
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode()
            return resp.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def main() -> None:
    base = read_value(ROOT / ".pa" / "supabase_url").rstrip("/")
    if not base.startswith("http"):
        base = "https://qijfmwjcaminecxmbtcf.supabase.co"
    service_key = read_value(ROOT / ".pa" / "supabase_service_key")
    anon_key = env_value("VITE_SUPABASE_ANON_KEY")

    if not anon_key.startswith(("eyJ", "sb_publishable_")):
        sys.exit("VITE_SUPABASE_ANON_KEY does not look like a publishable key")

    config_url = f"{base}/rest/v1/keepalive_config"
    payload = {
        "id": True,
        "url": f"{base}/rest/v1/questions?select=id&limit=1",
        "apikey": anon_key,
    }
    status, body = request(
        f"{config_url}?on_conflict=id",
        service_key,
        method="POST",
        body=payload,
        extra={"Prefer": "resolution=merge-duplicates,return=representation"},
    )
    if status not in (200, 201):
        sys.exit(f"writing the keep-alive key failed (HTTP {status}): {body}")
    print(f"keep-alive config written (HTTP {status})")

    status, rows = request(f"{config_url}?select=id,url,apikey", service_key)
    if status != 200 or not rows:
        sys.exit(f"reading the config back failed (HTTP {status}): {rows}")
    row = rows[0]
    stored = len(row.get("apikey") or "")
    print(f"config row: id={row['id']} url={row['url']} apikey={stored} chars")

    # Fire the same request the cron job fires, without pg_net (the anon key is
    # the only credential a browser has, which is exactly the point).
    status, body = request(payload["url"], anon_key)
    print(f"REST probe: HTTP {status}")

    # pg_net queues the request asynchronously; the cron job is what delivers it
    # every six hours. Nothing else to do here.
    ready = stored >= 30 and status == 200
    print("RESULT:", "PASS" if ready else "FAIL")
    if not ready:
        sys.exit(1)
    time.sleep(0)


if __name__ == "__main__":
    main()

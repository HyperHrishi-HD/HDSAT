#!/usr/bin/env python3
"""Configure Supabase Auth SMTP and the branded HDSAT confirmation email.

Reads credentials from .pa/smtp_credentials (or the environment):

    SMTP_HOST=smtp-relay.brevo.com
    SMTP_PORT=587
    SMTP_LOGIN=hdsystem29@gmail.com
    SMTP_PASSWORD=<Brevo SMTP key>
    SMTP_SENDER=hdsystem29@gmail.com
    SMTP_SENDER_NAME=HDSAT

Also needs SUPABASE_ACCESS_TOKEN in .pa/supabase_credentials or the environment.
The SMTP password and access token are never printed.

Usage: python supabase/email-templates/apply_auth_config.py
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROJECT_REF = "qijfmwjcaminecxmbtcf"
TOKEN_FILE = ROOT / ".pa" / "supabase_credentials"
SMTP_FILE = ROOT / ".pa" / "smtp_credentials"
TEMPLATE = ROOT / "supabase" / "email-templates" / "confirmation.html"
SITE_URL = "https://hdsat.pythonanywhere.com"
ALLOW_LIST = ",".join(
    [
        "https://hdsat.pythonanywhere.com/**",
        "http://localhost:3010/**",
        "http://localhost:5173/**",
        "http://localhost:3000/**",
    ]
)
OK = (200, 201)


def read_key_values(path: pathlib.Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def api(token: str, method: str, path: str, payload=None):
    request = urllib.request.Request(
        f"https://api.supabase.com/v1{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read().decode()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:800]
    except urllib.error.URLError as exc:
        return 0, f"network error: {exc.reason}"


def main() -> None:
    read_key_values(TOKEN_FILE)
    read_key_values(SMTP_FILE)
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    host = os.environ.get("SMTP_HOST", "").strip()
    user = os.environ.get("SMTP_LOGIN", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "").strip()
    sender = os.environ.get("SMTP_SENDER", "").strip() or user
    sender_name = os.environ.get("SMTP_SENDER_NAME", "HDSAT").strip()
    port = int(os.environ.get("SMTP_PORT", "587").strip() or 587)
    if not token:
        sys.exit("missing SUPABASE_ACCESS_TOKEN")
    if not (host and user and password and sender):
        sys.exit(
            "missing SMTP settings. Save SMTP_HOST, SMTP_PORT, SMTP_LOGIN, "
            "SMTP_PASSWORD, SMTP_SENDER in .pa/smtp_credentials"
        )
    if not TEMPLATE.exists():
        sys.exit(f"missing template {TEMPLATE}")

    payload = {
        "site_url": SITE_URL,
        "uri_allow_list": ALLOW_LIST,
        "mailer_otp_length": 6,
        "mailer_subjects_confirmation": "Confirm your HDSAT account",
        "mailer_templates_confirmation_content": TEMPLATE.read_text(encoding="utf-8"),
        "smtp_host": host,
        "smtp_port": port,
        "smtp_user": user,
        "smtp_pass": password,
        "smtp_admin_email": sender,
        "smtp_sender_name": sender_name,
        "rate_limit_email_sent": 30,
    }
    status, result = api(token, "PATCH", f"/projects/{PROJECT_REF}/config/auth", payload)
    print(f"auth config PATCH: HTTP {status}")
    if status not in OK:
        sys.exit(result)

    status, config = api(token, "GET", f"/projects/{PROJECT_REF}/config/auth")
    if status != 200 or not isinstance(config, dict):
        sys.exit(f"config verification failed: HTTP {status}")
    checks = {
        "smtp_host": host,
        "smtp_user": user,
        "smtp_sender_name": sender_name,
        "mailer_otp_length": 6,
        "rate_limit_email_sent": 30,
        "site_url": SITE_URL,
    }
    failures = []
    for key, expected in checks.items():
        actual = config.get(key)
        good = actual == expected
        print(f"  [{'PASS' if good else 'FAIL'}] {key} = {actual}")
        if not good:
            failures.append(key)
    template_ok = "{{ .Token }}" in (config.get("mailer_templates_confirmation_content") or "")
    print(f"  [{'PASS' if template_ok else 'FAIL'}] branded template contains {{{{ .Token }}}}")
    if not template_ok:
        failures.append("template")
    if failures:
        sys.exit(f"SMTP verification failed: {', '.join(failures)}")
    print("SMTP AND CONFIRMATION EMAIL CONFIGURED")


if __name__ == "__main__":
    main()

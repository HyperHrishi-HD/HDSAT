#!/usr/bin/env python3
"""Local HDSAT report/appeal triage for the operator (and for Freebuff).

Reads the Supabase REST API with the *service role* key, which stays on this
machine. Freebuff can run this script whenever you ask "check the reports":
it prints a compact summary plus the rows, and can resolve, reply to or delete.

Credentials (in this order, never printed):
  HDSAT_SUPABASE_URL   or .pa/supabase_url
  HDSAT_SERVICE_KEY    or .pa/supabase_service_key

Usage:
  python tools/admin_triage.py summary
  python tools/admin_triage.py reports [--status received] [--limit 50] [--json]
  python tools/admin_triage.py appeals [--status received] [--limit 50] [--json]
  python tools/admin_triage.py resolve   report <id>
  python tools/admin_triage.py dismiss   report <id>
  python tools/admin_triage.py close     appeal <id> [--status resolved|rejected]
  python tools/admin_triage.py reply     report|appeal <id> --body "text" [--title "..."]
  python tools/admin_triage.py delete-reports --ids <id,id> | --status resolved --older-days 7
  python tools/admin_triage.py delete-appeals --ids <id,id> | --status rejected --older-days 30

Every write asks for confirmation unless --yes is passed (put --yes before the subcommand).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
PA_DIR = ROOT_DIR / ".pa"


def _read_cred(name: str) -> str:
    env = os.environ.get(name, "").strip()
    if env:
        return env
    stem = name.lower().replace("hdsat_", "")
    # HDSAT_SERVICE_KEY documents `.pa/supabase_service_key`; older setups only
    # had `.pa/service_key`, so accept both.
    for candidate in (PA_DIR / stem, PA_DIR / ("supabase_" + stem)):
        if candidate.exists():
            return candidate.read_text(encoding="utf-8").strip()
    return ""


def creds() -> tuple[str, str]:
    url = _read_cred("HDSAT_SUPABASE_URL").rstrip("/")
    key = _read_cred("HDSAT_SERVICE_KEY")
    if not url or not key:
        sys.exit(
            "Missing Supabase service credentials.\n"
            "Create .pa/supabase_url with your project URL and\n"
            ".pa/supabase_service_key with the service_role key (never commit them),\n"
            "or export HDSAT_SUPABASE_URL and HDSAT_SERVICE_KEY."
        )
    return url, key


def request(method: str, path: str, body=None, extra_headers=None):
    url, key = creds()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:600]
        sys.exit(f"Supabase {method} {path} failed: HTTP {exc.code} {detail}")
    except urllib.error.URLError as exc:
        sys.exit(f"Cannot reach Supabase: {exc.reason}")


def age(iso: str) -> str:
    try:
        then = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return "?"
    delta = dt.datetime.now(dt.timezone.utc) - then
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"{minutes} min"
    if minutes < 60 * 24:
        return f"{minutes // 60} h"
    return f"{minutes // (60 * 24)} d"


def fetch_reports(status: str | None, limit: int):
    query = {
        "select": "id,question_id,reason,details,contact_email,status,created_at,user_id",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if status:
        query["status"] = f"eq.{status}"
    return request("GET", "question_reports?" + urllib.parse.urlencode(query))


def fetch_appeals(status: str | None, limit: int):
    query = {
        "select": "id,reference,category,subject,details,contact_email,status,created_at,user_id",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if status:
        query["status"] = f"eq.{status}"
    return request("GET", "user_appeals?" + urllib.parse.urlencode(query))


def print_reports(rows, as_json: bool):
    if as_json:
        print(json.dumps(rows, indent=2))
        return
    if not rows:
        print("No reports match.")
        return
    for row in rows:
        who = row.get("contact_email") or (row.get("user_id") or "guest")[:8]
        print(
            f"{row['id'][:8]}  {str(row['created_at']):16}  {age(row['created_at']):>6}  "
            f"{row['status']:<9}  {row['reason']:<28}  {row['question_id']:<16}  {who}"
        )
        detail = (row.get("details") or "").strip()
        if detail:
            print(f"          ↳ {detail[:160]}")


def print_appeals(rows, as_json: bool):
    if as_json:
        print(json.dumps(rows, indent=2))
        return
    if not rows:
        print("No appeals match.")
        return
    for row in rows:
        who = row.get("contact_email") or (row.get("user_id") or "guest")[:8]
        print(
            f"{row['reference']:<15}  {row['status']:<9}  {age(row['created_at']):>6}  "
            f"{row['category']:<20}  {row['subject'][:48]}  {who}"
        )
        detail = (row.get("details") or "").strip()
        if detail:
            print(f"          ↳ {detail[:200]}")


def confirm(prompt: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    print(prompt)
    if input("Type yes to continue: ").strip().lower() != "yes":
        sys.exit("Cancelled; nothing changed.")


def cmd_summary(args):
    reports = fetch_reports(None, 500)
    appeals = fetch_appeals(None, 500)
    by_status: dict[str, int] = {}
    by_reason: dict[str, int] = {}
    for row in reports:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
        by_reason[row["reason"]] = by_reason.get(row["reason"], 0) + 1
    appeal_status: dict[str, int] = {}
    for row in appeals:
        appeal_status[row["status"]] = appeal_status.get(row["status"], 0) + 1

    pending = [r for r in reports if r["status"] in ("received", "in_review")]
    pending_appeals = [a for a in appeals if a["status"] in ("received", "in_review")]
    print(f"Question reports: {len(reports)} total · {len(pending)} open")
    for status, count in sorted(by_status.items()):
        print(f"  {status:<10} {count}")
    print("  By reason:")
    for reason, count in sorted(by_reason.items(), key=lambda item: -item[1]):
        print(f"    {reason:<32} {count}")
    print(f"\nAppeals: {len(appeals)} total · {len(pending_appeals)} open")
    for status, count in sorted(appeal_status.items()):
        print(f"  {status:<10} {count}")

    oldest = min(pending + pending_appeals, key=lambda row: row["created_at"], default=None)
    if oldest:
        print(f"\nOldest open item: {age(oldest['created_at'])} old ({oldest['created_at']})")
    print("\nNewest open reports:")
    print_reports(pending[:5], as_json=False)


def cmd_list(args, kind: str):
    rows = fetch_reports(args.status, args.limit) if kind == "reports" else fetch_appeals(args.status, args.limit)
    (print_reports if kind == "reports" else print_appeals)(rows, args.json)


def cmd_set_status(args, kind: str):
    table = "question_reports" if kind == "report" else "user_appeals"
    status = args.status
    patch = {"status": status}
    if table == "user_appeals":
        patch["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    updated = request("PATCH", f"{table}?id=eq.{args.id}", patch)
    if not updated:
        sys.exit(f"No {kind} with id {args.id}")
    print(f"{kind.capitalize()} {args.id} → {status}")


def cmd_reply(args):
    table = "question_reports" if args.kind == "report" else "user_appeals"
    select = "id,user_id,status" + (",reference" if table == "user_appeals" else "")
    rows = request("GET", f"{table}?id=eq.{args.id}&select={select}")
    if not rows:
        sys.exit(f"No {args.kind} with id {args.id}")
    row = rows[0]
    reference = row.get("reference") or args.id
    if not row.get("user_id"):
        print(
            "This item has no account attached, so it cannot reach a Dashboard.\n"
            f"Reply by email instead: {row.get('contact_email') or 'no contact email on file'}"
        )
        return
    confirm(f"Send a Dashboard notification to the student about {reference}?", args.yes)
    notification = request(
        "POST",
        "user_notifications",
        {
            "user_id": row["user_id"],
            "kind": "admin_reply",
            "title": args.title or "Reply from HDSAT",
            "body": args.body[:4000],
            "reference": reference,
        },
    )
    request("PATCH", f"{table}?id=eq.{args.id}", {"status": "in_review"})
    print(f"Delivered notification {notification[0]['id']} to the student's Dashboard.")


def cmd_delete(args, kind: str):
    table = "question_reports" if kind == "reports" else "user_appeals"
    query: dict[str, str] = {}
    if args.ids:
        ids = [part.strip() for part in args.ids.split(",") if part.strip()]
        if not ids:
            sys.exit("--ids needs at least one id")
        query["id"] = f"in.({','.join(ids)})"
    elif args.status and args.older_days:
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.older_days)
        query["status"] = f"eq.{args.status}"
        query["created_at"] = f"lt.{cutoff.isoformat()}"
    else:
        sys.exit("Give --ids, or both --status and --older-days. Refusing an unbounded delete.")
    confirm(f"Delete {kind} matching {query}?", args.yes)
    deleted = request("DELETE", f"{table}?{urllib.parse.urlencode(query)}", extra_headers={"Prefer": "return=representation"})
    print(f"Deleted {len(deleted or [])} {kind}.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("summary", help="counts, reasons and the oldest open item").set_defaults(func=cmd_summary)

    for name in ("reports", "appeals"):
        listed = sub.add_parser(name, help=f"list {name}")
        listed.add_argument("--status", default=None)
        listed.add_argument("--limit", type=int, default=50)
        listed.add_argument("--json", action="store_true")
        listed.set_defaults(func=lambda args, kind=name: cmd_list(args, kind))

    for kind, default in (("report", "resolved"), ("appeal", "resolved")):
        closer = sub.add_parser(f"close-{kind}" if kind == "appeal" else "resolve", help=f"close one {kind}")
        closer.add_argument("id")
        closer.add_argument("--status", default=default, choices=["resolved", "rejected", "dismissed", "in_review", "received"] if kind == "appeal" else ["resolved", "dismissed", "in_review", "received"])
        closer.set_defaults(func=lambda args, kind=kind: cmd_set_status(args, kind))

    dismiss = sub.add_parser("dismiss", help="dismiss one question report")
    dismiss.add_argument("id")
    dismiss.add_argument("--status", default="dismissed")
    dismiss.set_defaults(func=lambda args: cmd_set_status(args, "report"))

    reply = sub.add_parser("reply", help="send a one-time Dashboard notification")
    reply.add_argument("kind", choices=["report", "appeal"])
    reply.add_argument("id")
    reply.add_argument("--body", required=True)
    reply.add_argument("--title", default=None)
    reply.set_defaults(func=cmd_reply)

    for name in ("reports", "appeals"):
        deleter = sub.add_parser(f"delete-{name}", help=f"delete {name} by ids or by status+age")
        deleter.add_argument("--ids", default=None)
        deleter.add_argument("--status", default=None)
        deleter.add_argument("--older-days", type=int, default=None)
        deleter.set_defaults(func=lambda args, kind=name: cmd_delete(args, kind))

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

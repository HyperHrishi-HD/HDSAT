#!/usr/bin/env python3
"""Local HDSAT report/appeal triage for the operator (and for Freebuff).

Reads the Supabase REST API with the *service role* key, which stays on this
machine. Freebuff runs this when the owner says "check the reports": `digest`
prints one markdown brief (open counts, SLA breaches, grouping, newest items),
and `reply` answers an item in a fixed, concise shape.

Credentials (in this order, never printed):
  HDSAT_SUPABASE_URL   or .pa/supabase_url
  HDSAT_SERVICE_KEY    or .pa/supabase_service_key

Usage:
  python tools/admin_triage.py digest [--show-emails]
  python tools/admin_triage.py open
  python tools/admin_triage.py summary
  python tools/admin_triage.py reports [--status received] [--limit 50] [--json]
  python tools/admin_triage.py appeals [--status received] [--limit 50] [--json]
  python tools/admin_triage.py resolve   report <id>
  python tools/admin_triage.py dismiss   report <id>
  python tools/admin_triage.py close-appeal <id> [--status resolved|rejected]
  python tools/admin_triage.py reply     report|appeal <id> --template wrong_key --finding "..." [--dry-run]
  python tools/admin_triage.py reply     report|appeal <id> --body "free text" [--title "..."]
  python tools/admin_triage.py delete-reports --ids <id,id> | --status resolved --older-days 7
  python tools/admin_triage.py delete-appeals --ids <id,id> | --status rejected --older-days 30

Every write asks for confirmation unless --yes is passed (put --yes before the
subcommand). Sends and status changes append a line to .pa/triage_log.jsonl.
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
LOG_FILE = PA_DIR / "triage_log.jsonl"

OPEN_STATUSES = ("received", "in_review")
SLA_HOURS = 72


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


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested in tools/test_admin_triage.py, no network)
# ---------------------------------------------------------------------------

def mask_email(value: str | None) -> str:
    """Show enough to know it is the same person, never the full address."""
    text = (value or "").strip()
    if not text:
        return ""
    name, _, domain = text.partition("@")
    if not domain:
        return "***"
    return f"{name[:1] or ''}***@{domain}"


def reporter_label(row: dict, redact: bool = True) -> str:
    email = (row.get("contact_email") or "").strip()
    if email:
        return mask_email(email) if redact else email
    user_id = row.get("user_id") or ""
    return f"student {str(user_id)[:8]}" if user_id else "guest"


def _parse(iso: str | None) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def age(iso: str, now: dt.datetime | None = None) -> str:
    then = _parse(iso)
    if not then:
        return "?"
    current = now or dt.datetime.now(dt.timezone.utc)
    minutes = int((current - then).total_seconds() // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min"
    if minutes < 60 * 24:
        return f"{minutes // 60} h"
    return f"{minutes // (60 * 24)} d"


def hours_open(iso: str, now: dt.datetime | None = None) -> float:
    then = _parse(iso)
    if not then:
        return 0.0
    current = now or dt.datetime.now(dt.timezone.utc)
    return max(0.0, (current - then).total_seconds() / 3600)


class Template:
    __slots__ = ("title", "finding", "change", "next_step")

    def __init__(self, title: str, finding: str, change: str, next_step: str):
        self.title = title
        self.finding = finding
        self.change = change
        self.next_step = next_step


TEMPLATES: dict[str, Template] = {
    "wrong_key": Template(
        "Answer key corrected",
        "The item had a flawed key or two defensible options.",
        "We corrected the key and re-checked the explanation for that question.",
        "Your next attempt on it is graded against the corrected key. Nothing else is needed.",
    ),
    "explanation": Template(
        "Explanation improved",
        "The explanation was incomplete or did not match the keyed answer.",
        "We rewrote the explanation for that question.",
        "Open the item again from your review list to see the updated reasoning.",
    ),
    "typo_or_format": Template(
        "Formatting fixed",
        "The question had a formatting or rendering problem (text, math or figure).",
        "We repaired the affected formatting and re-rendered the item.",
        "Reload the question; if it still looks wrong, reply here and we will reopen it.",
    ),
    "mistagged": Template(
        "Item reclassified",
        "The item was filed under the wrong section, domain or difficulty.",
        "We moved it to the correct classification.",
        "The item now appears in the right practice filter and mastery breakdown.",
    ),
    "copyright": Template(
        "Content review complete",
        "The passage or item raised a copyright or attribution concern.",
        "We reviewed the item against our content policy and removed or replaced it where needed.",
        "No action is needed from you. Thank you for flagging it.",
    ),
    "no_fault": Template(
        "Question checked - no change",
        "We reviewed the item and key against the official reasoning; both are correct.",
        "Nothing was changed.",
        "Re-read the explanation for the keyed choice - the distractors are designed to be close.",
    ),
    "fixed_thanks": Template(
        "Update applied",
        "We confirmed your report and applied the fix.",
        "The affected item has been updated.",
        "Thank you - reports like this keep the bank accurate.",
    ),
}

TEMPLATE_NAMES = tuple(TEMPLATES)


def render_reply(
    template: str,
    reference: str,
    submitted: str,
    finding: str | None = None,
) -> tuple[str, str]:
    """Return (title, body) in the one format every reply uses."""
    spec = TEMPLATES.get(template)
    if not spec:
        raise SystemExit(f"Unknown template {template!r}. Choose one of: {', '.join(TEMPLATE_NAMES)}")
    found = (finding or "").strip() or spec.finding
    lines = [
        f"About {reference}",
        "",
        "What you sent",
        f"  {submitted.strip() or 'a report'}",
        "",
        "What we found",
        f"  {found}",
        "",
        "What changed",
        f"  {spec.change}",
        "",
        "Next step",
        f"  {spec.next_step}",
    ]
    return spec.title, "\n".join(lines)


def reply_columns(kind: str) -> str:
    """Columns to read before replying.

    The two tables share no question column: reports carry `question_id`,
    appeals carry a `reference` and `subject`. Selecting a column a table does
    not have makes PostgREST answer 400 instead of returning the row.
    """
    if kind == "report":
        return "id,question_id,reason,user_id,status"
    return "id,reference,subject,user_id,status"


def group_reports(rows: list[dict]) -> dict:
    """Counts used by the digest: by reason, by question, by reporter."""
    by_reason: dict[str, int] = {}
    by_question: dict[str, int] = {}
    by_reporter: dict[str, int] = {}
    for row in rows:
        by_reason[row["reason"]] = by_reason.get(row["reason"], 0) + 1
        by_question[row["question_id"]] = by_question.get(row["question_id"], 0) + 1
        who = row.get("user_id") or row.get("contact_email") or "guest"
        by_reporter[who] = by_reporter.get(who, 0) + 1
    return {"by_reason": by_reason, "by_question": by_question, "by_reporter": by_reporter}


def build_digest(
    reports: list[dict],
    appeals: list[dict],
    now: dt.datetime | None = None,
    redact: bool = True,
) -> str:
    current = now or dt.datetime.now(dt.timezone.utc)
    open_reports = [r for r in reports if r["status"] in OPEN_STATUSES]
    open_appeals = [a for a in appeals if a["status"] in OPEN_STATUSES]
    everything = sorted(
        [("report", r) for r in open_reports] + [("appeal", a) for a in open_appeals],
        key=lambda pair: pair[1]["created_at"],
    )

    breaches = [pair for pair in everything if hours_open(pair[1]["created_at"], current) > SLA_HOURS]

    out: list[str] = []
    out.append(f"# HDSAT queue - {current.astimezone(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    out.append("")
    out.append(
        f"**{len(open_reports)} open reports | {len(open_appeals)} open appeals** "
        f"({len(reports)} report rows, {len(appeals)} appeal rows total)"
    )
    if not everything:
        out.append("")
        out.append("Queue is clear - nothing awaiting a reply.")
        return "\n".join(out)

    out.append("")
    if breaches:
        out.append(f"## Overdue (past {SLA_HOURS} h): {len(breaches)}")
        for kind, row in breaches:
            ref = row.get("reference") or row["id"]
            out.append(f"- **{ref}** | {kind} | {age(row['created_at'], current)}")
    else:
        out.append(f"No item is past the {SLA_HOURS} h first-response window.")

    out.append("")
    out.append("## Open items (oldest first)")
    for kind, row in everything:
        if kind == "report":
            label = f"report {row['id'][:8]} | {row['question_id']} | {row['reason']}"
        else:
            label = f"**{row['reference']}** | {row['category']} | {row['subject']}"
        out.append(f"- {label} - {age(row['created_at'], current)} - {reporter_label(row, redact)}")
        detail = (row.get("details") or "").strip().replace("\n", " ")
        if detail:
            out.append(f"  > {detail[:220]}")

    stats = group_reports(open_reports)
    if open_reports:
        out.append("")
        out.append("## Reports by reason")
        for reason, count in sorted(stats["by_reason"].items(), key=lambda item: -item[1]):
            out.append(f"- {reason}: {count}")
        repeated = [(qid, n) for qid, n in stats["by_question"].items() if n > 1]
        if repeated:
            out.append("")
            out.append("## Questions reported more than once")
            for qid, count in sorted(repeated, key=lambda item: -item[1])[:10]:
                out.append(f"- `{qid}` x {count}")
        noisy = [(uid, n) for uid, n in stats["by_reporter"].items() if n > 1]
        if noisy:
            out.append("")
            out.append("## Reporters with multiple open reports")
            for uid, count in sorted(noisy, key=lambda item: -item[1])[:10]:
                label = mask_email(uid) if "@" in str(uid) else f"student {str(uid)[:8]}"
                out.append(f"- {label}: {count}")

    return "\n".join(out)


def log_action(action: str, **fields) -> None:
    """Append-only local audit trail; never fails the command."""
    try:
        PA_DIR.mkdir(parents=True, exist_ok=True)
        entry = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), "action": action, **fields}
        with LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Remote reads / writes
# ---------------------------------------------------------------------------

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


def print_reports(rows, as_json: bool, redact: bool = True):
    if as_json:
        print(json.dumps(rows if not redact else [{**r, "contact_email": mask_email(r.get("contact_email"))} for r in rows], indent=2))
        return
    if not rows:
        print("No reports match.")
        return
    for row in rows:
        print(
            f"{row['id'][:8]}  {str(row['created_at']):16}  {age(row['created_at']):>6}  "
            f"{row['status']:<9}  {row['reason']:<28}  {row['question_id']:<16}  {reporter_label(row, redact)}"
        )
        detail = (row.get("details") or "").strip()
        if detail:
            print(f"          > {detail[:160]}")


def print_appeals(rows, as_json: bool, redact: bool = True):
    if as_json:
        print(json.dumps(rows if not redact else [{**r, "contact_email": mask_email(r.get("contact_email"))} for r in rows], indent=2))
        return
    if not rows:
        print("No appeals match.")
        return
    for row in rows:
        print(
            f"{row['reference']:<15}  {row['status']:<9}  {age(row['created_at']):>6}  "
            f"{row['category']:<20}  {row['subject'][:48]}  {reporter_label(row, redact)}"
        )
        detail = (row.get("details") or "").strip()
        if detail:
            print(f"          > {detail[:200]}")


def confirm(prompt: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    print(prompt)
    if input("Type yes to continue: ").strip().lower() != "yes":
        sys.exit("Cancelled; nothing changed.")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_digest(args):
    print(build_digest(fetch_reports(None, 500), fetch_appeals(None, 500), redact=not args.show_emails))


def cmd_open(args):
    reports = [r for r in fetch_reports(None, 500) if r["status"] in OPEN_STATUSES]
    appeals = [a for a in fetch_appeals(None, 500) if a["status"] in OPEN_STATUSES]
    print(f"OPEN REPORTS ({len(reports)})")
    print_reports(sorted(reports, key=lambda r: r["created_at"]), False, not args.show_emails)
    print(f"\nOPEN APPEALS ({len(appeals)})")
    print_appeals(sorted(appeals, key=lambda a: a["created_at"]), False, not args.show_emails)


def cmd_summary(args):
    reports = fetch_reports(None, 500)
    appeals = fetch_appeals(None, 500)
    by_status: dict[str, int] = {}
    for row in reports:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
    appeal_status: dict[str, int] = {}
    for row in appeals:
        appeal_status[row["status"]] = appeal_status.get(row["status"], 0) + 1

    pending = [r for r in reports if r["status"] in OPEN_STATUSES]
    pending_appeals = [a for a in appeals if a["status"] in OPEN_STATUSES]
    print(f"Question reports: {len(reports)} total | {len(pending)} open")
    for status, count in sorted(by_status.items()):
        print(f"  {status:<10} {count}")
    by_reason = group_reports(reports)["by_reason"]
    print("  By reason:")
    for reason, count in sorted(by_reason.items(), key=lambda item: -item[1]):
        print(f"    {reason:<32} {count}")
    print(f"\nAppeals: {len(appeals)} total | {len(pending_appeals)} open")
    for status, count in sorted(appeal_status.items()):
        print(f"  {status:<10} {count}")

    oldest = min(pending + pending_appeals, key=lambda row: row["created_at"], default=None)
    if oldest:
        print(f"\nOldest open item: {age(oldest['created_at'])} old ({oldest['created_at']})")
    print("\nNewest open reports:")
    print_reports(pending[:5], as_json=False, redact=not args.show_emails)


def cmd_list(args, kind: str):
    rows = fetch_reports(args.status, args.limit) if kind == "reports" else fetch_appeals(args.status, args.limit)
    (print_reports if kind == "reports" else print_appeals)(rows, args.json, not args.show_emails)


def cmd_set_status(args, kind: str):
    table = "question_reports" if kind == "report" else "user_appeals"
    patch = {"status": args.status}
    if table == "user_appeals":
        patch["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    updated = request("PATCH", f"{table}?id=eq.{args.id}", patch)
    if not updated:
        sys.exit(f"No {kind} with id {args.id}")
    log_action("status", kind=kind, id=args.id, status=args.status)
    print(f"{kind.capitalize()} {args.id} -> {args.status}")


def cmd_reply(args):
    table = "question_reports" if args.kind == "report" else "user_appeals"
    rows = request("GET", f"{table}?id=eq.{args.id}&select={reply_columns(args.kind)}")
    if not rows:
        sys.exit(f"No {args.kind} with id {args.id}")
    row = rows[0]
    reference = row.get("reference") or f"report {row['id'][:8]}"

    if args.template:
        submitted = (
            f"question {row.get('question_id')} - {row.get('reason')!r}"
            if args.kind == "report"
            else f"{row.get('subject')!r}"
        )
        title, body = render_reply(args.template, reference, submitted, args.finding)
    elif args.body:
        title, body = args.title or "Reply from HDSAT", args.body
    else:
        sys.exit("Give --template (preferred) or --body.")

    if args.dry_run:
        print(f"--- preview ({reference}) ---")
        print(f"Title: {title}")
        print()
        print(body)
        return

    if not row.get("user_id"):
        print("This item has no account attached, so it cannot reach a Dashboard.")
        print("Ask the owner to reply by email using the address in the console.")
        return

    confirm(f"Send this reply to the student about {reference}?", args.yes)
    notification = request(
        "POST",
        "user_notifications",
        {
            "user_id": row["user_id"],
            "kind": "admin_reply",
            "title": title,
            "body": body[:4000],
            "reference": reference,
        },
    )
    request("PATCH", f"{table}?id=eq.{args.id}", {"status": "in_review"})
    log_action("reply", kind=args.kind, id=args.id, reference=reference, template=args.template or "custom", title=title)
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
    log_action("delete", kind=kind, query=query, deleted=len(deleted or []))
    print(f"Deleted {len(deleted or [])} {kind}.")


def main(argv=None):
    # Windows consoles default to cp1252, which cannot encode the em dashes and
    # middle dots used in the digest. Never fail a read because of a glyph.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    parser.add_argument("--show-emails", action="store_true", help="print full addresses (default: masked)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("digest", help="markdown brief: SLA, open items, grouping").set_defaults(func=cmd_digest)
    sub.add_parser("open", help="every open report and appeal, oldest first").set_defaults(func=cmd_open)
    sub.add_parser("summary", help="counts and the newest open reports").set_defaults(func=cmd_summary)

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
    reply.add_argument("--template", choices=list(TEMPLATE_NAMES), default=None,
                       help="structured reply (preferred)")
    reply.add_argument("--finding", default=None, help="one line on what we found (goes in the reply)")
    reply.add_argument("--body", default=None, help="free-form reply instead of a template")
    reply.add_argument("--title", default=None)
    reply.add_argument("--dry-run", action="store_true", help="print the reply and change nothing")
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

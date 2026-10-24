"""
HDSAT Flask WSGI Application for PythonAnywhere Deployment.

Serves the compiled React/Vite SPA from `dist/`, exposes health/metadata/catalog
API endpoints under `/api/*`, and provides a catch-all SPA fallback so browser
reloads on any client route work cleanly.

The app is deliberately dependency-free beyond Flask: rate limiting is an
in-process sliding window and all security headers are set here rather than in
the PythonAnywhere web configuration, so the deployed behaviour is auditable
from source.
"""

from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from flask import Flask, Response, jsonify, redirect, request, send_from_directory

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
DATA_DIR = ROOT_DIR / "src" / "data"

# Compliance defaults surfaced by /api/legal so the published policies can be
# audited from the running deployment without reading the bundle.
LEGAL_VERSION = os.environ.get("HDSAT_LEGAL_VERSION", "1.3")
MIN_AGE = 13
APPEAL_SLA_HOURS = 72
POLICY_PATHS = {
    "terms": "/#/terms",
    "privacy": "/#/privacy",
    "copyright": "/#/copyright",
    "appeals": "/#/account",
}

# A single Content-Security-Policy string so tests can assert on it and the
# deployed header can be diffed against source. `unsafe-eval` is deliberately
# absent: nothing in the bundle needs it. `frame-src`/`script-src` allow the
# official College Board Desmos calculator, which the study workspace embeds.
# The operator console's human check is computed locally, so no third-party
# script or frame origin is needed.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://www.desmos.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "frame-src https://www.desmos.com; "
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'self'"
)

# 1 MiB is far more than any legitimate request to a read-only public API; the
# only writes happen straight from the browser to Supabase, never here.
MAX_CONTENT_LENGTH = 1024 * 1024

# Paths that must stay reachable over plain HTTP so the external uptime monitor
# and the monthly PythonAnywhere reload bot keep working through the redirect.
REDIRECT_EXEMPT_PATHS = frozenset({"/api/health"})

# Sliding-window rate limiting state. Bounded so a hostile client cannot grow
# the process by rotating addresses.
MAX_TRACKED_CLIENTS = 4096
_RATE_BUCKETS: dict[str, list[float]] = {}


def reset_rate_limits() -> None:
    """Clear limiter state. Used by tests and after a deploy-time restart."""
    _RATE_BUCKETS.clear()


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def _is_development() -> bool:
    """Local runs and the test suite opt out of the HTTPS redirect."""
    return os.environ.get("HDSAT_ENV", "production").strip().lower() in {
        "development",
        "dev",
        "local",
        "testing",
        "test",
    }


def _request_is_secure() -> bool:
    """Trust the proxy's `X-Forwarded-Proto` before Flask's own view of TLS."""
    forwarded = request.headers.get("X-Forwarded-Proto", "")
    if forwarded:
        return forwarded.split(",")[0].strip().lower() == "https"
    return bool(request.is_secure)


def _https_url() -> str:
    parts = urlsplit(request.url)
    return urlunsplit(parts._replace(scheme="https"))


def _rate_limit_config() -> tuple[int, float]:
    try:
        limit = int(os.environ.get("HDSAT_RATE_LIMIT", "60"))
    except (TypeError, ValueError):
        limit = 60
    try:
        window = float(os.environ.get("HDSAT_RATE_WINDOW", "60"))
    except (TypeError, ValueError):
        window = 60.0
    return max(1, limit), max(1.0, window)


def _client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.remote_addr or "unknown"


def _prune_buckets(cutoff: float) -> None:
    """Keep the bucket map bounded by dropping expired, then oldest, clients."""
    if len(_RATE_BUCKETS) <= MAX_TRACKED_CLIENTS:
        return
    for key in [k for k, stamps in _RATE_BUCKETS.items() if not stamps or stamps[-1] <= cutoff]:
        _RATE_BUCKETS.pop(key, None)
    while len(_RATE_BUCKETS) > MAX_TRACKED_CLIENTS:
        _RATE_BUCKETS.pop(next(iter(_RATE_BUCKETS)), None)


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

    @app.before_request
    def guard_request():
        path = request.path or "/"
        is_api = path.startswith("/api/")

        # Reject oversized bodies before they are buffered. The check reads only
        # the Content-Length header, so it works for any method or route.
        declared = request.content_length
        if declared is not None and declared > MAX_CONTENT_LENGTH:
            return (
                jsonify(
                    {
                        "error": "payload_too_large",
                        "message": f"Request bodies are limited to {MAX_CONTENT_LENGTH} bytes.",
                    }
                ),
                413,
            )

        if (
            not _is_development()
            and path not in REDIRECT_EXEMPT_PATHS
            and not _request_is_secure()
        ):
            return redirect(_https_url(), code=308)

        if not is_api:
            return None

        limit, window = _rate_limit_config()
        ip = _client_ip()
        now = time.monotonic()
        cutoff = now - window
        stamps = [stamp for stamp in _RATE_BUCKETS.get(ip, []) if stamp > cutoff]

        if len(stamps) >= limit:
            retry_after = max(1, int(math.ceil(window - (now - stamps[0]))))
            _RATE_BUCKETS[ip] = stamps
            response = jsonify(
                {
                    "error": "rate_limited",
                    "message": "Too many requests. Please slow down and try again shortly.",
                    "retry_after_seconds": retry_after,
                }
            )
            response.status_code = 429
            response.headers["Retry-After"] = str(retry_after)
            response.headers["X-RateLimit-Limit"] = str(limit)
            response.headers["X-RateLimit-Remaining"] = "0"
            return response

        stamps.append(now)
        _RATE_BUCKETS[ip] = stamps
        _prune_buckets(cutoff)
        return None

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        )
        response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        # Only meaningful over TLS, and harmless when PythonAnywhere terminates it.
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )

        if request.path.startswith("/api/"):
            # Student data and configuration must never be cached by proxies.
            response.headers.setdefault("Cache-Control", "no-store")
            if "X-RateLimit-Limit" not in response.headers:
                limit, _window = _rate_limit_config()
                used = len(_RATE_BUCKETS.get(_client_ip(), []))
                response.headers["X-RateLimit-Limit"] = str(limit)
                response.headers["X-RateLimit-Remaining"] = str(max(0, limit - used))
        return response

    @app.errorhandler(413)
    def payload_too_large(_error):
        return (
            jsonify(
                {
                    "error": "payload_too_large",
                    "message": f"Request bodies are limited to {MAX_CONTENT_LENGTH} bytes.",
                }
            ),
            413,
        )

    @app.get("/robots.txt")
    def robots_txt():
        """Keep crawlers out of the operator console."""
        body = "User-agent: *\nDisallow: /admin\nAllow: /\n"
        return Response(body, mimetype="text/plain")

    @app.get("/api/legal")
    def api_legal():
        """Public compliance metadata: policy version, paths and age policy."""
        return jsonify(
            {
                "site_name": os.environ.get("HDSAT_SITE_NAME", "HDSAT"),
                "legal_version": LEGAL_VERSION,
                "min_age": MIN_AGE,
                "appeal_sla_hours": APPEAL_SLA_HOURS,
                "policies": POLICY_PATHS,
                "support_email": os.environ.get("VITE_SUPPORT_EMAIL", ""),
                "under_13_accounts_allowed": False,
                "guardian_consent_required_under_18": True,
                "self_serve_data_export": True,
                "self_serve_account_deletion": True,
                "advertising_trackers": False,
                "sells_personal_data": False,
            }
        )

    @app.get("/api/health")
    def api_health():
        bank = _load_json(DATA_DIR / "questionBank.json", {})
        cards = _load_json(DATA_DIR / "flashcards.json", {})
        resources = _load_json(DATA_DIR / "resources.json", {})
        questions = bank.get("questions", [])
        return jsonify(
            {
                "status": "ok",
                "service": os.environ.get("HDSAT_SITE_NAME", "HDSAT"),
                "environment": os.environ.get("HDSAT_ENV", "production"),
                "bank_version": bank.get("bank_version", "unknown"),
                "question_count": len(questions),
                "flashcard_count": len(cards.get("cards", [])),
                "resource_count": len(resources.get("resources", [])),
                "dist_ready": (DIST_DIR / "index.html").exists(),
                "supabase_configured": bool(
                    os.environ.get("VITE_SUPABASE_URL") and os.environ.get("VITE_SUPABASE_ANON_KEY")
                ),
            }
        )

    @app.get("/api/config")
    def api_config():
        """Return public-only runtime configuration. Never exposes secret keys."""
        return jsonify(
            {
                "site_name": os.environ.get("HDSAT_SITE_NAME", "HDSAT"),
                "supabase_url": os.environ.get("VITE_SUPABASE_URL", ""),
                "supabase_anon_key": os.environ.get("VITE_SUPABASE_ANON_KEY", ""),
            }
        )

    @app.get("/api/catalog/summary")
    def api_catalog_summary():
        bank = _load_json(DATA_DIR / "questionBank.json", {})
        questions = bank.get("questions", [])
        by_section: dict[str, int] = {}
        by_difficulty: dict[str, int] = {}
        for q in questions:
            sec = q.get("section", "Unknown")
            diff = q.get("difficulty", "Unknown")
            by_section[sec] = by_section.get(sec, 0) + 1
            by_difficulty[diff] = by_difficulty.get(diff, 0) + 1
        return jsonify(
            {
                "bank_version": bank.get("bank_version"),
                "licensing_note": bank.get("licensing_note"),
                "sources": bank.get("sources", []),
                "total_questions": len(questions),
                "by_section": by_section,
                "by_difficulty": by_difficulty,
            }
        )

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_spa(path: str):
        if path.startswith("api/"):
            return jsonify({"error": "Not found", "path": f"/{path}"}), 404

        candidate = DIST_DIR / path
        if path and candidate.exists() and candidate.is_file():
            return send_from_directory(str(DIST_DIR), path)

        index_file = DIST_DIR / "index.html"
        if index_file.exists():
            return send_from_directory(str(DIST_DIR), "index.html")

        return (
            jsonify(
                {
                    "status": "building",
                    "message": "HDSAT frontend bundle not found in dist/. Run `npm run build` first.",
                }
            ),
            503,
        )

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)

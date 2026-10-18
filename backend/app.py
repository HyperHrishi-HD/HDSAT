"""
HDSAT Flask WSGI Application for PythonAnywhere Deployment.

Serves the compiled React/Vite SPA from `dist/`, exposes health/metadata/catalog
API endpoints under `/api/*`, and provides a catch-all SPA fallback so browser
reloads on any client route work cleanly.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, send_from_directory

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
DATA_DIR = ROOT_DIR / "src" / "data"

# Compliance defaults surfaced by /api/legal so the published policies can be
# audited from the running deployment without reading the bundle.
LEGAL_VERSION = os.environ.get("HDSAT_LEGAL_VERSION", "1.0")
MIN_AGE = 13
APPEAL_SLA_HOURS = 72
POLICY_PATHS = {
    "terms": "/#/terms",
    "privacy": "/#/privacy",
    "copyright": "/#/copyright",
    "appeals": "/#/account",
}


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        )
        response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if response.mimetype == "application/json":
            # Student data and configuration must never be cached by proxies.
            response.headers.setdefault("Cache-Control", "no-store")
        return response

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

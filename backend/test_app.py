"""Automated pytest suite for HDSAT Flask WSGI backend and question importer."""

from __future__ import annotations

import pytest

from backend.app import (
    CONTENT_SECURITY_POLICY,
    MAX_CONTENT_LENGTH,
    create_app,
    reset_rate_limits,
)
from supabase.import_check_helper import run_importer_validation


@pytest.fixture(autouse=True)
def local_environment(monkeypatch):
    """Keep the suite on plain HTTP and start every test with a clean limiter."""
    monkeypatch.setenv("HDSAT_ENV", "development")
    monkeypatch.delenv("HDSAT_RATE_LIMIT", raising=False)
    monkeypatch.delenv("HDSAT_RATE_WINDOW", raising=False)
    reset_rate_limits()
    yield
    reset_rate_limits()


def test_health_endpoint():
    app = create_app()
    client = app.test_client()
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "ok"
    assert data["question_count"] >= 36
    assert data["flashcard_count"] >= 46
    assert data["resource_count"] >= 18
    assert data["dist_ready"] is True


def test_catalog_summary_endpoint():
    app = create_app()
    client = app.test_client()
    res = client.get("/api/catalog/summary")
    assert res.status_code == 200
    data = res.get_json()
    assert data["total_questions"] >= 36
    assert data["by_section"]["Reading and Writing"] >= 18
    assert data["by_section"]["Math"] >= 18
    assert len(data["sources"]) == 2


def test_spa_root_and_client_route_fallback():
    app = create_app()
    client = app.test_client()
    for route in ["/", "/practice", "/test", "/bank", "/flashcards", "/arcade", "/resources", "/rewards", "/account"]:
        res = client.get(route)
        assert res.status_code == 200
        assert b"HDSAT" in res.data


def test_spa_fallback_covers_policy_routes():
    app = create_app()
    client = app.test_client()
    for route in ["/terms", "/privacy", "/copyright"]:
        res = client.get(route)
        assert res.status_code == 200
        assert b"HDSAT" in res.data


def test_legal_endpoint_publishes_compliance_metadata():
    app = create_app()
    client = app.test_client()
    res = client.get("/api/legal")
    assert res.status_code == 200
    data = res.get_json()
    assert data["min_age"] == 13
    assert data["under_13_accounts_allowed"] is False
    assert data["guardian_consent_required_under_18"] is True
    assert data["self_serve_account_deletion"] is True
    assert data["self_serve_data_export"] is True
    assert data["advertising_trackers"] is False
    assert data["sells_personal_data"] is False
    assert data["appeal_sla_hours"] > 0
    assert set(data["policies"]) == {"terms", "privacy", "copyright", "appeals"}
    assert data["legal_version"]


def test_security_headers_present_on_all_responses():
    app = create_app()
    client = app.test_client()
    for route in ["/", "/api/health", "/api/legal"]:
        res = client.get(route)
        assert res.headers["X-Content-Type-Options"] == "nosniff"
        assert res.headers["X-Frame-Options"] == "SAMEORIGIN"
        assert "camera=()" in res.headers["Permissions-Policy"]
        assert res.headers["X-Permitted-Cross-Domain-Policies"] == "none"
        assert res.headers["Strict-Transport-Security"].startswith("max-age=")
        assert res.headers["Cross-Origin-Opener-Policy"] == "same-origin"
        assert res.headers["Cross-Origin-Resource-Policy"] == "same-origin"
    assert client.get("/api/health").headers["Cache-Control"] == "no-store"


def test_unknown_api_route_returns_404():
    app = create_app()
    client = app.test_client()
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404


def test_importer_validation_passes():
    assert run_importer_validation() == 0


# ---------------------------------------------------------------------------
# HTTPS enforcement
# ---------------------------------------------------------------------------


def test_production_redirects_plain_http_to_https(monkeypatch):
    monkeypatch.setenv("HDSAT_ENV", "production")
    client = create_app().test_client()
    res = client.get("/practice")
    assert res.status_code == 308
    assert res.headers["Location"].startswith("https://")
    assert res.headers["Location"].endswith("/practice")


def test_production_does_not_redirect_when_proxy_reports_https(monkeypatch):
    """A forwarded https request must never bounce, which would loop forever."""
    monkeypatch.setenv("HDSAT_ENV", "production")
    client = create_app().test_client()
    res = client.get("/practice", headers={"X-Forwarded-Proto": "https"})
    assert res.status_code == 200
    assert b"HDSAT" in res.data


def test_production_keeps_health_reachable_for_uptime_monitors(monkeypatch):
    monkeypatch.setenv("HDSAT_ENV", "production")
    client = create_app().test_client()
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


def test_development_serves_over_http():
    client = create_app().test_client()
    res = client.get("/practice")
    assert res.status_code == 200


# ---------------------------------------------------------------------------
# Content Security Policy and payload limits
# ---------------------------------------------------------------------------


def test_csp_allows_desmos_and_blocks_objects():
    client = create_app().test_client()
    for route in ["/", "/api/health"]:
        csp = client.get(route).headers["Content-Security-Policy"]
        assert csp == CONTENT_SECURITY_POLICY
        assert "https://www.desmos.com" in csp
        assert "frame-src https://www.desmos.com" in csp
        assert "google.com" not in csp
        assert "object-src 'none'" in csp
        assert "unsafe-eval" not in csp


def test_oversized_payload_is_rejected_with_json():
    client = create_app().test_client()
    oversized = b"x" * (MAX_CONTENT_LENGTH + 1024)
    res = client.post("/api/health", data=oversized)
    assert res.status_code == 413
    assert res.mimetype == "application/json"
    assert res.get_json()["error"] == "payload_too_large"


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def test_rate_limit_returns_429_with_retry_after(monkeypatch):
    monkeypatch.setenv("HDSAT_RATE_LIMIT", "3")
    monkeypatch.setenv("HDSAT_RATE_WINDOW", "60")
    client = create_app().test_client()
    for _ in range(3):
        assert client.get("/api/legal").status_code == 200

    blocked = client.get("/api/legal")
    assert blocked.status_code == 429
    assert blocked.get_json()["error"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) >= 1
    assert blocked.headers["X-RateLimit-Remaining"] == "0"
    assert blocked.headers["Cache-Control"] == "no-store"


def test_rate_limit_is_tracked_per_client(monkeypatch):
    monkeypatch.setenv("HDSAT_RATE_LIMIT", "1")
    client = create_app().test_client()
    assert client.get("/api/legal", headers={"X-Forwarded-For": "203.0.113.7"}).status_code == 200
    assert client.get("/api/legal", headers={"X-Forwarded-For": "203.0.113.7"}).status_code == 429
    # A different student behind the same proxy still gets through.
    assert client.get("/api/legal", headers={"X-Forwarded-For": "198.51.100.4"}).status_code == 200


def test_api_responses_publish_remaining_quota(monkeypatch):
    monkeypatch.setenv("HDSAT_RATE_LIMIT", "10")
    client = create_app().test_client()
    first = client.get("/api/legal")
    second = client.get("/api/legal")
    assert first.headers["X-RateLimit-Limit"] == "10"
    assert int(first.headers["X-RateLimit-Remaining"]) == 9
    assert int(second.headers["X-RateLimit-Remaining"]) == 8


def test_static_requests_are_not_rate_limited(monkeypatch):
    monkeypatch.setenv("HDSAT_RATE_LIMIT", "1")
    client = create_app().test_client()
    assert client.get("/api/legal").status_code == 200
    assert client.get("/api/legal").status_code == 429
    # The SPA shell and robots.txt are unaffected by the API limiter.
    assert client.get("/").status_code == 200
    assert client.get("/robots.txt").status_code == 200


# ---------------------------------------------------------------------------
# Crawler policy
# ---------------------------------------------------------------------------


def test_robots_txt_disallows_the_operator_console():
    client = create_app().test_client()
    res = client.get("/robots.txt")
    assert res.status_code == 200
    assert res.mimetype == "text/plain"
    body = res.data.decode("utf-8")
    assert "User-agent: *" in body
    assert "Disallow: /admin" in body

"""Automated pytest suite for HDSAT Flask WSGI backend and question importer."""

from __future__ import annotations

from backend.app import create_app
from supabase.import_check_helper import run_importer_validation


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
    assert client.get("/api/health").headers["Cache-Control"] == "no-store"


def test_unknown_api_route_returns_404():
    app = create_app()
    client = app.test_client()
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404


def test_importer_validation_passes():
    assert run_importer_validation() == 0

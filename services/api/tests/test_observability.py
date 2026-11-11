import json
import logging

from app.core.config import get_settings
from app.core.observability import JsonFormatter, RequestIdFilter, request_id_var


def test_request_id_generated_and_propagated(client):
    r = client.get("/health")
    rid = r.headers["x-request-id"]
    assert len(rid) == 32
    r = client.get("/health", headers={"X-Request-ID": "trace-abc-12345"})
    assert r.headers["x-request-id"] == "trace-abc-12345"
    r = client.get("/health", headers={"X-Request-ID": "bad id\nwith newline"})  # header injection attempt
    assert r.headers["x-request-id"] != "bad id\nwith newline" and len(r.headers["x-request-id"]) == 32


def test_error_bodies_carry_the_request_id(client):
    r = client.get("/auth/me", headers={"X-Request-ID": "support-ticket-777"})
    assert r.status_code == 401
    assert r.json()["error"]["request_id"] == "support-ticket-777"


def test_json_log_format_includes_request_id():
    token = request_id_var.set("rid-12345678")
    try:
        rec = logging.LogRecord("darna.test", logging.WARNING, __file__, 1, "hello %s", ("world",), None)
        RequestIdFilter().filter(rec)
        line = json.loads(JsonFormatter().format(rec))
    finally:
        request_id_var.reset(token)
    assert line["message"] == "hello world" and line["request_id"] == "rid-12345678" and line["level"] == "WARNING"


def test_metrics_disabled_unless_token_and_protected(client, monkeypatch, make_user, project, reviewer):
    assert client.get("/metrics").status_code == 404
    monkeypatch.setattr(get_settings(), "metrics_token", "s3cret-metrics-token")
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
    from tests.conftest import publish_listing
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    client.get(f"/listings/{lid}")
    body = client.get("/metrics", headers={"Authorization": "Bearer s3cret-metrics-token"}).text
    assert 'darna_http_requests_total{method="GET",route="/listings/{listing_id}",status="200"}' in body
    assert lid not in body  # route templates only: no ids in metric labels
    assert "darna_http_request_duration_seconds_bucket" in body

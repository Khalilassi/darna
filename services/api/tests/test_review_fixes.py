import logging
import threading

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core import rate_limit
from app.core.logging_filters import RedactQueryFilter, redact_query
from app.main import app
from app.models.entities import IdempotencyRecord, Offer
from tests.conftest import publish_listing


def test_access_log_redacts_document_tokens():
    assert redact_query("/documents/abc/content?token=u.123.sig&x=1") == "/documents/abc/content?token=[REDACTED]&x=1"
    rec = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", "/documents/d/content?token=secret.1.abc", "1.1", 200), None)
    RedactQueryFilter().filter(rec)
    assert "secret" not in rec.getMessage() and "[REDACTED]" in rec.getMessage()
    assert any(isinstance(f, RedactQueryFilter) for f in logging.getLogger("uvicorn.access").filters)


def test_concurrent_same_key_different_listings_runs_one_action(make_user, project, reviewer, db):
    owner, buyer = make_user(verified=True), make_user()
    a = publish_listing(owner, reviewer, project, unit="1")
    b = publish_listing(owner, reviewer, project, unit="2")
    barrier = threading.Barrier(2)
    codes = []

    def go(lid):
        c = TestClient(app)
        barrier.wait()
        r = c.post("/deals/offers", headers={**buyer.h, "Idempotency-Key": "same-key"},
                   json={"listing_id": lid, "kind": "sale", "amount": "1000"})
        codes.append(r.status_code)

    ts = [threading.Thread(target=go, args=(x,)) for x in (a, b)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [201, 409]
    assert db.scalar(select(func.count()).select_from(Offer)) == 1


def test_failed_action_releases_key_and_success_is_stored(make_user, project, reviewer, db):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    h = {"Idempotency-Key": "k1"}
    bad = buyer.post("/deals/offers", headers=h, json={"listing_id": lid, "kind": "rent", "amount": "10"})
    assert bad.status_code == 422  # sale-only listing -> action fails
    assert db.get(IdempotencyRecord, (buyer.id, "k1")) is None  # reservation released
    ok = buyer.post("/deals/offers", headers={"Idempotency-Key": "k2"}, json={"listing_id": lid, "kind": "sale", "amount": "10"})
    db.expire_all()
    rec = db.get(IdempotencyRecord, (buyer.id, "k2"))
    assert ok.status_code == 201 and rec.status_code == 200 and rec.response["id"] == ok.json()["id"]


def test_crash_after_action_commit_never_repeats_action(make_user, project, reviewer, db):
    """Simulate a crash between the action's commit and saving the response: retries must not re-run it."""
    from app.core.idempotency import IN_PROGRESS
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    body = {"listing_id": lid, "kind": "sale", "amount": "10"}
    assert buyer.post("/deals/offers", headers={"Idempotency-Key": "crashed"}, json=body).status_code == 201
    rec = db.get(IdempotencyRecord, (buyer.id, "crashed"))
    rec.status_code, rec.response = IN_PROGRESS, {}
    db.commit()
    r = buyer.post("/deals/offers", headers={"Idempotency-Key": "crashed"}, json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "idempotency_in_progress"
    assert db.scalar(select(func.count()).select_from(Offer)) == 1


def test_rate_limiter_evicts_inactive_keys(monkeypatch):
    rate_limit.reset()
    monkeypatch.setattr(rate_limit, "SWEEP_EVERY", 10)
    for i in range(9):
        assert rate_limit.hit(f"login:10.0.0.{i}", 5, 60, now=0.0)
    assert rate_limit.size() == 9
    rate_limit.hit("login:10.0.1.1", 5, 60, now=1000.0)  # 10th call triggers sweep; old keys expired
    assert rate_limit.size() == 1
    rate_limit.reset()


def test_negative_limits_rejected(make_user, admin):
    u = make_user()
    assert u.get("/notifications", params={"limit": -1}).status_code == 422
    assert u.get("/notifications", params={"limit": 0}).status_code == 422
    assert admin.get("/admin/users", params={"page_size": -5}).status_code == 422
    assert admin.get("/admin/audit", params={"page_size": 0}).status_code == 422

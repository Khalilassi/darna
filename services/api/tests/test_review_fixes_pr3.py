"""Regression tests for the Copilot review findings on PR #3."""
import glob
import logging
import threading
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core import storage
from app.core.config import get_settings
from app.main import app
from app.models.entities import Document, Listing, ListingPublication, SavedSearch
from app.modules.saved_searches import send_alerts
from tests.conftest import SALE_TERMS, approve_pending_claim, jpeg_bytes, publish_listing, register_property


# Metrics labels: arbitrary client methods collapse to OTHER
def test_metric_labels_bounded_for_custom_methods(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "metrics_token", "tok-123456")
    for m in ("FOO", "BAR", "PROPFIND"):
        client.request(m, "/health")
    body = client.get("/metrics", headers={"Authorization": "Bearer tok-123456"}).text
    assert 'method="OTHER"' in body
    assert 'method="FOO"' not in body and 'method="PROPFIND"' not in body


# Unhandled errors keep the request id
def test_unhandled_error_has_request_id(caplog):
    def boom():
        raise RuntimeError("kaboom")

    if not any(getattr(r, "path", None) == "/__test_boom" for r in app.router.routes):
        app.add_api_route("/__test_boom", boom, include_in_schema=False)
    c = TestClient(app, raise_server_exceptions=False)
    with caplog.at_level(logging.ERROR, logger="darna"):
        r = c.get("/__test_boom", headers={"X-Request-ID": "boom-req-1234"})
    assert r.status_code == 500
    assert r.headers["x-request-id"] == "boom-req-1234"
    assert r.json()["error"] == {"code": "internal_error", "message": "Internal server error", "details": None,
                                 "request_id": "boom-req-1234"}
    assert "kaboom" not in r.text
    assert any(getattr(rec, "request_id", None) == "boom-req-1234" for rec in caplog.records)


# Rotation temp files are unique and never left behind
def test_failed_rotation_leaves_no_temp_file(make_user, db, monkeypatch):
    u = make_user()
    doc = db.get(Document, u.upload_doc("passport", b"%PDF-1.4 rotate"))
    st = storage.private_storage()

    def boom(fd):
        raise OSError("disk full")

    monkeypatch.setattr("app.core.storage.os.fsync", boom)
    with pytest.raises(OSError):
        st.rotate(doc.storage_key)
    monkeypatch.undo()
    assert glob.glob(str(st.root / ".*rotating")) == []
    st.rotate(doc.storage_key)  # works afterwards
    assert st.get(doc.storage_key) == b"%PDF-1.4 rotate"


# Concurrent photo uploads to one listing do not deadlock
def test_concurrent_photo_uploads_same_listing(make_user, project, reviewer):
    owner = make_user(verified=True)
    r = register_property(owner, project)
    approve_pending_claim(reviewer, r.json()["claim"]["id"])
    lid = owner.post("/listings", json={"property_id": r.json()["property"]["id"], "purpose": "sale", "title": "Photo race flat",
                                        "sale_terms": SALE_TERMS}).json()["id"]
    barrier, codes = threading.Barrier(4), []

    def go():
        c = TestClient(app)
        barrier.wait()
        codes.append(c.post(f"/listings/{lid}/photos", headers=owner.h, files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}).status_code)

    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join(timeout=30) for t in ts]
    assert not any(t.is_alive() for t in ts), "uploads hung"
    assert sorted(codes) == [201] * 4
    positions = sorted(p["position"] for p in owner.get(f"/listings/mine/{lid}").json()["photos"])
    assert positions == [0, 1, 2, 3]


# Historical saves survive unsaving
def test_saves_are_historical(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    buyer.put(f"/listings/{lid}/favorite")
    buyer.put(f"/listings/{lid}/favorite")  # idempotent: not a second save
    buyer.delete(f"/listings/{lid}/favorite")
    p = owner.get(f"/listings/mine/{lid}/performance", params={"days": 7}).json()
    assert p["totals"]["saves"] == 1


# Alerts: commit-aware outbox; seen tracking separate from alerts
def test_alerts_use_outbox_and_respect_seen(make_user, project, reviewer, db):
    owner, buyer = make_user(verified=True), make_user()
    sid = buyer.post("/saved-searches", json={"name": "all", "filters": {}}).json()["id"]
    lid = publish_listing(owner, reviewer, project, unit="1")
    pub = db.query(ListingPublication).filter_by(listing_id=lid).one()
    assert pub.processed_at is None
    assert send_alerts(db) == 1
    db.commit()
    db.refresh(pub)
    assert pub.processed_at is not None
    assert send_alerts(db) == 0  # processed rows are never re-sent

    # A publication that commits "late" (row created long ago, still unprocessed) is still picked up.
    lid2 = publish_listing(owner, reviewer, project, unit="2")
    late = db.query(ListingPublication).filter_by(listing_id=lid2).one()
    late.created_at = datetime.now(UTC) - timedelta(hours=3)
    db.commit()
    assert send_alerts(db) == 1
    db.commit()

    # Viewing results marks everything shown as seen immediately; later alerts skip seen listings.
    assert buyer.get("/saved-searches").json()[0]["new_since_last_alert"] == 2
    buyer.get(f"/saved-searches/{sid}/results", params={"mark_seen": True})
    assert buyer.get("/saved-searches").json()[0]["new_since_last_alert"] == 0
    s = db.get(SavedSearch, sid)
    db.refresh(s)
    lid3 = publish_listing(owner, reviewer, project, unit="3")
    db.get(Listing, lid3).published_at = s.last_seen_at - timedelta(seconds=1)  # published before user looked
    db.commit()
    assert send_alerts(db) == 0  # already seen: no alert

    # Republishing (pause/resume) never creates a second outbox row
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    owner.post(f"/listings/{lid}/actions", json={"action": "resume"})
    assert db.query(ListingPublication).filter_by(listing_id=lid).count() == 1

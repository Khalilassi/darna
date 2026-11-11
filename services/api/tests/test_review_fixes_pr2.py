"""Regression tests for the Copilot review findings on PR #2."""
import threading
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal as D

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core import sms, storage
from app.core.config import Settings
from app.finance.engine import Amount, Fee, Installment, SaleInput, compare_cash_vs_installments
from app.main import app
from app.models.entities import Document, Listing, ListingPriceEvent, PhoneVerification, SavedSearch
from app.models.enums import Payer, PaymentMode, Provenance
from app.modules.market import months_ago_start
from tests.conftest import publish_listing

sp = Provenance.seller_provided


# 1. scanner setting
def test_unsupported_scanner_values_rejected():
    k = Fernet.generate_key().decode()
    with pytest.raises(RuntimeError, match="'none' or 'clamd'"):
        Settings(malware_scanner="clamav").validate_for_env()
    with pytest.raises(RuntimeError, match="must be 'clamd'"):
        Settings(env="production", jwt_secret="x" * 40, document_encryption_key=k, malware_scanner="none").validate_for_env()


# 2. atomic local rotation
def test_local_rotation_is_atomic_on_write_failure(make_user, db, monkeypatch):
    u = make_user()
    did = u.upload_doc("national_id", b"%PDF-1.4 keep-me")
    doc = db.get(Document, did)
    st = storage.private_storage()
    path = st._path(doc.storage_key)
    before = path.read_bytes()
    real_fsync = __import__("os").fsync

    def boom(fd):
        raise OSError("disk full")

    monkeypatch.setattr("app.core.storage.os.fsync", boom)
    with pytest.raises(OSError):
        st.rotate(doc.storage_key)
    monkeypatch.setattr("app.core.storage.os.fsync", real_fsync)
    assert path.read_bytes() == before  # original ciphertext untouched
    assert st.get(doc.storage_key) == b"%PDF-1.4 keep-me"


# 3. installment provenance
@pytest.mark.parametrize("prov", [Provenance.estimate, Provenance.unknown])
def test_installments_must_be_known(prov):
    with pytest.raises(ValidationError, match="seller-provided or verified"):
        SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("100"), owner_cash_price=Amount(amount=D("1"), provenance=sp),
                  installments=[Installment(due_date=date(2030, 1, 1), amount=D("10"), provenance=prov)])


# 4. all-in cash comparison (the reviewer's example)
def test_cash_comparison_includes_fees_on_both_sides():
    inp = SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("100"), owner_cash_price=Amount(amount=D("500000"), provenance=sp),
                    installments=[Installment(due_date=date(2030, 1, 1), amount=D("100000"))],
                    fees=[Fee(code="transfer_fee", value=Amount(amount=D("50000"), provenance=sp), payer=Payer.buyer)])
    c = compare_cash_vs_installments(inp, date(2026, 1, 1), D("0"), D("620000"))
    assert c.present_value_total == D("650000.00") and c.other_known_costs == D("50000.00")
    assert c.cash_alternative_all_in == D("670000.00") and c.cheaper_option == "installments"
    assert c.break_even_cash_price == D("600000.00")


# 6. trend counts listings, not price events
def test_trend_sample_counts_listings_not_repricing(make_user, project, reviewer, client, db):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    listing = db.get(Listing, lid)
    base = db.query(ListingPriceEvent).filter_by(listing_id=lid).one()
    for price in ("2600000", "2700000"):  # same listing repriced twice this month
        db.add(ListingPriceEvent(listing_id=lid, property_id=base.property_id, project_id=base.project_id, district_id=base.district_id,
                                 property_type=base.property_type, area_sqm=base.area_sqm, kind="price_changed",
                                 sale_known_total=D(price), created_at=datetime.now(UTC)))
    db.commit()
    s = client.get("/market/summary", params={"project_id": str(project["id"])}).json()
    assert s["trend"][-1]["sample_size"] == 1 and s["trend"][-1]["median_per_sqm"] is None
    assert listing is not None


# 10. calendar months
@pytest.mark.parametrize("today,months,start", [
    (date(2026, 11, 11), 12, date(2025, 12, 1)), (date(2026, 1, 31), 1, date(2026, 1, 1)),
    (date(2026, 3, 15), 3, date(2026, 1, 1)), (date(2026, 1, 5), 13, date(2025, 1, 1)),
])
def test_months_ago_start(today, months, start):
    assert months_ago_start(today, months) == start


# 7 + 11. phone challenges
class Box:
    def __init__(self):
        self.codes = []

    def send(self, phone, text):
        import re
        self.codes.append((phone, re.search(r"\b(\d{6})\b", text).group(1)))


def test_superseded_phone_code_cannot_be_reused(make_user, db):
    box = Box()
    sms.set_sender(box)
    try:
        u = make_user()
        u.post("/auth/phone/start", json={"phone": "01011110000"})
        code_a = box.codes[-1][1]
        for pv in db.query(PhoneVerification).filter_by(user_id=u.id):
            pv.created_at -= timedelta(minutes=2)
        db.commit()
        u.post("/auth/phone/start", json={"phone": "01022220000"})
        assert u.post("/auth/phone/verify", json={"code": box.codes[-1][1]}).status_code == 200
        r = u.post("/auth/phone/verify", json={"code": code_a})
        assert r.status_code == 422 and r.json()["error"]["code"] == "code_expired"
        assert u.get("/auth/me").json()["phone"] == "+201022220000"
    finally:
        sms.set_sender(None)


def test_concurrent_code_requests_respect_cooldown(make_user, db):
    sms.set_sender(Box())
    try:
        u = make_user()
        barrier, codes = threading.Barrier(5), []

        def go():
            c = TestClient(app)
            barrier.wait()
            codes.append(c.post("/auth/phone/start", headers=u.h, json={"phone": "01033330000"}).status_code)

        ts = [threading.Thread(target=go) for _ in range(5)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        assert sorted(codes) == [200] + [429] * 4
        assert db.query(PhoneVerification).filter_by(user_id=u.id).count() == 1
    finally:
        sms.set_sender(None)


# 12. saved-search limit under concurrency
def test_saved_search_limit_holds_under_concurrency(make_user, db):
    u = make_user()
    for i in range(18):
        u.post("/saved-searches", json={"name": f"s{i}", "filters": {}})
    barrier, codes = threading.Barrier(4), []

    def go(i):
        c = TestClient(app)
        barrier.wait()
        codes.append(c.post("/saved-searches", headers=u.h, json={"name": f"race{i}", "filters": {}}).status_code)

    ts = [threading.Thread(target=go, args=(i,)) for i in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [201, 201, 409, 409]
    assert db.query(SavedSearch).filter_by(user_id=u.id).count() == 20


# 13. alert watermark never skips late publications
def test_alert_watermark_lags_so_late_commits_are_not_skipped(make_user, project, reviewer, db, monkeypatch):
    from app.modules.saved_searches import ALERT_LAG, send_alerts
    owner, buyer = make_user(verified=True), make_user()
    sid = buyer.post("/saved-searches", json={"name": "all", "filters": {}}).json()["id"]
    s = db.get(SavedSearch, sid)
    s.last_alerted_at = datetime.now(UTC) - timedelta(hours=1)
    db.commit()
    lid = publish_listing(owner, reviewer, project)
    # Simulate a publication that committed late: published_at is just inside the lag window.
    db.get(Listing, lid).published_at = datetime.now(UTC) - ALERT_LAG / 2
    db.commit()
    assert send_alerts(db) == 0  # too recent to be safely counted yet...
    db.commit()
    db.refresh(s)
    assert s.last_alerted_at < db.get(Listing, lid).published_at  # ...and the watermark did not pass it
    # Time passes: the next run's cutoff moves past the late publication, which is now counted once.
    monkeypatch.setattr("app.modules.saved_searches.alert_cutoff", lambda: datetime.now(UTC))
    assert send_alerts(db) == 1
    db.commit()
    assert send_alerts(db) == 0

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.entities import ListingPriceEvent, LoginThrottle
from app.worker import run_once
from tests.conftest import PASSWORD, SALE_TERMS, publish_listing


# --------------------------------------------------------------------------- price history & market summary
def test_price_history_records_listing_and_changes_only(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    h = client.get(f"/listings/{lid}/price-history").json()
    assert [p["kind"] for p in h] == ["listed"] and h[0]["sale_cash_price"] == "2500000.00"
    # pause + resume without edits: no new event
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    owner.post(f"/listings/{lid}/actions", json={"action": "resume"})
    assert len(client.get(f"/listings/{lid}/price-history").json()) == 1
    # price change goes through re-review, then a price_changed event
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    terms = {**SALE_TERMS, "owner_cash_price": {"amount": "2300000", "provenance": "seller_provided"}}
    owner.patch(f"/listings/{lid}", json={"sale_terms": terms})
    owner.post(f"/listings/{lid}/actions", json={"action": "resume"})
    reviewer.post(f"/admin/listings/{lid}/moderate", json={"action": "approve"})
    h = client.get(f"/listings/{lid}/price-history").json()
    assert [p["kind"] for p in h] == ["listed", "price_changed"] and h[1]["sale_cash_price"] == "2300000.00"


def test_closed_events_never_expose_agreed_price(make_user, project, reviewer, client, db):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project, purpose="rent")
    d = buyer.post("/deals/offers", json={"listing_id": lid, "kind": "rent", "amount": "23000", "terms": {"lease_months": 12}}).json()
    d = owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"}).json()
    for c in d["checklist"]:
        (owner if c["responsible"] == "buyer" else buyer).post(f"/deals/{d['id']}/checklist/{c['id']}", json={"action": "waive"})
    buyer.post(f"/deals/{d['id']}/advance", json={"target": "lease_preparation"})
    for a in (buyer, owner):
        a.post(f"/deals/{d['id']}/advance", json={"target": "lease_signed"})
    owner.post(f"/deals/{d['id']}/advance", json={"target": "handover_scheduled"})
    for a in (buyer, owner):
        a.post(f"/deals/{d['id']}/advance", json={"target": "lease_active"})
    closed = db.query(ListingPriceEvent).filter_by(listing_id=lid, kind="closed").one()
    assert closed.monthly_rent is None and closed.sale_cash_price is None
    assert client.get(f"/listings/{lid}/price-history").status_code == 404  # rented listings are no longer public


def test_market_summary_suppresses_small_samples(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    for unit in ("1", "2"):
        publish_listing(owner, reviewer, project, unit=unit)
    pid, d0 = project["id"], str(project["districts"][0])
    s = client.get("/market/summary", params={"project_id": str(pid)}).json()
    row = next(d for d in s["districts"] if d["district_id"] == d0)
    assert row["active_listings"] == 2 and row["sale"] == {"sample_size": 2, "median_per_sqm": None}
    assert "not valuations" in s["methodology"] and s["min_sample"] == 3
    publish_listing(owner, reviewer, project, unit="3")
    s = client.get("/market/summary", params={"project_id": str(pid)}).json()
    row = next(d for d in s["districts"] if d["district_id"] == d0)
    # known total = 2,500,000 + 200,000 installments + 50,000 maintenance = 2,750,000 over 150 m2
    assert row["sale"]["sample_size"] == 3 and Decimal(row["sale"]["median_per_sqm"]) == Decimal("18333")
    assert row["rent"]["median_per_sqm"] is None
    assert s["trend"][-1]["sample_size"] == 3 and Decimal(s["trend"][-1]["median_per_sqm"]) == Decimal("18333")
    other = next(d for d in s["districts"] if d["district_id"] != d0)
    assert other["active_listings"] == 0 and other["sale"]["median_per_sqm"] is None
    assert client.get("/market/summary", params={"project_id": str(pid), "property_type": "villa"}).json()["trend"] == []


def test_cash_vs_installments_endpoint(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    r = client.get(f"/listings/{lid}/financials/compare", params={"discount_rate": "0", "cash_price": "2690000", "as_of": "2026-01-01"}).json()
    # known total 2,750,000 includes the 50,000 buyer-paid maintenance deposit, which is paid in either option
    assert r["other_known_costs"] == "50000.00" and r["break_even_cash_price"] == "2700000.00"
    assert r["cash_alternative_all_in"] == "2740000.00" and r["cheaper_option"] == "cash"
    r = client.get(f"/listings/{lid}/financials/compare", params={"discount_rate": "0", "cash_price": "2700000", "as_of": "2026-01-01"}).json()
    assert r["cheaper_option"] == "equal"
    assert r["excludes_estimates_and_unknowns"] is True  # the transfer fee is unconfirmed
    assert client.get(f"/listings/{lid}/financials/compare").status_code == 422  # a rate is required


# --------------------------------------------------------------------------- saved searches & alerts
def test_saved_search_crud_results_and_alerts(make_user, project, reviewer, db):
    owner, buyer, other = make_user(verified=True), make_user(), make_user()
    first = publish_listing(owner, reviewer, project, unit="1")
    r = buyer.post("/saved-searches", json={"name": "3BR to buy", "filters": {"purpose": "sale", "bedrooms_min": 3}})
    assert r.status_code == 201
    sid = r.json()["id"]
    assert r.json()["new_since_last_alert"] == 0  # existing listings are not "new"
    assert [x["id"] for x in buyer.get(f"/saved-searches/{sid}/results").json()["items"]] == [first]
    assert other.get(f"/saved-searches/{sid}/results").status_code == 404
    assert buyer.post("/saved-searches", json={"name": "bad", "filters": {"purpose": "lease"}}).status_code == 422

    second = publish_listing(owner, reviewer, project, unit="2")
    publish_listing(owner, reviewer, project, unit="3", purpose="rent")  # does not match
    assert buyer.get("/saved-searches").json()[0]["new_since_last_alert"] == 1
    rep = run_once()
    assert rep.saved_search_alerts == 1
    note = next(n for n in buyer.get("/notifications").json()["items"] if n["type"] == "saved_search_match")
    assert note["data"] == {"saved_search_id": sid, "count": "1"}
    assert run_once().saved_search_alerts == 0  # nothing new since
    assert second in [x["id"] for x in buyer.get(f"/saved-searches/{sid}/results").json()["items"]]

    # owner's own listings never trigger their alerts; disabled alerts are skipped
    owner.post("/saved-searches", json={"name": "mine", "filters": {"purpose": "sale"}})
    buyer.patch(f"/saved-searches/{sid}", json={"alerts_enabled": False})
    publish_listing(owner, reviewer, project, unit="4")
    assert run_once().saved_search_alerts == 0
    assert buyer.delete(f"/saved-searches/{sid}").status_code == 200
    assert buyer.get("/saved-searches").json() == []


def test_saved_search_limit(make_user):
    u = make_user()
    for i in range(20):
        assert u.post("/saved-searches", json={"name": f"s{i}", "filters": {}}).status_code == 201
    r = u.post("/saved-searches", json={"name": "one too many", "filters": {}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "too_many_saved_searches"


# --------------------------------------------------------------------------- account lockout
def test_account_lockout_after_repeated_failures(make_user, client, db):
    u = make_user()
    for _ in range(7):
        assert client.post("/auth/login", json={"email": u.email, "password": "wrong-pass-123"}).status_code == 401
    assert client.post("/auth/login", json={"email": u.email, "password": PASSWORD}).status_code == 200  # success resets
    for _ in range(8):
        client.post("/auth/login", json={"email": u.email, "password": "wrong-pass-123"})
    r = client.post("/auth/login", json={"email": u.email, "password": PASSWORD})  # correct password, still locked
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_failed_logins"
    assert 0 < r.json()["error"]["details"]["retry_after_seconds"] <= 900
    assert any(n["type"] == "account_locked" for n in u.get("/notifications").json()["items"])
    # lock expires
    row = db.query(LoginThrottle).one()
    row.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert client.post("/auth/login", json={"email": u.email, "password": PASSWORD}).status_code == 200


def test_lockout_does_not_reveal_unknown_accounts(client):
    codes = [client.post("/auth/login", json={"email": "ghost@example.com", "password": "wrong-pass-123"}).status_code for _ in range(9)]
    assert codes == [401] * 8 + [429]




def test_arabic_explanations_and_district_id(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    card = client.get("/listings").json()["items"][0]
    assert card["district_id"] == str(project["districts"][0])
    ar = {"Accept-Language": "ar-EG,ar;q=0.9"}
    s = client.get("/market/summary", params={"project_id": str(project["id"])}, headers=ar).json()
    assert "دارنا" in s["methodology"]
    assert "Darna" in client.get("/market/summary", params={"project_id": str(project["id"])}).json()["methodology"]
    c = client.get(f"/listings/{lid}/financials/compare", params={"discount_rate": "0.2"}, headers=ar).json()
    assert "20.00%" in c["assumption"] and "سنويًا" in c["assumption"]
    pv = client.get(f"/listings/{lid}/financials", params={"discount_rate": "0.2"}, headers=ar).json()["present_value"]
    assert "سنويًا" in pv["assumption"]

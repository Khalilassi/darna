from datetime import UTC, datetime, timedelta

from tests.conftest import publish_listing


def test_listing_performance_series_and_funnel(make_user, project, reviewer, client):
    owner, b1, b2 = make_user(verified=True), make_user(), make_user()
    lid = publish_listing(owner, reviewer, project)
    for _ in range(3):
        client.get(f"/listings/{lid}")          # anonymous views
    b1.get(f"/listings/{lid}")
    owner.get(f"/listings/{lid}")               # owner's own views are not counted
    b1.put(f"/listings/{lid}/favorite")
    b1.post("/conversations", json={"listing_id": lid, "message": "Hello"})
    b2.post("/conversations", json={"listing_id": lid, "message": "Hi"})
    when = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    b1.post("/viewings", json={"listing_id": lid, "proposed_at": when})
    d = b1.post("/deals/offers", json={"listing_id": lid, "kind": "sale", "amount": "2400000"}).json()
    owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/counter", json={"amount": "2450000"})  # not new interest

    p = owner.get(f"/listings/mine/{lid}/performance", params={"days": 7}).json()
    assert len(p["series"]) == 7 and p["series"][-1]["day"] == datetime.now(UTC).date().isoformat()
    t = p["totals"]
    assert (t["views"], t["saves"], t["inquiries"], t["viewing_requests"], t["offers"]) == (4, 1, 2, 1, 1)
    assert p["total_views_all_time"] == 4 and p["days_on_market"] == 0
    funnel = {f["step"]: f for f in p["funnel"]}
    assert funnel["views"]["rate_from_previous"] is None
    assert funnel["saves"]["rate_from_previous"] == 0.25 and funnel["inquiries"]["rate_from_previous"] == 2.0
    assert funnel["offers"]["rate_from_previous"] == 1.0


def test_performance_is_owner_only_and_bounded(make_user, project, reviewer):
    owner, other = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    assert other.get(f"/listings/mine/{lid}/performance").status_code == 404
    assert owner.get(f"/listings/mine/{lid}/performance", params={"days": 3}).status_code == 422
    assert owner.get(f"/listings/mine/{lid}/performance", params={"days": 365}).status_code == 422
    empty = owner.get(f"/listings/mine/{lid}/performance").json()
    assert len(empty["series"]) == 30 and empty["totals"]["views"] == 0
    assert all(f["rate_from_previous"] is None for f in empty["funnel"])

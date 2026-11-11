import threading
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import publish_listing


def offer(buyer, lid, amount="2400000", kind="sale", **kw):
    body = {"listing_id": lid, "kind": kind, "amount": amount, **kw}
    if kind == "rent":
        body.setdefault("terms", {"lease_months": 12})
    return buyer.post("/deals/offers", json=body)


def test_sale_negotiation_counter_accept_and_full_closing(make_user, project, reviewer, client):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    deal = offer(buyer, lid).json()
    assert deal["status"] == "negotiating" and deal["my_role"] == "buyer"
    assert deal["property_disclosure"] is None
    o1 = deal["latest_offer"]["id"]

    # Buyer cannot accept own offer; second pending offer blocked
    assert buyer.post(f"/deals/{deal['id']}/offers/{o1}/respond", json={"action": "accept"}).status_code == 403
    assert offer(buyer, lid).json()["error"]["code"] == "offer_pending"

    d = owner.post(f"/deals/{deal['id']}/offers/{o1}/counter", json={"amount": "2480000"}).json()
    assert [o["status"] for o in d["offers"]] == ["countered", "pending"]
    o2 = d["latest_offer"]["id"]
    d = buyer.post(f"/deals/{deal['id']}/offers/{o2}/respond", json={"action": "accept"}).json()
    assert d["status"] == "offer_accepted" and d["agreed_terms"]["amount"] == "2480000.00"
    assert d["agreed_terms"]["preliminary"] is True
    assert d["property_disclosure"]["unit"] == "12"
    assert "not a legal transfer" in d["legal_notice"]
    assert client.get(f"/listings/{lid}").json()["status"] == "under_offer"

    did = deal["id"]
    assert buyer.post(f"/deals/{did}/advance", json={"target": "due_diligence"}).json()["status"] == "due_diligence"
    # contract_preparation is blocked by owner checklist items
    r = buyer.post(f"/deals/{did}/advance", json={"target": "contract_preparation"})
    assert r.status_code == 409 and set(r.json()["error"]["details"]["items"]) == {"ownership_contract", "developer_statement"}

    items = {c["code"]: c["id"] for c in d["checklist"]}
    doc = owner.upload_doc("ownership_contract")
    # buyer cannot submit owner's item; owner cannot accept own item
    assert buyer.post(f"/deals/{did}/checklist/{items['ownership_contract']}", json={"action": "submit"}).status_code == 403
    owner.post(f"/deals/{did}/checklist/{items['ownership_contract']}", json={"action": "submit", "document_id": doc})
    assert owner.post(f"/deals/{did}/checklist/{items['ownership_contract']}", json={"action": "accept"}).status_code == 403
    buyer.post(f"/deals/{did}/checklist/{items['ownership_contract']}", json={"action": "accept"})
    buyer.post(f"/deals/{did}/checklist/{items['developer_statement']}", json={"action": "waive"})

    # Buyer can now read the owner's attached document; an outsider cannot
    url = buyer.post(f"/documents/{doc}/signed-url").json()["url"]
    assert client.get(url.replace("http://localhost:8000", "")).status_code == 200
    outsider = make_user()
    assert outsider.post(f"/documents/{doc}/signed-url").status_code == 404

    # Two-party confirmation
    d = buyer.post(f"/deals/{did}/advance", json={"target": "contract_preparation"}).json()
    assert d["status"] == "due_diligence"
    step = next(s for s in d["next_steps"] if s["status"] == "contract_preparation")
    assert step["my_confirmation_given"] and not step["counterpart_confirmation_given"]
    d = owner.post(f"/deals/{did}/advance", json={"target": "contract_preparation"}).json()
    assert d["status"] == "contract_preparation"

    for code in ("buyer_identity", "owner_identity", "signed_sale_contract", "maintenance_clearance", "developer_assignment_record"):
        c = next(c for c in d["checklist"] if c["code"] == code)
        reviewer_side = owner if c["responsible"] == "buyer" else buyer
        reviewer_side.post(f"/deals/{did}/checklist/{c['id']}", json={"action": "waive"})
    for actor in (buyer, owner):
        d = actor.post(f"/deals/{did}/advance", json={"target": "contract_signed"}).json()
    assert d["status"] == "contract_signed"
    assert buyer.post(f"/deals/{did}/advance", json={"target": "developer_transfer"}).json()["status"] == "developer_transfer"
    for actor in (owner, buyer):
        d = actor.post(f"/deals/{did}/advance", json={"target": "completed"}).json()
    assert d["status"] == "completed" and d["closed_at"]
    assert owner.get(f"/listings/mine/{lid}").json()["status"] == "sold"
    types = [e["type"] for e in d["events"]]
    assert types[0] == "deal.opened" and "milestone.confirmed" in types
    assert client.get(f"/listings/{lid}").status_code == 404


def test_skipping_states_is_rejected(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    d = owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"}).json()
    r = buyer.post(f"/deals/{d['id']}/advance", json={"target": "completed"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state_transition"
    r = buyer.post(f"/deals/{d['id']}/advance", json={"target": "lease_signed"})  # rent state on sale deal
    assert r.status_code == 409


def test_rent_flow_distinct_states(make_user, project, reviewer):
    owner, tenant = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project, purpose="rent")
    assert offer(tenant, lid, kind="sale").json()["error"]["code"] == "offer_kind_mismatch"
    r = tenant.post("/deals/offers", json={"listing_id": lid, "kind": "rent", "amount": "24000"})
    assert r.json()["error"]["code"] == "lease_months_required"
    d = offer(tenant, lid, amount="24000", kind="rent").json()
    d = owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"}).json()
    assert d["status"] == "terms_agreed"
    assert {c["code"] for c in d["checklist"]} == {"ownership_proof", "tenant_identity", "owner_identity", "signed_lease_contract", "handover_inventory"}
    for c in d["checklist"]:
        (owner if c["responsible"] == "buyer" else tenant).post(f"/deals/{d['id']}/checklist/{c['id']}", json={"action": "waive"})
    did = d["id"]
    assert tenant.post(f"/deals/{did}/advance", json={"target": "lease_preparation"}).json()["status"] == "lease_preparation"
    for a in (tenant, owner):
        d = a.post(f"/deals/{did}/advance", json={"target": "lease_signed"}).json()
    # Only the owner schedules handover
    assert tenant.post(f"/deals/{did}/advance", json={"target": "handover_scheduled"}).status_code == 403
    assert owner.post(f"/deals/{did}/advance", json={"target": "handover_scheduled"}).json()["status"] == "handover_scheduled"
    for a in (owner, tenant):
        d = a.post(f"/deals/{did}/advance", json={"target": "lease_active"}).json()
    assert d["status"] == "lease_active"
    assert owner.get(f"/listings/mine/{lid}").json()["status"] == "rented"


def test_sale_and_rent_listing_only_one_commitment(make_user, project, reviewer):
    owner, buyer, tenant = make_user(verified=True), make_user(), make_user()
    lid = publish_listing(owner, reviewer, project, purpose="sale_and_rent")
    s = offer(buyer, lid).json()
    t = offer(tenant, lid, amount="24000", kind="rent").json()
    owner.post(f"/deals/{s['id']}/offers/{s['latest_offer']['id']}/respond", json={"action": "accept"})
    r = owner.post(f"/deals/{t['id']}/offers/{t['latest_offer']['id']}/respond", json={"action": "accept"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "listing_not_accepting_offers"
    assert any(n["type"] == "listing_under_offer" for n in tenant.get("/notifications").json()["items"])
    # New offers are blocked while under offer
    assert offer(make_user(), lid).status_code == 409


def test_cancel_committed_deal_relists(make_user, project, reviewer, client):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"})
    assert buyer.post(f"/deals/{d['id']}/cancel", json={"reason": "x"}).status_code == 422
    r = buyer.post(f"/deals/{d['id']}/cancel", json={"reason": "Financing fell through"}).json()
    assert r["status"] == "cancelled" and r["cancel_reason"] == "Financing fell through"
    assert client.get(f"/listings/{lid}").json()["status"] == "active"
    assert buyer.post(f"/deals/{d['id']}/cancel", json={"reason": "again please"}).status_code == 409


def test_concurrent_acceptance_on_same_listing_single_winner(make_user, project, reviewer):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    buyers = [make_user() for _ in range(5)]
    deals = [offer(b, lid, amount=str(2_400_000 + i)).json() for i, b in enumerate(buyers)]
    barrier = threading.Barrier(len(deals))
    codes = []

    def go(d):
        c = TestClient(app)
        barrier.wait()
        codes.append(c.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", headers=owner.h, json={"action": "accept"}).status_code)

    ts = [threading.Thread(target=go, args=(d,)) for d in deals]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [200] + [409] * 4
    statuses = [owner.get(f"/deals/{d['id']}").json()["status"] for d in deals]
    assert statuses.count("offer_accepted") == 1 and statuses.count("negotiating") == 4


def test_idempotent_offer_submission(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    h = {"Idempotency-Key": "abc-123"}
    r1 = buyer.post("/deals/offers", headers=h, json={"listing_id": lid, "kind": "sale", "amount": "2400000"})
    r2 = buyer.post("/deals/offers", headers=h, json={"listing_id": lid, "kind": "sale", "amount": "2400000"})
    assert r1.status_code == 201 and r2.status_code == 201 and r1.json()["id"] == r2.json()["id"]
    assert len(r2.json()["offers"]) == 1
    r3 = buyer.post("/deals/offers", headers=h, json={"listing_id": lid, "kind": "sale", "amount": "1"})
    assert r3.status_code == 409 and r3.json()["error"]["code"] == "idempotency_key_reused"


def test_offer_expiry(make_user, project, reviewer, db):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    from app.models.entities import Offer
    o = db.get(Offer, d["latest_offer"]["id"])
    o.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    r = owner.post(f"/deals/{d['id']}/offers/{o.id}/respond", json={"action": "accept"})
    assert r.status_code == 409 and r.json()["error"]["details"]["status"] == "expired"
    assert offer(buyer, lid).status_code == 201  # new offer allowed after expiry


def test_withdraw_and_reject(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    oid = d["latest_offer"]["id"]
    assert owner.post(f"/deals/{d['id']}/offers/{oid}/respond", json={"action": "withdraw"}).status_code == 403
    assert buyer.post(f"/deals/{d['id']}/offers/{oid}/respond", json={"action": "withdraw"}).json()["offers"][0]["status"] == "withdrawn"
    d = offer(buyer, lid).json()
    r = owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "reject"}).json()
    assert r["offers"][-1]["status"] == "rejected" and r["status"] == "negotiating"


def test_deal_isolation_and_own_listing(make_user, project, reviewer):
    owner, buyer, outsider = make_user(verified=True), make_user(), make_user()
    lid = publish_listing(owner, reviewer, project)
    assert offer(owner, lid).status_code == 403
    d = offer(buyer, lid).json()
    assert outsider.get(f"/deals/{d['id']}").status_code == 404
    assert outsider.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"}).status_code == 404
    assert outsider.get("/deals").json() == []
    assert len(owner.get("/deals").json()) == 1


def test_representative_scope_enforced_for_negotiation(make_user, project, reviewer, db):
    rep, buyer = make_user(verified=True), make_user()
    doc, poa = rep.upload_doc("ownership_contract"), rep.upload_doc("power_of_attorney")
    from tests.conftest import SALE_TERMS, approve_pending_claim, jpeg_bytes, property_payload
    r = rep.post("/properties", json={"property": property_payload(project), "claim": {
        "capacity": "legal_representative", "principal_name": "Synthetic Principal", "authority_scope": ["list"], "document_ids": [doc, poa]}})
    approve_pending_claim(reviewer, r.json()["claim"]["id"])
    lid = rep.post("/listings", json={"property_id": r.json()["property"]["id"], "purpose": "sale", "title": "Represented listing", "sale_terms": SALE_TERMS}).json()["id"]
    rep.post(f"/listings/{lid}/photos", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")})
    rep.post(f"/listings/{lid}/actions", json={"action": "submit"})
    reviewer.post(f"/admin/listings/{lid}/moderate", json={"action": "approve"})
    d = offer(buyer, lid).json()
    res = rep.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"})
    assert res.status_code == 403 and res.json()["error"]["code"] == "authority_scope_insufficient"


def test_messaging_and_viewings(make_user, project, reviewer, db):
    owner, buyer, outsider = make_user(verified=True), make_user(), make_user()
    lid = publish_listing(owner, reviewer, project)
    assert owner.post("/conversations", json={"listing_id": lid, "message": "hi"}).status_code == 403
    r = buyer.post("/conversations", json={"listing_id": lid, "message": "Is it available? call 01012345678"}).json()
    assert r["safety_tip"] == "keep_payments_off_chat"
    conv = buyer.get("/conversations").json()[0]
    assert r["conversation_id"] == conv["id"]
    assert owner.get("/conversations").json()[0]["unread"] == 1
    assert outsider.get(f"/conversations/{conv['id']}/messages").status_code == 404
    owner.post(f"/conversations/{conv['id']}/messages", json={"body": "Yes, it is."})
    owner.post(f"/conversations/{conv['id']}/read")
    assert owner.get("/conversations").json()[0]["unread"] == 0
    assert [m["body"] for m in buyer.get(f"/conversations/{conv['id']}/messages").json()][-1] == "Yes, it is."
    # Starting again reuses the same conversation
    buyer.post("/conversations", json={"listing_id": lid, "message": "again"})
    assert len(buyer.get("/conversations").json()) == 1

    when = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    assert buyer.post("/viewings", json={"listing_id": lid, "proposed_at": datetime.now(UTC).isoformat()}).status_code == 422
    v = buyer.post("/viewings", json={"listing_id": lid, "proposed_at": when}).json()
    assert buyer.post("/viewings", json={"listing_id": lid, "proposed_at": when}).status_code == 409
    assert buyer.post(f"/viewings/{v['id']}/actions", json={"action": "confirm"}).status_code == 403
    assert owner.post(f"/viewings/{v['id']}/actions", json={"action": "confirm"}).json()["status"] == "confirmed"
    r = owner.post(f"/viewings/{v['id']}/actions", json={"action": "complete"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "viewing_in_future"
    assert buyer.post(f"/viewings/{v['id']}/actions", json={"action": "cancel"}).json()["status"] == "cancelled"
    assert outsider.post(f"/viewings/{v['id']}/actions", json={"action": "cancel"}).status_code == 404


def test_withdrawing_listing_cancels_open_deals(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    owner.post(f"/listings/{lid}/actions", json={"action": "withdraw"})
    got = buyer.get(f"/deals/{d['id']}").json()
    assert got["status"] == "cancelled" and got["offers"][0]["status"] == "withdrawn"

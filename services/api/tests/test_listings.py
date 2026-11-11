import threading

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import SALE_TERMS, approve_pending_claim, jpeg_bytes, publish_listing, register_property


def _owned_property(owner, reviewer, project, **kw):
    r = register_property(owner, project, **kw)
    approve_pending_claim(reviewer, r.json()["claim"]["id"])
    return r.json()["property"]["id"]


def _draft(owner, pid, purpose="sale"):
    body = {"property_id": pid, "purpose": purpose, "title": "Lovely flat for testing", "sale_terms": SALE_TERMS}
    return owner.post("/listings", json=body)


def test_full_publication_journey_and_public_privacy(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    pub = client.get(f"/listings/{lid}").json()
    assert pub["status"] == "active" and pub["owner_verified"] is True
    assert "unit_code" not in pub and "building_code" not in pub
    assert "@" not in str(pub) and owner.email not in str(pub)
    assert pub["owner_display_name"] == "Test"
    sb = pub["sale_breakdown"]
    assert sb["initial_cash_required"] == "2550000.00"  # cash price + buyer-paid maintenance deposit
    assert sb["future_liabilities"] == "200000.00" and sb["unconfirmed"] == ["transfer_fee"]
    search = client.get("/listings", params={"purpose": "sale"}).json()
    assert search["total"] == 1 and search["items"][0]["id"] == lid
    mine = owner.get("/listings/mine").json()[0]
    assert mine["unit_code"] == "12" and mine["stats"]["views"] == 1


def test_listing_requires_approved_claim(make_user, project):
    owner = make_user(verified=True)
    r = register_property(owner, project)
    res = _draft(owner, r.json()["property"]["id"])
    assert res.status_code == 403 and res.json()["error"]["code"] == "not_property_owner"


def test_non_owner_cannot_list_or_modify(make_user, project, reviewer):
    owner, other = make_user(verified=True), make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    assert _draft(other, pid).status_code == 403
    lid = _draft(owner, pid).json()["id"]
    assert other.patch(f"/listings/{lid}", json={"title": "Hijacked listing"}).status_code == 404
    assert other.post(f"/listings/{lid}/actions", json={"action": "withdraw"}).status_code == 404
    assert other.post(f"/listings/{lid}/photos", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}).status_code == 404


def test_one_live_listing_per_property_sale_vs_rent(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    assert _draft(owner, pid, "sale").status_code == 201
    r = owner.post("/listings", json={"property_id": pid, "purpose": "rent", "title": "Same flat for rent",
                                      "rent_terms": {"monthly_rent": "20000"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "property_already_listed"


def test_withdrawn_listing_frees_property(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    lid = _draft(owner, pid).json()["id"]
    assert owner.post(f"/listings/{lid}/actions", json={"action": "withdraw"}).status_code == 200
    assert _draft(owner, pid).status_code == 201


def test_concurrent_listing_creation_single_winner(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    n = 8
    barrier = threading.Barrier(n)
    codes = []

    def go(purpose):
        c = TestClient(app)
        barrier.wait()
        body = {"property_id": pid, "purpose": purpose, "title": "Concurrent listing attempt"}
        body["sale_terms" if purpose == "sale" else "rent_terms"] = SALE_TERMS if purpose == "sale" else {"monthly_rent": "1000"}
        codes.append(c.post("/listings", headers=owner.h, json=body).status_code)

    ts = [threading.Thread(target=go, args=("sale" if i % 2 else "rent",)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [201] + [409] * (n - 1)


def test_submit_requires_identity_and_photo(make_user, project, reviewer, db):
    owner = make_user()
    pid = _owned_property(owner, reviewer, project)
    lid = _draft(owner, pid).json()["id"]
    r = owner.post(f"/listings/{lid}/actions", json={"action": "submit"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "identity_not_verified"
    from datetime import UTC, datetime

    from app.models.entities import User
    u = db.get(User, owner.id)
    u.identity_verified_at = datetime.now(UTC)
    db.commit()
    r = owner.post(f"/listings/{lid}/actions", json={"action": "submit"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "photo_required"


def test_owner_cannot_self_verify_amounts(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    terms = {**SALE_TERMS, "owner_cash_price": {"amount": "100", "provenance": "verified"}}
    r = owner.post("/listings", json={"property_id": pid, "purpose": "sale", "title": "Self verified price", "sale_terms": terms})
    assert r.status_code == 422 and r.json()["error"]["code"] == "cannot_self_verify"


def test_invalid_sale_terms_rejected(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    terms = {**SALE_TERMS, "payment_mode": "cash"}  # cash with installments is contradictory
    r = owner.post("/listings", json={"property_id": pid, "purpose": "sale", "title": "Contradictory terms", "sale_terms": terms})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_sale_terms"
    r = owner.post("/listings", json={"property_id": pid, "purpose": "sale", "title": "Missing terms here"})
    assert r.status_code == 422


def test_edit_requires_pause_and_rereview(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    r = owner.patch(f"/listings/{lid}", json={"title": "Updated title for flat"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "listing_not_editable"
    assert owner.post(f"/listings/{lid}/actions", json={"action": "pause"}).json()["status"] == "paused"
    assert client.get(f"/listings/{lid}").status_code == 404  # paused listings are not public
    assert owner.patch(f"/listings/{lid}", json={"title": "Updated title for flat"}).status_code == 200
    assert owner.post(f"/listings/{lid}/actions", json={"action": "resume"}).json()["status"] == "pending_review"


def test_resume_without_edits_goes_live(make_user, project, reviewer):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    assert owner.post(f"/listings/{lid}/actions", json={"action": "resume"}).json()["status"] == "active"


def test_invalid_listing_transition(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    lid = _draft(owner, pid).json()["id"]
    r = owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state_transition"


def test_moderation_reject_and_approval_requires_verified_owner(make_user, project, reviewer, db):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    lid = _draft(owner, pid).json()["id"]
    owner.post(f"/listings/{lid}/photos", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")})
    owner.post(f"/listings/{lid}/actions", json={"action": "submit"})
    assert reviewer.post(f"/admin/listings/{lid}/moderate", json={"action": "reject"}).status_code == 422  # note required
    r = reviewer.post(f"/admin/listings/{lid}/moderate", json={"action": "reject", "note": "Photos unclear"})
    assert r.status_code == 200
    mine = owner.get(f"/listings/mine/{lid}").json()
    assert mine["status"] == "rejected" and mine["moderation_note"] == "Photos unclear"


def test_photo_upload_strips_metadata_and_rejects_non_images(make_user, project, reviewer):
    owner = make_user(verified=True)
    pid = _owned_property(owner, reviewer, project)
    lid = _draft(owner, pid).json()["id"]
    r = owner.post(f"/listings/{lid}/photos", files={"file": ("x.jpg", b"not an image at all", "image/jpeg")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_image"
    import io

    from PIL import Image
    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    Image.new("RGB", (40, 40)).save(buf, format="JPEG", exif=exif)
    r = owner.post(f"/listings/{lid}/photos", files={"file": ("e.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 201
    from app.core.storage import public_storage
    key = r.json()["url"].rsplit("/", 1)[1]
    assert b"SecretCameraMaker" not in (public_storage().root / key).read_bytes()


def test_search_filters_and_sorting(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    a = publish_listing(owner, reviewer, project, unit="1")
    b = publish_listing(owner, reviewer, project, unit="2", purpose="rent")
    c = publish_listing(owner, reviewer, project, unit="3", purpose="sale_and_rent", district_idx=1)
    ids = lambda r: {i["id"] for i in r.json()["items"]}  # noqa: E731
    assert ids(client.get("/listings", params={"purpose": "sale"})) == {a, c}
    assert ids(client.get("/listings", params={"purpose": "rent"})) == {b, c}
    assert ids(client.get("/listings", params={"district_id": str(project["districts"][1])})) == {c}
    assert ids(client.get("/listings", params={"purpose": "rent", "furnished": True})) == {b, c}
    assert ids(client.get("/listings", params={"bedrooms_min": 4})) == set()
    assert ids(client.get("/listings", params={"payment_mode": "installments"})) == {a, c}
    assert client.get("/listings", params={"page_size": 2}).json()["total"] == 3
    assert client.get("/listings", params={"sort": "nonsense"}).status_code == 422


def test_favorites_and_compare(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    a = publish_listing(owner, reviewer, project, unit="1")
    b = publish_listing(owner, reviewer, project, unit="2")
    assert buyer.put(f"/listings/{a}/favorite").status_code == 200
    assert buyer.put(f"/listings/{a}/favorite").status_code == 200  # idempotent
    assert [x["id"] for x in buyer.get("/listings/favorites").json()] == [a]
    assert buyer.get(f"/listings/{a}").json()["is_favorite"] is True
    assert buyer.delete(f"/listings/{a}/favorite").status_code == 200
    assert buyer.get("/listings/favorites").json() == []
    cmp = buyer.get("/listings/compare", params=[("ids", a), ("ids", b)]).json()
    assert [x["id"] for x in cmp] == [a, b] and all(x["sale_breakdown"] for x in cmp)


def test_financial_scenario_present_value(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    r = client.get(f"/listings/{lid}/financials", params={"discount_rate": "0.2", "as_of": "2026-01-01"}).json()
    pv = r["present_value"]
    assert pv["nominal_future"] == "200000.00" and float(pv["present_value"]) < 200000
    assert "user-supplied" in pv["assumption"]


def test_financial_verification_upgrades_provenance_and_edit_resets(make_user, project, reviewer, client):
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    doc = owner.upload_doc("developer_statement")
    r = owner.post("/verifications/financial", json={"listing_id": lid, "document_ids": [doc]})
    assert r.status_code == 201
    vr = next(v for v in reviewer.get("/admin/verifications", params={"kind": "financial"}).json())
    assert reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "approve"}).status_code == 200
    pub = client.get(f"/listings/{lid}").json()
    assert pub["financials_verified"] is True
    assert pub["sale_breakdown"]["line_items"][0]["provenance"] == "verified"
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    owner.patch(f"/listings/{lid}", json={"sale_terms": SALE_TERMS})
    assert owner.get(f"/listings/mine/{lid}").json()["financials_verified"] is False

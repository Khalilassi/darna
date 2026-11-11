from datetime import UTC, datetime

from app.models.entities import ServiceReferral, User
from app.models.enums import Role
from tests.conftest import publish_listing

PROVIDER = {"category": "lawyer", "name_en": "Synthetic Legal Co", "name_ar": "شركة قانونية تجريبية",
            "phone": "+201000000001", "email": "legal@example.com", "license_number": "SYN-1"}


def _provider(admin, **kw):
    r = admin.post("/admin/services/providers", json={**PROVIDER, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_directory_shows_only_verified_active_providers(make_user, admin, project, client):
    p = _provider(admin)
    assert client.get("/services/providers").json() == []  # not verified yet
    admin.patch(f"/admin/services/providers/{p['id']}", json={"verified": True})
    listed = client.get("/services/providers").json()
    assert [x["id"] for x in listed] == [p["id"]] and listed[0]["verified"] is True
    assert client.get("/services/providers", params={"category": "mover"}).json() == []
    # project filter: provider limited to another community is hidden
    import uuid
    admin.patch(f"/admin/services/providers/{p['id']}", json={"project_ids": [str(uuid.uuid4())]})
    assert client.get("/services/providers", params={"project_id": str(project["id"])}).json() == []
    admin.patch(f"/admin/services/providers/{p['id']}", json={"project_ids": [], "is_active": False})
    assert client.get("/services/providers").json() == []


def test_suggestions_follow_deal_stage_and_are_party_only(make_user, project, reviewer):
    owner, buyer, outsider = make_user(verified=True), make_user(), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = buyer.post("/deals/offers", json={"listing_id": lid, "kind": "sale", "amount": "2400000"}).json()
    assert buyer.get("/services/suggestions", params={"deal_id": d["id"]}).json()["categories"] == []
    owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"})
    s = buyer.get("/services/suggestions", params={"deal_id": d["id"]}).json()
    assert s["status"] == "offer_accepted" and s["categories"] == ["lawyer", "surveyor"]
    assert outsider.get("/services/suggestions", params={"deal_id": d["id"]}).status_code == 404


def test_referral_rules_disclosure_consent_and_privacy(make_user, admin, db):
    p = _provider(admin, referral_fee_disclosure_en="Darna may receive a fixed fee if you hire this provider.",
                  referral_fee_disclosure_ar="قد تحصل دارنا على رسوم ثابتة إذا تعاملت مع هذا المزود.")
    admin.patch(f"/admin/services/providers/{p['id']}", json={"verified": True})
    u = make_user()
    r = u.post("/services/referrals", json={"provider_id": p["id"], "message": "Need contract review"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "disclosure_not_acknowledged"
    r = u.post("/services/referrals", json={"provider_id": p["id"], "acknowledged_disclosure": True, "share_phone": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "phone_not_verified"
    ok = u.post("/services/referrals", json={"provider_id": p["id"], "acknowledged_disclosure": True, "message": "Need contract review"})
    assert ok.status_code == 201 and ok.json()["status"] == "requested"
    dup = u.post("/services/referrals", json={"provider_id": p["id"], "acknowledged_disclosure": True})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "referral_exists"
    # Admin sees the user's phone only when the user chose to share it
    user = db.get(User, u.id)
    user.phone, user.phone_verified_at = "+201012345678", datetime.now(UTC)
    db.commit()
    u.post(f"/services/referrals/{ok.json()['id']}/cancel")
    shared = u.post("/services/referrals", json={"provider_id": p["id"], "acknowledged_disclosure": True, "share_phone": True}).json()
    rows = {x["id"]: x for x in admin.get("/admin/services/referrals").json()}
    assert rows[ok.json()["id"]]["user_phone"] is None and rows[ok.json()["id"]]["status"] == "cancelled"
    assert rows[shared["id"]]["user_phone"] == "+201012345678"
    assert admin.patch(f"/admin/services/referrals/{shared['id']}", json={"status": "contacted"}).json()["status"] == "contacted"
    assert u.get("/services/referrals").json()[0]["status"] == "contacted"
    assert db.query(ServiceReferral).count() == 2


def test_referral_to_unverified_provider_and_foreign_deal_rejected(make_user, admin, project, reviewer):
    p = _provider(admin)
    u = make_user()
    assert u.post("/services/referrals", json={"provider_id": p["id"]}).status_code == 404
    admin.patch(f"/admin/services/providers/{p['id']}", json={"verified": True})
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = buyer.post("/deals/offers", json={"listing_id": lid, "kind": "sale", "amount": "2400000"}).json()
    assert u.post("/services/referrals", json={"provider_id": p["id"], "deal_id": d["id"]}).status_code == 404
    assert buyer.post("/services/referrals", json={"provider_id": p["id"], "deal_id": d["id"]}).status_code == 201


def test_services_admin_permissions(make_user, admin):
    member, reviewer_user, support = make_user(), make_user(Role.reviewer), make_user(Role.support)
    assert member.get("/admin/services/providers").status_code == 403
    assert reviewer_user.get("/admin/services/providers").status_code == 403
    assert support.get("/admin/services/providers").status_code == 200
    bad = admin.post("/admin/services/providers", json={**PROVIDER, "website": "not a url"})
    assert bad.status_code == 422

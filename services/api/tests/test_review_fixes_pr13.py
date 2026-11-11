"""Regression tests for review findings on the services directory (PR #13)."""
import threading
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app
from app.models.entities import User
from tests.test_services import _provider


def _verified_provider(admin, **kw):
    p = _provider(admin, **kw)
    admin.patch(f"/admin/services/providers/{p['id']}", json={"verified": True})
    return p


def test_concurrent_referral_requests_create_one_open_referral(make_user, admin):
    p = _verified_provider(admin)
    u = make_user()
    n = 6
    barrier = threading.Barrier(n)
    codes = []

    def go():
        c = TestClient(app)
        barrier.wait()
        codes.append(c.post("/services/referrals", headers=u.h, json={"provider_id": p["id"]}).status_code)

    ts = [threading.Thread(target=go) for _ in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [201] + [409] * (n - 1)
    assert len(u.get("/services/referrals").json()) == 1


def test_admin_sees_phone_verified_at_consent_not_a_later_number(make_user, admin, db):
    p = _verified_provider(admin)
    u = make_user()
    user = db.get(User, u.id)
    user.phone, user.phone_verified_at = "+201012345678", datetime.now(UTC)
    db.commit()
    r = u.post("/services/referrals", json={"provider_id": p["id"], "share_phone": True}).json()
    # The user later changes to a different, unverified number.
    db.refresh(user)
    user.phone, user.phone_verified_at = "+201099999999", None
    db.commit()
    row = next(x for x in admin.get("/admin/services/referrals").json() if x["id"] == r["id"])
    assert row["user_phone"] == "+201012345678"
    patched = admin.patch(f"/admin/services/referrals/{r['id']}", json={"status": "contacted"}).json()
    assert patched["user_phone"] == "+201012345678"


def test_website_longer_than_column_is_rejected(admin):
    long_url = "https://example.com/" + "a" * 190
    r = admin.post("/admin/services/providers", json={**_base(), "website": long_url})
    assert r.status_code == 422
    d = r.json()["error"]["details"][0]
    assert d["type"] == "url_too_long" and d["ctx"] == {"max_length": 200}
    p = _provider(admin)
    r = admin.patch(f"/admin/services/providers/{p['id']}", json={"website": long_url})
    assert r.status_code == 422
    assert admin.patch(f"/admin/services/providers/{p['id']}", json={"website": "https://example.com/ok"}).status_code == 200


def test_patch_rejects_null_for_required_fields_but_clears_optional(admin):
    p = _provider(admin, website="https://example.com")
    for field in ("project_ids", "name_en", "category", "is_active", "description_en"):
        r = admin.patch(f"/admin/services/providers/{p['id']}", json={field: None})
        assert r.status_code == 422, (field, r.status_code)
        assert r.json()["error"]["details"][0]["type"] == "null_not_allowed"
    cleared = admin.patch(f"/admin/services/providers/{p['id']}", json={"website": None, "phone": None})
    assert cleared.status_code == 200 and cleared.json()["website"] is None


def test_admin_cannot_reopen_a_cancelled_referral(make_user, admin):
    p = _verified_provider(admin)
    u = make_user()
    r = u.post("/services/referrals", json={"provider_id": p["id"]}).json()
    u.post(f"/services/referrals/{r['id']}/cancel")
    res = admin.patch(f"/admin/services/referrals/{r['id']}", json={"status": "contacted"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "referral_closed"


def _base():
    from tests.test_services import PROVIDER
    return PROVIDER

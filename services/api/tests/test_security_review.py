"""Regression tests for the internal security review (2026-11-11)."""
import time

import pytest

from app.core import totp
from app.models.enums import Role
from tests.conftest import PASSWORD
from tests.test_hardening import sms_box  # noqa: F401  (fixture)


def _enrol(actor, client):
    """Enrol TOTP for an actor; returns (secret, fresh MFA token pair) and switches the actor to it."""
    setup = actor.post("/auth/mfa/setup", json={"password": PASSWORD}).json()
    code = totp.code_at(setup["secret"], int(time.time() // 30))
    tokens = actor.post("/auth/mfa/confirm", json={"code": code}).json()
    actor.token = tokens["access_token"]
    return setup["secret"], tokens


def test_reviewer_without_mfa_session_cannot_read_private_documents(make_user, client, monkeypatch):
    from app.core.config import get_settings
    victim = make_user()
    doc = victim.upload_doc("national_id")
    staff = make_user(Role.reviewer, "Doc Reviewer")
    monkeypatch.setattr(get_settings(), "require_staff_mfa", True)
    # Password-only staff session: no staff document access (previously bypassed require()).
    assert staff.post(f"/documents/{doc}/signed-url").status_code == 404
    _enrol(staff, client)
    url = staff.post(f"/documents/{doc}/signed-url").json()["url"]
    assert client.get(url.replace("http://localhost:8000", "")).status_code == 200
    # A URL signed for a password-only session is refused at read time even if the bit is forged.
    forged = url.replace(".1.", ".0.", 1)
    assert client.get(forged.replace("http://localhost:8000", "")).status_code in (401, 404)


def test_mfa_confirm_revokes_sessions_opened_before_enrolment(make_user, client):
    member = make_user()
    old_refresh = client.post("/auth/login", json={"email": member.email, "password": PASSWORD}).json()["refresh_token"]
    _, tokens = _enrol(member, client)
    new = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert new.status_code == 200
    # The pre-enrolment session is dead; presenting it again is treated as token reuse and ends the family.
    r = client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 401 and r.json()["error"]["code"] == "token_reuse"
    assert client.post("/auth/refresh", json={"refresh_token": new.json()["refresh_token"]}).status_code == 401


def test_financial_approval_refused_when_figures_changed_after_submission(make_user, project, reviewer, client):
    from tests.conftest import SALE_TERMS, publish_listing
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    doc = owner.upload_doc("developer_statement")
    assert owner.post("/verifications/financial", json={"listing_id": lid, "document_ids": [doc]}).status_code == 201
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    edited = {**SALE_TERMS, "owner_cash_price": {"amount": "900000", "provenance": "seller_provided"}}
    assert owner.patch(f"/listings/{lid}", json={"sale_terms": edited}).status_code == 200
    vr = reviewer.get("/admin/verifications", params={"kind": "financial"}).json()["items"][0]
    r = reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "approve"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "terms_changed_since_submission"
    mine = owner.get(f"/listings/mine/{lid}").json()
    assert mine["financials_verified"] is False


def test_title_edit_does_not_block_financial_approval(make_user, project, reviewer):
    from tests.conftest import publish_listing
    owner = make_user(verified=True)
    lid = publish_listing(owner, reviewer, project)
    doc = owner.upload_doc("developer_statement")
    owner.post("/verifications/financial", json={"listing_id": lid, "document_ids": [doc]})
    owner.post(f"/listings/{lid}/actions", json={"action": "pause"})
    owner.patch(f"/listings/{lid}", json={"title": "A new title for the same home"})
    vr = reviewer.get("/admin/verifications", params={"kind": "financial"}).json()["items"][0]
    assert reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "approve"}).status_code == 200


def test_cancelled_deal_ends_counterparty_document_access_and_allows_deletion(make_user, project, reviewer):
    from tests.conftest import publish_listing
    from tests.test_deals import offer
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    d = owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"}).json()
    item = next(c for c in d["checklist"] if c["responsible"] == "owner")
    doc = owner.upload_doc("national_id")
    owner.post(f"/deals/{d['id']}/checklist/{item['id']}", json={"action": "submit", "document_id": doc})
    assert buyer.post(f"/documents/{doc}/signed-url").status_code == 200
    assert owner.delete(f"/documents/{doc}").status_code == 403  # retained while the deal is live
    assert buyer.post(f"/deals/{d['id']}/cancel", json={"reason": "Changed my mind"}).status_code == 200
    assert buyer.post(f"/documents/{doc}/signed-url").status_code == 404
    assert owner.delete(f"/documents/{doc}").status_code == 200


def test_verification_evidence_cannot_be_deleted(make_user, reviewer):
    u = make_user()
    did = u.upload_doc("national_id")
    assert u.post("/verifications/identity", json={"document_ids": [did]}).status_code == 201
    r = u.delete(f"/documents/{did}")
    assert r.status_code == 403 and r.json()["error"]["code"] == "document_in_verification"
    assert reviewer.post(f"/documents/{did}/signed-url").status_code == 200
    spare = u.upload_doc("passport")  # unrelated documents can still be deleted
    assert u.delete(f"/documents/{spare}").status_code == 200


def test_suspending_an_owner_removes_listings_under_offer_and_blocks_approval(make_user, project, reviewer, admin, client):
    from tests.conftest import publish_listing
    from tests.test_deals import offer
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = offer(buyer, lid).json()
    owner.post(f"/deals/{d['id']}/offers/{d['latest_offer']['id']}/respond", json={"action": "accept"})
    assert client.get(f"/listings/{lid}").json()["status"] == "under_offer"
    assert admin.patch(f"/admin/users/{owner.id}", json={"is_active": False, "suspended_reason": "Policy review"}).status_code == 200
    assert client.get(f"/listings/{lid}").status_code == 404
    assert lid not in {x["id"] for x in client.get("/listings").json()["items"]}


@pytest.mark.usefixtures("sms_box")
def test_sms_codes_to_one_number_are_capped_across_accounts(make_user, db):
    from datetime import timedelta

    from app.models.entities import PhoneVerification
    codes = []
    for _ in range(6):
        u = make_user()
        codes.append(u.post("/auth/phone/start", json={"phone": "01077778888"}).status_code)
        for pv in db.query(PhoneVerification).filter_by(phone="+201077778888"):
            pv.created_at = pv.created_at - timedelta(minutes=2)
        db.commit()
    assert codes == [200] * 5 + [429]


def test_decompression_bomb_photo_rejected():
    import io

    from PIL import Image

    from app.core.errors import ValidationFailed
    from app.core.storage import process_image
    buf = io.BytesIO()
    Image.new("1", (9000, 9000)).save(buf, format="PNG")  # tiny file, 81M pixels when decoded
    assert len(buf.getvalue()) < 200_000
    with pytest.raises(ValidationFailed) as ei:
        process_image(buf.getvalue())
    assert ei.value.code == "image_too_large"

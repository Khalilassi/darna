"""Regression tests for the internal security review (2026-11-11)."""
import time

import pytest

from app.core import totp
from app.models.enums import Role
from tests.conftest import PASSWORD
from tests.test_hardening import sms_box  # noqa: F401  (fixture)


def _enrol(actor, client, db=None):
    """Enrol TOTP for an actor; returns (secret, fresh MFA token pair) and switches the actor to it.
    Pass ``db`` for staff accounts: an enrolment code is issued as an admin would."""
    body = {"password": PASSWORD}
    if db is not None:
        from app.core import mfa_enrollment
        from app.models.entities import User
        body["enrollment_code"], _ = mfa_enrollment.issue(db.get(User, actor.id))
        db.commit()
    setup = actor.post("/auth/mfa/setup", json=body).json()
    code = totp.code_at(setup["secret"], int(time.time() // 30))
    tokens = actor.post("/auth/mfa/confirm", json={"code": code}).json()
    actor.token = tokens["access_token"]
    return setup["secret"], tokens


def test_reviewer_without_mfa_session_cannot_read_private_documents(make_user, client, monkeypatch, db):
    from app.core.config import get_settings
    victim = make_user()
    doc = victim.upload_doc("national_id")
    staff = make_user(Role.reviewer, "Doc Reviewer")
    monkeypatch.setattr(get_settings(), "require_staff_mfa", True)
    # Password-only staff session: no staff document access (previously bypassed require()).
    assert staff.post(f"/documents/{doc}/signed-url").status_code == 404
    _enrol(staff, client, db)
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


def test_staff_mfa_enrolment_needs_an_admin_issued_code(make_user, admin, client, monkeypatch):
    """Knowing an un-enrolled staff account's password is not enough to bind an authenticator."""
    from app.core.config import get_settings
    staff = make_user(Role.reviewer, "New Reviewer")
    member = make_user()
    # The admin enrols first (the fixture admin has no MFA yet: policy off while bootstrapping).
    code_r = admin.post(f"/admin/users/{staff.id}/mfa-enrollment-code")
    assert code_r.status_code == 200
    code = code_r.json()["code"]
    assert admin.post(f"/admin/users/{member.id}/mfa-enrollment-code").json()["error"]["code"] == "not_staff"
    monkeypatch.setattr(get_settings(), "require_staff_mfa", True)
    r = staff.post("/auth/mfa/setup", json={"password": PASSWORD})
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_enrollment_code_required"
    r = staff.post("/auth/mfa/setup", json={"password": PASSWORD, "enrollment_code": "AAAA-BBBB-CCCC"})
    assert r.status_code == 403
    setup = staff.post("/auth/mfa/setup", json={"password": PASSWORD, "enrollment_code": code.lower().replace("-", " ")})
    assert setup.status_code == 200
    totp_code = totp.code_at(setup.json()["secret"], int(time.time() // 30))
    tokens = staff.post("/auth/mfa/confirm", json={"code": totp_code}).json()
    staff.token = tokens["access_token"]
    assert staff.get("/admin/verifications").status_code == 200
    # Members still enrol with just their password, and admins without an MFA session cannot issue codes.
    assert member.post("/auth/mfa/setup", json={"password": PASSWORD}).status_code == 200
    r = admin.post(f"/admin/users/{staff.id}/mfa-enrollment-code")
    assert r.status_code == 403


def test_enrolment_code_is_single_use_and_expires(make_user, db):
    from datetime import timedelta

    from app.core import mfa_enrollment
    from app.models.entities import User
    staff = make_user(Role.reviewer, "Code Holder")
    u = db.get(User, staff.id)
    code, expires = mfa_enrollment.issue(u)
    assert mfa_enrollment.check(u, code) and mfa_enrollment.check(u, code.replace("-", "").lower())
    assert not mfa_enrollment.check(u, code, now=expires + timedelta(seconds=1))
    mfa_enrollment.clear(u)
    assert not mfa_enrollment.check(u, code)


def test_cli_issues_code_for_staff_only(make_user, capsys):
    from app.staff_mfa_code import main
    staff = make_user(Role.admin, "Bootstrap Admin")
    member = make_user()
    assert main([staff.email]) == 0
    assert len(capsys.readouterr().out.split()[0]) == 14  # XXXX-XXXX-XXXX
    assert main([member.email]) == 1
    assert main([]) == 2


def test_delete_waits_for_a_concurrent_submission_referencing_the_document(make_user):
    """A verification that validated the document first must not end up pointing at a deleted file."""
    import threading
    import uuid as _uuid

    from fastapi.testclient import TestClient

    from app.core.db import session_factory
    from app.main import app
    from app.models.entities import User, VerificationRequest
    from app.models.enums import VerificationKind
    from app.modules.documents import get_owned_documents
    u = make_user()
    did = u.upload_doc("national_id")
    s1 = session_factory()()
    try:
        owner = s1.get(User, u.id)
        docs = get_owned_documents(s1, owner, [_uuid.UUID(did)])  # validated + locked, not yet committed
        s1.add(VerificationRequest(user_id=owner.id, kind=VerificationKind.identity, document_ids=[str(d.id) for d in docs]))
        s1.flush()
        result = {}
        t = threading.Thread(target=lambda: result.setdefault("r", TestClient(app).delete(f"/documents/{did}", headers=u.h)))
        t.start()
        t.join(timeout=1.0)
        assert t.is_alive(), "delete must wait for the submission holding the document lock"
        s1.commit()
        t.join(timeout=10)
        assert result["r"].status_code == 403 and result["r"].json()["error"]["code"] == "document_in_verification"
    finally:
        s1.close()


def test_withdrawing_a_claim_withdraws_its_verification_and_frees_the_evidence(make_user, project, reviewer):
    from tests.conftest import property_payload
    owner = make_user()
    doc = owner.upload_doc("ownership_contract")
    r = owner.post("/properties", json={"property": property_payload(project), "claim": {"document_ids": [doc]}})
    claim_id = r.json()["claim"]["id"]
    assert owner.delete(f"/documents/{doc}").status_code == 403
    assert owner.post(f"/properties/claims/{claim_id}/withdraw").status_code == 200
    queue = reviewer.get("/admin/verifications", params={"kind": "ownership"}).json()["items"]
    assert all(i["claim_id"] != claim_id for i in queue)
    assert owner.delete(f"/documents/{doc}").status_code == 200

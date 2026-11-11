from app.core.storage import private_storage
from app.models.entities import AuditLog, Document


def test_documents_encrypted_at_rest_and_private(make_user, client, db):
    a, b = make_user(), make_user()
    secret = b"%PDF-1.4 national id SYNTHETIC-ID-29801011234567"
    did = a.upload_doc("national_id", secret)
    doc = db.get(Document, did)
    raw = (private_storage().root / doc.storage_key).read_bytes()
    assert b"SYNTHETIC-ID" not in raw  # ciphertext on disk
    assert b.post(f"/documents/{did}/signed-url").status_code == 404
    assert [d["id"] for d in a.get("/documents").json()] == [did]
    assert b.get("/documents").json() == []
    url = a.post(f"/documents/{did}/signed-url").json()["url"].replace("http://localhost:8000", "")
    r = client.get(url)
    assert r.status_code == 200 and r.content == secret and r.headers["cache-control"] == "private, no-store"
    assert db.query(AuditLog).filter_by(action="document.read", entity_id=str(did)).count() == 1


def test_signed_url_tampering_and_revocation(make_user, client, reviewer):
    a, b = make_user(), make_user()
    did = a.upload_doc("passport")
    url = a.post(f"/documents/{did}/signed-url").json()["url"].replace("http://localhost:8000", "")
    token = url.split("token=")[1]
    uid, exp, sig = token.split(".")
    forged = f"/documents/{did}/content?token={b.id}.{exp}.{sig}"
    assert client.get(forged).status_code == 401
    expired = f"/documents/{did}/content?token={uid}.1.{sig}"
    assert client.get(expired).status_code == 401
    assert client.get(f"/documents/{did}/content").status_code == 422
    # Reviewer can access for verification
    assert reviewer.post(f"/documents/{did}/signed-url").status_code == 200
    # Deleting revokes previously issued URLs
    assert a.delete(f"/documents/{did}").status_code == 200
    assert client.get(url).status_code == 404


def test_upload_validation(make_user):
    a = make_user()
    r = a.post("/documents", data={"kind": "national_id"}, files={"file": ("x.exe", b"MZ\x90\x00binary", "application/pdf")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_file_type"
    r = a.post("/documents", data={"kind": "national_id"}, files={"file": ("x.pdf", b"", "application/pdf")})
    assert r.status_code == 422
    r = a.post("/documents", data={"kind": "made_up"}, files={"file": ("x.pdf", b"%PDF-1", "application/pdf")})
    assert r.status_code == 422


def test_identity_verification_flow(make_user, reviewer):
    a = make_user()
    other = a.upload_doc("ownership_contract")
    r = a.post("/verifications/identity", json={"document_ids": [other]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "identity_document_required"
    did = a.upload_doc("national_id")
    assert a.post("/verifications/identity", json={"document_ids": [did]}).status_code == 201
    assert a.post("/verifications/identity", json={"document_ids": [did]}).status_code == 409
    assert a.get("/auth/me").json()["verification"]["identity"] == "submitted"
    vr = reviewer.get("/admin/verifications", params={"kind": "identity"}).json()[0]
    r = reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "request_info"})
    assert r.status_code == 422
    reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "request_info", "note": "Back side missing"})
    assert a.get("/auth/me").json()["verification"]["identity"] == "more_info_required"
    assert a.post("/verifications/identity", json={"document_ids": [did]}).status_code == 201  # resubmission
    reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "approve"})
    me = a.get("/auth/me").json()
    assert me["identity_verified_at"] and me["verification"]["identity"] == "approved"
    # Reviewers cannot approve their own submission
    rd = reviewer.upload_doc("national_id")
    reviewer.post("/verifications/identity", json={"document_ids": [rd]})
    own = next(v for v in reviewer.get("/admin/verifications").json() if v["user_id"] == str(reviewer.id))
    r = reviewer.post(f"/admin/verifications/{own['id']}/decision", json={"decision": "approve"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "self_review"


def test_audit_log_redacts_sensitive_values(make_user, admin, db):
    u = make_user()
    admin.patch(f"/admin/users/{u.id}", json={"is_active": False, "suspended_reason": "Broker; contact 01012345678 / x@y.com"})
    log = db.query(AuditLog).filter_by(action="user.updated").one()
    assert "01012345678" not in str(log.data) and "x@y.com" not in str(log.data)
    assert admin.get("/admin/audit", params={"action": "user."}).json()["total"] >= 1


def test_admin_cannot_demote_self_and_analytics(admin):
    assert admin.patch(f"/admin/users/{admin.id}", json={"role": "member"}).status_code == 409
    a = admin.get("/admin/analytics").json()
    assert a["users_total"] >= 1 and "listings_by_status" in a


def test_support_case(make_user, admin):
    u = make_user()
    r = u.post("/support/cases", json={"category": "broker_report", "subject_type": "user", "description": "This account is an agency."})
    assert r.status_code == 201
    case = admin.get("/admin/support").json()[0]
    admin.patch(f"/admin/support/{case['id']}", json={"status": "resolved", "assign_to_me": True, "resolution_note": "Suspended"})
    assert u.get("/support/cases").json()[0]["status"] == "resolved"
    assert any(n["type"] == "support_case_updated" for n in u.get("/notifications").json()["items"])

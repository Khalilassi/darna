import time
from datetime import UTC, date, datetime, timedelta

from app.core import notify, totp
from app.core.storage import private_storage
from app.models.entities import Document, IdempotencyRecord, Listing, RefreshToken
from app.worker import run_once
from tests.conftest import PASSWORD, publish_listing

TOKEN = "ExponentPushToken[abc123XYZ]"


class FakeSender:
    def __init__(self, dead=()):
        self.sent, self.dead = [], list(dead)

    def send(self, messages):
        self.sent.extend(messages)
        return self.dead


def test_push_after_commit_respects_prefs_and_privacy(make_user, project, reviewer):
    fake = FakeSender()
    notify.set_sender(fake)
    try:
        owner, buyer = make_user(verified=True), make_user()
        assert owner.post("/notifications/devices", json={"token": TOKEN, "platform": "ios"}).status_code == 200
        lid = publish_listing(owner, reviewer, project)
        fake.sent.clear()
        buyer.post("/conversations", json={"listing_id": lid, "message": "Price is 2,400,000? call 01012345678"})
        assert len(fake.sent) == 1
        m = fake.sent[0]
        assert m.token == TOKEN and m.title == "New message"
        assert "0101" not in m.body and "2,400,000" not in m.body and set(m.data) == {"type", "conversation_id"}
        # Opt out of message pushes; in-app notification is still stored
        r = owner.put("/notifications/preferences", json={"push": {"messages": False}}).json()
        assert r["push"]["messages"] is False and r["push"]["offers"] is True
        fake.sent.clear()
        buyer.post("/conversations", json={"listing_id": lid, "message": "Hello again"})
        assert fake.sent == []
        assert owner.get("/notifications").json()["unread"] >= 2
        assert owner.put("/notifications/preferences", json={"push": {"spam": True}}).status_code == 422
    finally:
        notify.set_sender(None)


def test_rolled_back_action_sends_no_push(make_user, project, reviewer):
    fake = FakeSender()
    notify.set_sender(fake)
    try:
        owner, buyer = make_user(verified=True), make_user()
        owner.post("/notifications/devices", json={"token": TOKEN, "platform": "android"})
        lid = publish_listing(owner, reviewer, project)
        buyer.post("/deals/offers", json={"listing_id": lid, "kind": "sale", "amount": "1"})
        fake.sent.clear()
        # Second pending offer fails after notify-free validation; ensure nothing leaks from failed requests
        r = buyer.post("/deals/offers", json={"listing_id": lid, "kind": "sale", "amount": "2"})
        assert r.status_code == 409 and fake.sent == []
    finally:
        notify.set_sender(None)


def test_device_registration_rules_and_dead_tokens(make_user, project, reviewer, db):
    from app.models.entities import DeviceToken
    a, b = make_user(), make_user()
    assert a.post("/notifications/devices", json={"token": "not-a-token", "platform": "ios"}).status_code == 422
    a.post("/notifications/devices", json={"token": TOKEN, "platform": "ios"})
    b.post("/notifications/devices", json={"token": TOKEN, "platform": "ios"})  # reinstall / other account
    assert db.query(DeviceToken).one().user_id == b.id
    fake = FakeSender(dead=[TOKEN])
    notify.set_sender(fake)
    try:
        notify.deliver([(b.id, "offer_received", {"deal_id": "x"})])
    finally:
        notify.set_sender(None)
    db.expire_all()
    assert db.query(DeviceToken).count() == 0


def test_expo_sender_batches_and_detects_unregistered():
    import httpx

    calls = []

    def handler(req):
        body = __import__("json").loads(req.content)
        calls.append(len(body))
        data = [{"status": "error", "details": {"error": "DeviceNotRegistered"}} if m["to"].endswith("[dead]") else {"status": "ok"} for m in body]
        return httpx.Response(200, json={"data": data})

    s = notify.ExpoPushSender(client=httpx.Client(transport=httpx.MockTransport(handler)))
    msgs = [notify.PushMessage(token=f"ExponentPushToken[{i}]", title="t", body="b", data={}) for i in range(150)]
    msgs.append(notify.PushMessage(token="ExponentPushToken[dead]", title="t", body="b", data={}))
    assert s.send(msgs) == ["ExponentPushToken[dead]"]
    assert calls == [100, 51]


def test_totp_rfc6238_vectors():
    # RFC 6238 Appendix B (SHA-1), secret "12345678901234567890", truncated to 6 digits
    import base64
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert totp.code_at(secret, 59 // 30) == "287082"
    assert totp.code_at(secret, 1111111109 // 30) == "081804"
    c = totp.verify(secret, "081804", None, now=1111111109)
    assert c == 1111111109 // 30
    assert totp.verify(secret, "081804", c, now=1111111109) is None  # replay rejected
    assert totp.verify(secret, "12345", None) is None


def test_staff_mfa_enrollment_login_and_enforcement(make_user, client, monkeypatch, db):
    from app.core.config import get_settings
    from app.models.enums import Role
    staff = make_user(Role.reviewer, "Mfa Reviewer")
    monkeypatch.setattr(get_settings(), "require_staff_mfa", True)
    r = staff.get("/admin/verifications")
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_enrollment_required"
    r = staff.post("/auth/mfa/setup", json={"password": "wrong-password-1"})
    assert r.status_code == 401  # a stolen access token alone cannot enrol an authenticator
    from app.core import mfa_enrollment
    from app.models.entities import User
    enrol_code, _ = mfa_enrollment.issue(db.get(User, staff.id))
    db.commit()
    setup = staff.post("/auth/mfa/setup", json={"password": PASSWORD, "enrollment_code": enrol_code}).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    assert staff.post("/auth/mfa/confirm", json={"code": "000000"}).status_code in (422,)
    now = time.time()
    code = totp.code_at(setup["secret"], int(now // 30))
    old_token = staff.token
    confirmed = staff.post("/auth/mfa/confirm", json={"code": code})
    assert confirmed.status_code == 200
    # The password-only session that existed before enrolment does not gain staff access...
    r = staff.get("/admin/verifications")
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_session_required"
    # ...but the fresh MFA session returned by confirm does, and keeps it across refresh.
    staff.token = confirmed.json()["access_token"]
    assert staff.get("/admin/verifications").status_code == 200
    refreshed = client.post("/auth/refresh", json={"refresh_token": confirmed.json()["refresh_token"]}).json()
    staff.token = refreshed["access_token"]
    assert staff.get("/admin/verifications").status_code == 200
    assert old_token != staff.token
    r = client.post("/auth/login", json={"email": staff.email, "password": PASSWORD})
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_required"
    r = client.post("/auth/login", json={"email": staff.email, "password": PASSWORD, "totp_code": code})
    assert r.json()["error"]["code"] == "mfa_invalid"  # same code cannot be replayed
    nxt = totp.code_at(setup["secret"], int(now // 30) + 1)
    assert client.post("/auth/login", json={"email": staff.email, "password": PASSWORD, "totp_code": nxt}).status_code == 200
    r = staff.post("/auth/mfa/disable", json={"code": "123456", "password": PASSWORD})
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required_for_staff"


def test_worker_jobs(make_user, project, reviewer, db):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    d = buyer.post("/deals/offers", json={"listing_id": lid, "kind": "sale", "amount": "1000"}).json()
    from app.models.entities import Offer
    o = db.get(Offer, d["latest_offer"]["id"])
    o.expires_at = datetime.now(UTC) - timedelta(hours=1)
    listing = db.get(Listing, lid)
    listing.featured_until = datetime.now(UTC) - timedelta(days=1)
    old_doc = db.get(Document, owner.upload_doc("payment_receipt"))
    old_doc.retain_until = date.today() - timedelta(days=1)
    applicant = make_user()
    pending_doc = db.get(Document, applicant.upload_doc("national_id"))
    assert applicant.post("/verifications/identity", json={"document_ids": [str(pending_doc.id)]}).status_code == 201
    pending_doc.retain_until = date.today() - timedelta(days=1)
    db.add(RefreshToken(user_id=owner.id, token_hash="x" * 64, expires_at=datetime.now(UTC) - timedelta(days=30)))
    db.add(IdempotencyRecord(user_id=owner.id, key="old", scope="s", request_hash="h", status_code=200, response={},
                             created_at=datetime.now(UTC) - timedelta(days=5)))
    db.commit()
    key = old_doc.storage_key
    rep = run_once()
    assert rep.offers_expired == 1 and rep.featured_cleared == 1 and rep.documents_purged == 1
    assert rep.refresh_tokens_deleted == 1 and rep.idempotency_records_deleted == 1
    db.expire_all()
    assert db.get(Document, old_doc.id).deleted_at is not None
    assert not (private_storage().root / key).exists()
    assert db.get(Document, pending_doc.id).deleted_at is None  # still under review: kept
    assert run_once().offers_expired == 0  # idempotent

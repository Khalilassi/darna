"""Regression tests for the internal security review (2026-11-11)."""
import time

from app.core import totp
from app.models.enums import Role
from tests.conftest import PASSWORD


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

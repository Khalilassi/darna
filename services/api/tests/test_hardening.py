import logging
import socket
import struct
import threading
from datetime import UTC, datetime, timedelta

import fakeredis
import pytest
from cryptography.fernet import Fernet

from app.core import crypto, rate_limit, sms, storage
from app.core.config import Settings, get_settings
from app.core.scanning import ClamdScanner
from app.models.entities import Document, PhoneVerification, User
from app.modules.phone import normalize_phone
from app.rotate_keys import rotate_all
from tests.conftest import jpeg_bytes

# The EICAR test string: harmless, detected by every antivirus as a test signature.
EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


# --------------------------------------------------------------------------- key rotation
def test_key_rotation_reencrypts_documents_and_totp(make_user, db, monkeypatch):
    s = get_settings()
    old = s.document_encryption_key
    u = make_user()
    did = u.upload_doc("national_id", b"%PDF-1.4 rotate-me")
    from app.core import totp
    user = db.get(User, u.id)
    user.totp_secret_encrypted = totp.encrypt_secret("JBSWY3DPEHPK3PXP")
    db.commit()

    new = Fernet.generate_key().decode()
    monkeypatch.setattr(s, "document_encryption_key", f"{new},{old}")
    storage.reset_storage()
    try:
        doc = db.get(Document, did)
        assert storage.private_storage().get(doc.storage_key) == b"%PDF-1.4 rotate-me"  # old data readable
        rep = rotate_all(db)
        assert rep.documents_rotated == 1 and rep.documents_failed == 0 and rep.totp_secrets_rotated == 1
        # After rotation the OLD key can be removed and everything still decrypts.
        monkeypatch.setattr(s, "document_encryption_key", new)
        storage.reset_storage()
        assert storage.private_storage().get(doc.storage_key) == b"%PDF-1.4 rotate-me"
        db.expire_all()
        assert totp.decrypt_secret(db.get(User, u.id).totp_secret_encrypted) == "JBSWY3DPEHPK3PXP"
        assert Fernet(old.encode())  # old key still a valid key, just no longer needed
    finally:
        monkeypatch.setattr(s, "document_encryption_key", old)
        storage.reset_storage()


def test_encryption_key_validation():
    with pytest.raises(RuntimeError, match="invalid"):
        Settings(document_encryption_key="not-a-key").validate_for_env()
    k = Fernet.generate_key().decode()
    with pytest.raises(RuntimeError, match="duplicate"):
        Settings(document_encryption_key=f"{k},{k}").validate_for_env()
    assert crypto.parse_keys(f" {k} , {Fernet.generate_key().decode()} ")[0] == k


# --------------------------------------------------------------------------- malware scanning
class FakeClamd:
    """Implements clamd's INSTREAM protocol: flags EICAR, OK otherwise."""

    def __init__(self):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.port = self.sock.getsockname()[1]
        self.received: list[int] = []
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                cmd = b""
                while not cmd.endswith(b"\0"):
                    cmd += conn.recv(1)
                assert cmd == b"zINSTREAM\0"
                data = b""
                while True:
                    size = struct.unpack(">I", self._read(conn, 4))[0]
                    if size == 0:
                        break
                    data += self._read(conn, size)
                self.received.append(len(data))
                conn.sendall(b"stream: Eicar-Test-Signature FOUND\0" if EICAR in data else b"stream: OK\0")

    @staticmethod
    def _read(conn, n):
        buf = b""
        while len(buf) < n:
            buf += conn.recv(n - len(buf))
        return buf

    def close(self):
        self.sock.close()


@pytest.fixture
def clamd(monkeypatch):
    server = FakeClamd()
    s = get_settings()
    monkeypatch.setattr(s, "malware_scanner", "clamd")
    monkeypatch.setattr(s, "clamd_host", "127.0.0.1")
    monkeypatch.setattr(s, "clamd_port", server.port)
    yield server
    server.close()


def test_clamd_client_streams_in_chunks(clamd):
    big = b"%PDF" + b"a" * 200_000
    assert ClamdScanner("127.0.0.1", clamd.port).scan(big) is None
    assert clamd.received[-1] == len(big)
    assert ClamdScanner("127.0.0.1", clamd.port).scan(b"%PDF " + EICAR) == "Eicar-Test-Signature"


def test_infected_uploads_are_rejected_before_storage(clamd, make_user, db, project, reviewer):
    u = make_user(verified=True)
    r = u.post("/documents", data={"kind": "national_id"}, files={"file": ("x.pdf", b"%PDF-1.4 " + EICAR, "application/pdf")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "file_rejected_malware"
    assert db.query(Document).count() == 0
    assert u.upload_doc("national_id")  # clean files pass
    from tests.conftest import approve_pending_claim, register_property
    reg = register_property(u, project)
    approve_pending_claim(reviewer, reg.json()["claim"]["id"])
    from tests.conftest import SALE_TERMS
    lid = u.post("/listings", json={"property_id": reg.json()["property"]["id"], "purpose": "sale", "title": "Scan test flat",
                                    "sale_terms": SALE_TERMS}).json()["id"]
    infected_jpeg = jpeg_bytes() + EICAR
    r = u.post(f"/listings/{lid}/photos", files={"file": ("p.jpg", infected_jpeg, "image/jpeg")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "file_rejected_malware"


def test_scanner_outage_fails_closed_by_default(make_user, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "malware_scanner", "clamd")
    monkeypatch.setattr(s, "clamd_host", "127.0.0.1")
    monkeypatch.setattr(s, "clamd_port", 1)  # nothing listens here
    u = make_user()
    r = u.post("/documents", data={"kind": "national_id"}, files={"file": ("x.pdf", b"%PDF-1.4 ok", "application/pdf")})
    assert r.status_code == 503 and r.json()["error"]["code"] == "scanner_unavailable"
    monkeypatch.setattr(s, "scan_fail_open", True)
    assert u.post("/documents", data={"kind": "national_id"}, files={"file": ("x.pdf", b"%PDF-1.4 ok", "application/pdf")}).status_code == 201


def test_production_requires_a_scanner():
    k = Fernet.generate_key().decode()
    with pytest.raises(RuntimeError, match="MALWARE_SCANNER"):
        Settings(env="production", jwt_secret="x" * 40, document_encryption_key=k).validate_for_env()
    Settings(env="production", jwt_secret="x" * 40, document_encryption_key=k, malware_scanner="clamd").validate_for_env()


# --------------------------------------------------------------------------- redis rate limiter
def test_redis_limiter_is_shared_and_atomic():
    server = fakeredis.FakeServer()
    a = rate_limit.RedisLimiter(fakeredis.FakeRedis(server=server))
    b = rate_limit.RedisLimiter(fakeredis.FakeRedis(server=server))  # a second API instance
    results = [lim.hit("login:1.2.3.4", 5, 60) for lim in (a, b, a, b, a, b, a)]
    assert results == [True] * 5 + [False] * 2
    assert a.hit("login:5.6.7.8", 5, 60) is True  # other keys unaffected
    ttl = fakeredis.FakeRedis(server=server).pttl("darna:rl:login:1.2.3.4")
    assert 0 < ttl <= 60_000


def test_redis_outage_fails_open(caplog):
    class Broken:
        def register_script(self, _):
            def run(**_kw):
                raise ConnectionError("down")
            return run

    with caplog.at_level(logging.WARNING, logger="darna.ratelimit"):
        assert rate_limit.RedisLimiter(Broken()).hit("k", 1, 60) is True
    assert "unavailable" in caplog.text


def test_api_uses_redis_backend_when_configured(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "rate_limit_enabled", True)
    monkeypatch.setattr(s, "rate_limit_backend", "redis")
    rate_limit.set_redis_limiter(rate_limit.RedisLimiter(fakeredis.FakeRedis()))
    try:
        codes = [client.post("/auth/login", json={"email": f"r{i}@example.com", "password": "nope-nope-1"}).status_code for i in range(21)]
        assert codes[-1] == 429 and codes[:20] == [401] * 20
    finally:
        rate_limit.set_redis_limiter(None)


# --------------------------------------------------------------------------- phone verification
class CaptureSms:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def send(self, phone, text):
        self.sent.append((phone, text))

    def code(self):
        import re
        return re.search(r"\b(\d{6})\b", self.sent[-1][1]).group(1)


@pytest.fixture
def sms_box():
    box = CaptureSms()
    sms.set_sender(box)
    yield box
    sms.set_sender(None)


@pytest.mark.parametrize("raw,expected", [("010 1234 5678", "+201012345678"), ("+20 112 345 6789", "+201123456789"),
                                          ("00201512345678", "+201512345678"), ("201212345678", "+201212345678")])
def test_normalize_egyptian_mobile(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("bad", ["0201234567", "+441234567890", "01312345678", "phone"])
def test_reject_non_egyptian_mobile(bad):
    with pytest.raises(ValueError):
        normalize_phone(bad)


def test_phone_verification_flow(make_user, sms_box, db):
    u = make_user()
    r = u.post("/auth/phone/start", json={"phone": "010 1234 5678"})
    assert r.status_code == 200 and r.json()["phone"] == "+201012345678"
    assert sms_box.sent[-1][0] == "+201012345678"
    stored = db.query(PhoneVerification).one()
    assert sms_box.code() not in stored.code_hash  # only a keyed hash is stored
    r = u.post("/auth/phone/start", json={"phone": "01012345678"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "sms_cooldown"
    wrong = "000000" if sms_box.code() != "000000" else "111111"
    r = u.post("/auth/phone/verify", json={"code": wrong})
    assert r.status_code == 422 and r.json()["error"]["details"]["attempts_left"] == 4
    assert u.post("/auth/phone/verify", json={"code": sms_box.code()}).status_code == 200
    me = u.get("/auth/me").json()
    assert me["phone"] == "+201012345678" and me["phone_verified_at"]
    # editing the number un-verifies it
    u.patch("/auth/me", json={"phone": "+201098765432"})
    assert u.get("/auth/me").json()["phone_verified_at"] is None


def test_phone_attempts_expiry_and_uniqueness(make_user, sms_box, db):
    a, b = make_user(), make_user()
    a.post("/auth/phone/start", json={"phone": "01011112222"})
    for _ in range(5):
        a.post("/auth/phone/verify", json={"code": "999999" if sms_box.code() != "999999" else "888888"})
    r = a.post("/auth/phone/verify", json={"code": sms_box.code()})
    assert r.json()["error"]["code"] == "code_attempts_exceeded"
    # new code after cooldown; expiry enforced
    pv = db.query(PhoneVerification).one()
    pv.created_at = datetime.now(UTC) - timedelta(minutes=2)
    db.commit()
    a.post("/auth/phone/start", json={"phone": "01011112222"})
    latest = db.query(PhoneVerification).order_by(PhoneVerification.created_at.desc()).first()
    latest.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert a.post("/auth/phone/verify", json={"code": sms_box.code()}).json()["error"]["code"] == "code_expired"
    # b verifies the number; a can no longer claim it
    b.post("/auth/phone/start", json={"phone": "01011112222"})
    assert b.post("/auth/phone/verify", json={"code": sms_box.code()}).status_code == 200
    for pv in db.query(PhoneVerification).filter_by(user_id=a.id):
        pv.created_at = datetime.now(UTC) - timedelta(minutes=5)
    db.commit()
    r = a.post("/auth/phone/start", json={"phone": "01011112222"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "phone_in_use"


def test_phone_hourly_limit(make_user, sms_box, db):
    u = make_user()
    for _ in range(5):
        assert u.post("/auth/phone/start", json={"phone": "01055556666"}).status_code == 200
        for pv in db.query(PhoneVerification).filter_by(user_id=u.id):
            pv.created_at = pv.created_at - timedelta(minutes=2)
        db.commit()
    r = u.post("/auth/phone/start", json={"phone": "01055556666"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "sms_hourly_limit"


def test_sms_refused_outside_development_without_provider(make_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "env", "staging")
    u = make_user()
    r = u.post("/auth/phone/start", json={"phone": "01012345678"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "sms_unavailable"

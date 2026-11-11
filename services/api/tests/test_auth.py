from tests.conftest import PASSWORD


def test_register_login_refresh_rotation(client):
    r = client.post("/auth/register", json={"email": "A@Example.com", "password": PASSWORD, "full_name": "Amal", "attest_not_broker": True})
    assert r.status_code == 201
    tokens = r.json()
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}).json()
    assert me["email"] == "a@example.com"
    assert me["verification"]["identity"] == "none"
    assert "password_hash" not in me

    r2 = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r2.status_code == 200
    # Reusing the rotated token is detected and revokes the family.
    r3 = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r3.status_code == 401 and r3.json()["error"]["code"] == "token_reuse"
    r4 = client.post("/auth/refresh", json={"refresh_token": r2.json()["refresh_token"]})
    assert r4.status_code == 401


def test_broker_attestation_required(client):
    r = client.post("/auth/register", json={"email": "b@example.com", "password": PASSWORD, "full_name": "Broker", "attest_not_broker": False})
    assert r.status_code == 422 and r.json()["error"]["code"] == "broker_not_allowed"


def test_weak_password_and_duplicate_email(client):
    r = client.post("/auth/register", json={"email": "c@example.com", "password": "aaaaaaaaaaaa", "full_name": "C", "attest_not_broker": True})
    assert r.status_code == 422
    body = {"email": "d@example.com", "password": PASSWORD, "full_name": "Dina", "attest_not_broker": True}
    assert client.post("/auth/register", json=body).status_code == 201
    r = client.post("/auth/register", json={**body, "email": "D@example.com"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


def test_login_failures_are_uniform(client):
    client.post("/auth/register", json={"email": "e@example.com", "password": PASSWORD, "full_name": "Eman", "attest_not_broker": True})
    a = client.post("/auth/login", json={"email": "e@example.com", "password": "wrong-pass-123"})
    b = client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass-123"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_protected_endpoints_require_auth(client):
    for path in ("/auth/me", "/properties/mine", "/deals", "/documents", "/notifications"):
        assert client.get(path).status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_member_cannot_reach_admin(make_user):
    u = make_user()
    for path in ("/admin/users", "/admin/verifications", "/admin/audit", "/admin/analytics", "/admin/disputes"):
        assert u.get(path).status_code == 403, path


def test_reviewer_permissions_are_scoped(reviewer):
    assert reviewer.get("/admin/verifications").status_code == 200
    assert reviewer.get("/admin/users").status_code == 403
    assert reviewer.get("/admin/audit").status_code == 403


def test_suspended_user_token_rejected(make_user, admin):
    u = make_user()
    r = admin.patch(f"/admin/users/{u.id}", json={"is_active": False, "suspended_reason": "Operating as broker"})
    assert r.status_code == 200
    assert u.get("/auth/me").status_code == 401


def test_rate_limit(client, monkeypatch):
    from app.core import rate_limit
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    rate_limit.reset()
    codes = [client.post("/auth/login", json={"email": "x@example.com", "password": "nope-nope-1"}).status_code for _ in range(22)]
    assert codes[:20] == [401] * 20 and codes[-1] == 429
    rate_limit.reset()

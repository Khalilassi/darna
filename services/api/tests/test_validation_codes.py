"""422 details carry a stable `type` per rule and safe `ctx` limits so clients can localize."""


def _details(r):
    assert r.status_code == 422, r.text
    return r.json()["error"]["details"]


def test_business_rule_has_its_own_code(client):
    body = {"email": "weak@example.com", "password": "onlyletterspassword", "full_name": "Weak Pw", "attest_not_broker": True}
    d = _details(client.post("/auth/register", json=body))
    assert [e["type"] for e in d] == ["password_too_simple"]
    assert d[0]["msg"] == "password must mix letters and numbers or symbols"
    assert "ctx" not in d[0]


def test_field_limits_are_exposed_as_ctx(client):
    body = {"email": "x@example.com", "password": "abc123", "full_name": "A", "attest_not_broker": True}
    d = {e["loc"][-1]: e for e in _details(client.post("/auth/register", json=body))}
    assert d["full_name"]["type"] == "string_too_short" and d["full_name"]["ctx"] == {"min_length": 2}
    assert d["password"]["ctx"]["min_length"] >= 8


def test_finance_rules_are_coded():
    import pytest
    from pydantic import ValidationError

    from app.finance.engine import Amount
    with pytest.raises(ValidationError) as ei:
        Amount(amount="100", provenance="estimate")
    assert [e["type"] for e in ei.value.errors()] == ["estimate_assumption_required"]
    assert isinstance(ei.value, ValueError)

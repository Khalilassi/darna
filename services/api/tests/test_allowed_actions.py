"""allowed_actions must match exactly what the endpoints accept, so clients can render
buttons from it without re-implementing the rules."""
from datetime import UTC, datetime, timedelta

from app.models.entities import Viewing
from tests.conftest import publish_listing
from tests.test_deals import offer


def test_viewing_allowed_actions(make_user, project, reviewer, db):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    v = buyer.post("/viewings", json={"listing_id": lid, "proposed_at": (datetime.now(UTC) + timedelta(days=2)).isoformat()}).json()
    assert v["allowed_actions"] == ["cancel"]
    mine = {x["my_role"]: x for x in owner.get("/viewings").json()}
    assert mine["owner"]["allowed_actions"] == ["confirm", "decline", "cancel"]
    v = owner.post(f"/viewings/{v['id']}/actions", json={"action": "confirm"}).json()
    # in the future: completion/no-show not yet offered
    assert v["allowed_actions"] == ["cancel"]
    assert buyer.get("/viewings").json()[0]["allowed_actions"] == ["cancel"]

    row = db.get(Viewing, v["id"])
    row.proposed_at = datetime.now(UTC) - timedelta(hours=1)
    db.commit()
    assert owner.get("/viewings").json()[0]["allowed_actions"] == ["cancel", "complete", "no_show"]
    assert buyer.get("/viewings").json()[0]["allowed_actions"] == ["cancel", "complete"]
    assert buyer.post(f"/viewings/{v['id']}/actions", json={"action": "no_show"}).status_code == 403
    done = buyer.post(f"/viewings/{v['id']}/actions", json={"action": "complete"}).json()
    assert done["status"] == "completed" and done["allowed_actions"] == []


def test_checklist_allowed_actions_match_endpoint(make_user, project, reviewer):
    owner, buyer = make_user(verified=True), make_user()
    lid = publish_listing(owner, reviewer, project)
    deal = offer(buyer, lid, "2500000").json()
    did = deal["id"]
    # negotiating: nothing allowed for anyone
    assert all(c["allowed_actions"] == [] for c in owner.get(f"/deals/{did}").json()["checklist"])
    d = owner.post(f"/deals/{did}/offers/{deal['latest_offer']['id']}/respond", json={"action": "accept"}).json()

    def views():
        return ({c["code"]: c for c in owner.get(f"/deals/{did}").json()["checklist"]},
                {c["code"]: c for c in buyer.get(f"/deals/{did}").json()["checklist"]})

    o, b = views()
    item = next(c for c in o.values() if c["responsible"] == "owner")
    code = item["code"]
    assert o[code]["allowed_actions"] == ["submit"] and b[code]["allowed_actions"] == ["waive"]
    owner.post(f"/deals/{did}/checklist/{item['id']}", json={"action": "submit"})
    o, b = views()
    assert o[code]["allowed_actions"] == [] and b[code]["allowed_actions"] == ["accept", "waive", "reopen"]

    # Exhaustive cross-check: every advertised action succeeds, every other is rejected.
    for client, mine in ((owner, o), (buyer, b)):
        for c in mine.values():
            for action in ("submit", "accept", "waive", "reopen"):
                if action in c["allowed_actions"]:
                    continue
                r = client.post(f"/deals/{did}/checklist/{c['id']}", json={"action": action})
                assert r.status_code in (403, 409), (c["code"], action, r.status_code)
    assert buyer.post(f"/deals/{did}/checklist/{item['id']}", json={"action": "reopen"}).status_code == 200
    assert views()[0][code]["allowed_actions"] == ["submit"]
    assert d["status"] == "offer_accepted"

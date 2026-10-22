"""Unit / protocol tests:  python -m pytest -q"""
from fastapi.testclient import TestClient

from agents.concierge.nlu import rules_nlu
from agents.orchestrator.graph import build_unified, citizen_status, coordination_plan


def rpc(c, method, params, id_=1):
    return c.post("/", json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params}).json()


def msg(data):
    return {"kind": "message", "messageId": "m1", "role": "user",
            "parts": [{"kind": "data", "data": data}]}


def test_agent_card_is_a2a_compliant():
    from agents.domain.electricity import app
    card = TestClient(app).get("/.well-known/agent-card.json").json()
    for key in ("protocolVersion", "name", "url", "skills", "capabilities",
                "defaultInputModes", "defaultOutputModes"):
        assert key in card
    assert any(s["id"] == "electric_hazard" for s in card["skills"])


def test_message_send_creates_ticket_and_task_completes():
    from agents.domain.water import app
    with TestClient(app) as c:
        r = rpc(c, "message/send", {"message": msg({"issue_type": "water_contamination",
                                                    "location": "Okhla"}),
                                    "configuration": {"blocking": True}})
        task = r["result"]
        assert task["kind"] == "task" and task["status"]["state"] == "completed"
        states = [h["state"] for h in task["metadata"]["stateHistory"]]
        assert states == ["submitted", "working", "completed"]
        ticket = task["artifacts"][0]["parts"][0]["data"]
        assert ticket["priority"] == "CRITICAL" and ticket["ticket_id"].startswith("DJB-")
        got = rpc(c, "tasks/get", {"id": task["id"]})["result"]
        assert got["id"] == task["id"]


def test_unsupported_skill_is_rejected():
    from agents.domain.roads import app
    with TestClient(app) as c:
        r = rpc(c, "message/send", {"message": msg({"issue_type": "power_outage"}),
                                    "configuration": {"blocking": True}})
        assert r["result"]["status"]["state"] == "rejected"


def test_jsonrpc_errors():
    from agents.domain.roads import app
    c = TestClient(app)
    assert rpc(c, "nope", {})["error"]["code"] == -32601
    assert rpc(c, "tasks/get", {"id": "missing"})["error"]["code"] == -32001
    assert c.post("/", content=b"{bad json").json()["error"]["code"] == -32700


def test_nlu_composite_complaint():
    s = rules_nlu("Road repair work near Laxmi Nagar metro broke the water pipe")
    assert {i["department"] for i in s["issues"]} == {"roads", "water"}
    assert s["location"] == "Laxmi Nagar"


def test_nlu_hinglish_and_urgency():
    s = rules_nlu("Karol Bagh me taar se spark aa raha hai")
    assert s["issues"][0]["issue_type"] == "electric_hazard"
    assert s["urgency"] == "critical"


def test_unified_status_and_coordination():
    res = [{"department": "water", "agent_name": "W", "issue_type": "water_pipe_burst",
            "state": "completed", "task": {"id": "t1"},
            "result": {"ticket_id": "DJB-1", "priority": "HIGH", "ticket_status": "ASSIGNED",
                       "eta": "2026-01-02T00:00:00"}},
           {"department": "roads", "agent_name": "R", "issue_type": "excavation_damage",
            "state": "completed", "task": {"id": "t2"},
            "result": {"ticket_id": "MCD-1", "priority": "MEDIUM", "ticket_status": "RESOLVED",
                       "eta": "2026-01-03T00:00:00"}}]
    u = build_unified({"complaint_id": "CMP-1"}, res, [])
    assert u["composite"] and u["all_subtasks_completed"]
    assert u["highest_priority"] == "HIGH" and u["overall_eta"].startswith("2026-01-03")
    assert u["overall_status"] == "IN_PROGRESS"
    assert "Roads department restores" in " ".join(coordination_plan(u["departments"]))
    assert citizen_status(["RESOLVED", "CLOSED"]) == "RESOLVED"

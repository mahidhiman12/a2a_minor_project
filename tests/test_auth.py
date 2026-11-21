"""Login, roles and service-token tests:  python -m pytest -q tests/test_auth.py

The Concierge normally learns the departments from the Orchestrator's /agents (Agent
Cards). Here that call is replaced by a fixed list, and calls to department agents are
routed in-process to the real Water agent app, so no servers need to be running.
"""
import httpx
import pytest
from fastapi.testclient import TestClient

from common import config

PW = {"citizen1": "citizen-test-pw", "officer": "officer-test-pw", "admin": "admin-test-pw"}
AGENTS = [{"key": k, "name": f"{k.title()} Agent", "_base": f"http://{k}.test",
           "provider": {"organization": f"{k.title()} Dept (simulated)"}, "skills": []}
          for k in ("water", "electricity", "roads", "sanitation")]


def rpc(c, method, params):
    return c.post("/", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).json()


def msg(data):
    return {"kind": "message", "messageId": "m1", "role": "user",
            "parts": [{"kind": "data", "data": data}]}


@pytest.fixture
def srv(monkeypatch):
    from agents.concierge import server
    from agents.domain.water import app as water_app

    async def fake_agents():
        return AGENTS
    monkeypatch.setattr(server, "fetch_agents", fake_agents)
    monkeypatch.setattr(server, "_dept_cache", (0.0, []))
    real_client = httpx.AsyncClient  # department REST calls -> the real Water agent, in-process
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **kw: real_client(
        transport=httpx.ASGITransport(app=water_app), **kw))
    return server


def login(srv, username, password=None):
    c = TestClient(srv.app, follow_redirects=False)
    password = password or PW.get(username) or PW["officer"]
    r = c.post("/api/login", json={"username": username, "password": password})
    return c, r


def test_login_success_sets_signed_httponly_cookie(srv):
    c, r = login(srv, "citizen1")
    assert r.status_code == 200 and r.json()["redirect"] == "/home"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "max-age=" in cookie
    assert c.get("/api/me").json()["role"] == "citizen"


def test_login_failure(srv):
    c, r = login(srv, "citizen1", "wrong-password")
    assert r.status_code == 401 and "set-cookie" not in r.headers
    assert login(srv, "nobody_here", "whatever")[1].status_code == 401
    assert c.get("/api/me").status_code == 401


def test_passwords_are_hashed_not_plain(srv):
    from agents.concierge import auth
    with auth.db() as d:
        h = d.execute("SELECT password_hash FROM users WHERE username='citizen1'").fetchone()[0]
    assert h.startswith("pbkdf2_sha256$") and PW["citizen1"] not in h


def test_tampered_cookie_is_rejected(srv):
    from agents.concierge import auth
    c, _ = login(srv, "citizen1")
    token = c.cookies.get(auth.COOKIE)
    assert TestClient(srv.app, cookies={auth.COOKIE: token}).get("/api/me").status_code == 200
    forged = token[:-2] + ("AA" if not token.endswith("AA") else "BB")
    assert TestClient(srv.app, cookies={auth.COOKIE: forged}).get("/api/me").status_code == 401


def test_role_redirects(srv):
    anon = TestClient(srv.app, follow_redirects=False)
    if srv.USE_SPA:  # React app: `/` is the public landing page
        assert anon.get("/").status_code == 200
    else:            # classic pages: no landing page, `/` sends you to log in
        assert anon.get("/").headers["location"] == "/login"
    assert anon.get("/home").headers["location"] == "/login"
    assert anon.get("/dept/water").headers["location"] == "/login"
    assert anon.get("/login").status_code == 200
    assert anon.post("/api/chat", json={"message": "hi"}).status_code == 401

    for user, home in (("citizen1", "/home"), ("water_officer", "/dept/water"), ("admin", "/admin")):
        c, r = login(srv, user)
        assert r.json()["redirect"] == home
        assert c.get("/login").headers["location"] == home  # logged in -> own page
        assert c.get(home).status_code == 200
    c, _ = login(srv, "water_officer")
    assert c.get("/home").headers["location"] == "/dept/water"


def test_public_overview_needs_no_login_and_hides_citizen_text(srv):
    r = TestClient(srv.app).get("/api/public/overview")
    assert r.status_code == 200
    body = r.json()
    assert body["agents_online"] == 4 and {d["key"] for d in body["departments"]} >= {"water"}
    for item in body["recent"]:
        assert set(item) == {"issue", "location", "status", "departments", "created_at"}


def test_complaint_detail_is_owner_only(srv):
    c, _ = login(srv, "citizen1")
    assert c.get("/api/complaints/CMP-20990101-0001").status_code == 403
    assert TestClient(srv.app).get("/api/complaints/CMP-20990101-0001").status_code == 401


def test_citizen_blocked_from_department_dashboard(srv):
    c, _ = login(srv, "citizen1")
    assert c.get("/dept/water").status_code == 403
    assert c.get("/api/dept/water/tickets").status_code == 403
    assert c.get("/admin").status_code == 403
    assert c.get("/api/complaints").status_code == 403


def test_water_officer_blocked_from_roads(srv):
    c, _ = login(srv, "water_officer")
    assert c.get("/dept/water").status_code == 200
    assert c.get("/dept/roads").status_code == 403
    assert c.get("/api/dept/roads/tickets").status_code == 403
    assert c.patch("/api/dept/roads/tickets/MCD-1", json={"status": "RESOLVED"}).status_code == 403
    assert c.post("/api/chat", json={"message": "no water"}).status_code == 403


def test_new_department_from_agent_card_gets_login_and_dashboard(srv):
    # 'sanitation' exists only in the discovered Agent Cards - no code mentions it.
    c, r = login(srv, "sanitation_officer")
    assert r.status_code == 200 and r.json()["redirect"] == "/dept/sanitation"
    assert c.get("/dept/sanitation").status_code == 200
    a, _ = login(srv, "admin")
    assert {d["key"] for d in a.get("/api/departments").json()} >= {"water", "sanitation"}
    assert a.get("/dept/sanitation").status_code == 200
    assert a.get("/dept/not_a_dept").status_code == 404


def test_register_creates_citizens_only(srv):
    c = TestClient(srv.app)
    r = c.post("/api/register", json={"username": "ravi_k", "password": "secret123",
                                      "display_name": "Ravi", "role": "admin",
                                      "department": "water"})
    assert r.status_code == 200
    me = c.get("/api/me").json()
    assert me["role"] == "citizen" and me["department"] is None
    assert c.post("/api/register", json={"username": "ravi_k",
                                         "password": "secret123"}).status_code == 400
    assert c.post("/api/register", json={"username": "x", "password": "1"}).status_code == 400


def test_citizen_only_sees_own_complaints(srv):
    from agents.concierge import auth
    other = auth.create_user("other_citizen", "secret123", "citizen")
    auth.record_owner("CMP-20990101-0001", other["id"])
    c, _ = login(srv, "citizen1")
    assert c.get("/api/trail/CMP-20990101-0001").status_code == 403
    r = c.post("/api/chat", json={"message": "status CMP-20990101-0001"}).json()
    assert r["state"] == "failed" and "not filed from your account" in r["reply"]


def test_officer_updates_ticket_through_concierge(srv):
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:  # ticket arrives over A2A, as in the real flow
        task = rpc(w, "message/send", {"message": msg({"issue_type": "water_pipe_burst",
                                                       "location": "Okhla",
                                                       "related_departments": ["roads"]}),
                                       "configuration": {"blocking": True}})["result"]
    tid = task["artifacts"][0]["parts"][0]["data"]["ticket_id"]
    c, _ = login(srv, "water_officer")
    tickets = c.get("/api/dept/water/tickets").json()["tickets"]
    t = next(t for t in tickets if t["ticket_id"] == tid)
    assert t["related_departments"] == ["roads"] and t["updated_at"]
    r = c.patch(f"/api/dept/water/tickets/{tid}", json={"status": "RESOLVED"})
    assert r.status_code == 200 and r.json()["ticket_status"] == "RESOLVED"
    assert c.patch(f"/api/dept/water/tickets/{tid}", json={"status": "BOGUS"}).status_code == 400


def test_service_token_required_on_agent_ticket_endpoints():
    from agents.domain.water import app
    c = TestClient(app, follow_redirects=False)
    body = {"status": "RESOLVED"}
    assert c.patch("/tickets/DJB-NOPE", json=body).status_code == 401
    assert c.patch("/tickets/DJB-NOPE", json=body,
                   headers={"X-Service-Token": "wrong"}).status_code == 401
    assert c.get("/tickets").status_code == 401
    ok = {"X-Service-Token": config.SERVICE_TOKEN}
    assert c.patch("/tickets/DJB-NOPE", json=body, headers=ok).status_code == 404  # past auth
    assert c.get("/tickets", headers=ok).status_code == 200
    r = c.get("/console")  # old console now points at the protected dashboard
    assert r.status_code == 307 and r.headers["location"].endswith("/dept/water")


def test_a2a_still_works_without_login():
    from agents.concierge.server import app as concierge
    from agents.domain.roads import app as roads
    from agents.orchestrator.server import app as orchestrator
    for app in (concierge, orchestrator, roads):
        assert TestClient(app).get("/.well-known/agent-card.json").status_code == 200
    with TestClient(roads) as c:  # no cookie, no service token
        task = rpc(c, "message/send", {"message": msg({"issue_type": "pothole",
                                                       "location": "Rohini"}),
                                       "configuration": {"blocking": True}})["result"]
        assert task["status"]["state"] == "completed"
        assert rpc(c, "tasks/get", {"id": task["id"]})["result"]["id"] == task["id"]
        # the A2A ticket artifact keeps its original fields (no dashboard-only extras)
        assert "updated_at" not in task["artifacts"][0]["parts"][0]["data"]

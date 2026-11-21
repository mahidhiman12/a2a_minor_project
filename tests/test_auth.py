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
    # classic pages keep the server-side page guards these tests check; the React app
    # guards pages in the browser (per-tab sign-in), see test_app_pages_are_guarded_in_the_browser
    monkeypatch.setattr(server, "USE_SPA", False)
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
    assert c.get("/api/dept/roads/tickets/MCD-1").status_code == 403
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
    # resolving needs a note the citizen can read
    assert c.patch(f"/api/dept/water/tickets/{tid}", json={"status": "RESOLVED"}).status_code == 400
    r = c.patch(f"/api/dept/water/tickets/{tid}", json={"status": "IN_PROGRESS"})
    assert r.status_code == 200 and r.json()["ticket_status"] == "IN_PROGRESS"
    r = c.patch(f"/api/dept/water/tickets/{tid}", json={"note": "Crew on site, valve shut"})
    assert r.status_code == 200 and r.json()["ticket_status"] == "IN_PROGRESS"
    r = c.patch(f"/api/dept/water/tickets/{tid}", json={"status": "RESOLVED", "note": "Pipe replaced"})
    assert r.status_code == 200 and r.json()["ticket_status"] == "RESOLVED"
    assert c.patch(f"/api/dept/water/tickets/{tid}", json={"status": "BOGUS"}).status_code == 400
    assert c.patch(f"/api/dept/water/tickets/{tid}", json={}).status_code == 400

    # the ticket page: full history with who did what (the complaint is unknown here)
    d = c.get(f"/api/dept/water/tickets/{tid}").json()
    assert d["department"]["key"] == "water" and d["complaint"] is None
    ev = d["ticket"]["events"]
    assert [e["kind"] for e in ev] == ["created", "status", "note", "status"]
    assert ev[-1]["status"] == "RESOLVED" and ev[-1]["note"] == "Pipe replaced"
    assert ev[-1]["actor"] and ev[0]["actor"] == "system"
    assert c.get("/api/dept/water/tickets/DJB-NOPE").status_code == 404


def test_duplicate_reports_share_the_parent_history():
    from agents.domain.water import app as water_app
    ok = {"X-Service-Token": config.SERVICE_TOKEN}
    with TestClient(water_app) as w:
        def file():
            task = rpc(w, "message/send", {"message": msg({"issue_type": "water_pipe_burst",
                                                           "location": "Dwarka"}),
                                           "configuration": {"blocking": True}})["result"]
            return task["artifacts"][0]["parts"][0]["data"]
        first, second = file(), file()
        parent = second["duplicate_of"] or first["ticket_id"]
        child = second["ticket_id"] if second["duplicate_of"] else None
        assert child, "the second report in the same place should be linked"
        d = w.get(f"/tickets/{parent}", headers=ok).json()
        assert child in [x["ticket_id"] for x in d["duplicates"]]
        assert any(e["kind"] == "linked" and child in e["note"] for e in d["events"])
        w.patch(f"/tickets/{parent}", headers=ok,
                json={"status": "RESOLVED", "note": "Main repaired", "actor": "Officer"})
        ev = w.get(f"/tickets/{child}/events", headers=ok).json()
        assert ev[-1]["status"] == "RESOLVED" and ev[-1]["note"] == "Main repaired"


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


# ---------------- status rules, citizen confirmation, SLA ----------------
OK = {"X-Service-Token": config.SERVICE_TOKEN}


def _new_ticket(w, location="Okhla"):
    task = rpc(w, "message/send", {"message": msg({"issue_type": "water_pipe_burst",
                                                   "location": location}),
                                   "configuration": {"blocking": True}})["result"]
    return task["artifacts"][0]["parts"][0]["data"]["ticket_id"]


def test_officer_status_rules_and_sla():
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        tid = _new_ticket(w, "Saket")
        t = next(t for t in w.get("/tickets", headers=OK).json() if t["ticket_id"] == tid)
        assert t["sla"]["state"] == "on_track" and t["sla"]["hours_left"] > 0
        assert "CLOSED" not in t["allowed_next"] and "RESOLVED" in t["allowed_next"]
        # officers never close; a resolved ticket can only be taken back to IN_PROGRESS
        r = w.patch(f"/tickets/{tid}", headers=OK, json={"status": "CLOSED", "note": "x"})
        assert r.status_code == 400 and "citizen confirms" in r.json()["detail"]
        r = w.patch(f"/tickets/{tid}", headers=OK, json={"status": "RESOLVED", "note": "Fixed"})
        assert r.json()["resolved_at"] and r.json()["auto_close_at"]
        assert r.json()["sla"]["state"] == "met" and r.json()["allowed_next"] == ["IN_PROGRESS"]
        assert w.patch(f"/tickets/{tid}", headers=OK, json={"status": "ASSIGNED"}).status_code == 400
        r = w.patch(f"/tickets/{tid}", headers=OK, json={"status": "IN_PROGRESS", "note": "Leaking again"})
        assert r.status_code == 200 and r.json()["resolved_at"] is None


def test_citizen_confirms_or_reopens_a_fix():
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        tid = _new_ticket(w, "Rohini")
        fb = lambda body: w.post(f"/tickets/{tid}/citizen", headers=OK, json=body)  # noqa: E731
        assert fb({"action": "confirm"}).status_code == 409  # not fixed yet
        w.patch(f"/tickets/{tid}", headers=OK, json={"status": "RESOLVED", "note": "Pipe replaced"})
        assert fb({"action": "reopen"}).status_code == 400  # needs a reason
        r = fb({"action": "reopen", "note": "Still leaking near gate 2"})
        assert r.status_code == 200 and r.json()["ticket_status"] in ("ASSIGNED", "OPEN")
        w.patch(f"/tickets/{tid}", headers=OK, json={"status": "RESOLVED", "note": "Joint resealed"})
        r = fb({"action": "confirm"})
        assert r.status_code == 200 and r.json()["ticket_status"] == "CLOSED"
        assert fb({"action": "reopen", "note": "again"}).status_code == 409  # closed is final
        kinds = [e["kind"] for e in w.get(f"/tickets/{tid}/events", headers=OK).json()]
        assert kinds == ["created", "status", "reopened", "status", "confirmed"]


def test_resolved_ticket_closes_itself(monkeypatch):
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        tid = _new_ticket(w, "Karol Bagh")
        w.patch(f"/tickets/{tid}", headers=OK, json={"status": "RESOLVED", "note": "Done"})
        monkeypatch.setattr(config, "AUTO_CLOSE_DAYS", 0)
        ev = w.get(f"/tickets/{tid}/events", headers=OK).json()
        assert ev[-1]["kind"] == "auto_closed" and ev[-1]["status"] == "CLOSED"


def test_citizen_feedback_through_concierge(srv, monkeypatch):
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        tid = _new_ticket(w, "Lajpat Nagar")
        w.patch(f"/tickets/{tid}", headers=OK, json={"status": "RESOLVED", "note": "Fixed"})
    cid = "CMP-20990202-0001"

    async def fake_orch(path):
        return {"unified": {"departments": [{"department": "water", "ticket_id": tid}]}}
    monkeypatch.setattr(srv, "_orch", fake_orch)
    c, me = login(srv, "citizen1")
    url = f"/api/complaints/{cid}/tickets/{tid}/feedback"
    assert c.post(url, json={"action": "confirm"}).status_code == 403  # not their complaint yet
    srv.auth.record_owner(cid, me.json()["user"]["id"])
    assert c.post(f"/api/complaints/{cid}/tickets/DJB-NOPE/feedback",
                  json={"action": "confirm"}).status_code == 404
    r = c.post(url, json={"action": "confirm"})
    assert r.status_code == 200 and r.json()["ticket_status"] == "CLOSED"
    o, _ = login(srv, "water_officer")
    assert o.post(url, json={"action": "confirm"}).status_code == 403  # citizens only


def test_admin_sla_summary(srv):
    c, _ = login(srv, "admin")
    rows = c.get("/api/sla").json()
    water = next(r for r in rows if r["key"] == "water")
    assert water["online"] and {"open", "overdue", "due_soon", "on_time_pct"} <= water.keys()
    o, _ = login(srv, "water_officer")
    assert o.get("/api/sla").status_code == 403


def test_a2a_tasks_survive_an_agent_restart(tmp_path):
    from common.a2a import TaskStore, make_message, text_part
    path = tmp_path / "tasks.db"
    first = TaskStore(path)
    task = first.create(make_message([text_part("hi")]))
    first.set_state(task["id"], "completed", "done")
    first.add_artifact(task["id"], {"artifactId": "a1", "parts": []})
    again = TaskStore(path)  # a fresh process: nothing in memory
    t = again.get(task["id"])
    assert t["status"]["state"] == "completed" and t["artifacts"][0]["artifactId"] == "a1"
    assert TaskStore().get(task["id"]) is None  # without a path, memory only (as before)


# ---------------- per-tab sign-in ----------------
def test_each_tab_can_be_signed_in_as_someone_else(srv):
    c = TestClient(srv.app, follow_redirects=False)  # one browser = one cookie jar
    citizen = c.post("/api/login", json={"username": "citizen1", "password": PW["citizen1"]}).json()
    officer = c.post("/api/login", json={"username": "water_officer", "password": PW["officer"]}).json()
    assert citizen["token"] and officer["token"]
    assert c.get("/api/me").json()["username"] == "water_officer"  # cookie: the latest sign-in
    tab1 = {"Authorization": f"Bearer {citizen['token']}"}
    assert c.get("/api/me", headers=tab1).json()["username"] == "citizen1"  # tab 1 keeps its user
    assert "token" not in c.get("/api/me", headers=tab1).json()
    assert c.get("/api/dept/water/tickets", headers=tab1).status_code == 403  # roles per tab
    assert c.get("/api/me", headers={"Authorization": "Bearer forged"}).status_code == 401  # no fallback
    assert c.get("/api/me").json()["token"]  # a cookie-only tab can pin itself
    # signing out tab 1 (citizen) leaves the officer's cookie alone
    r = c.post("/api/logout", headers=tab1)
    assert "set-cookie" not in r.headers and c.get("/api/me").json()["username"] == "water_officer"


def test_app_pages_are_guarded_in_the_browser(srv, monkeypatch):
    if not (srv.SPA_DIST / "index.html").is_file():
        pytest.skip("frontend/dist not built")
    monkeypatch.setattr(srv, "USE_SPA", True)
    c, _ = login(srv, "citizen1")  # the cookie says citizen, but this tab may be an officer
    for path in ("/login", "/home", "/dept/water", "/admin"):
        assert c.get(path).status_code == 200
    assert c.get("/api/dept/water/tickets").status_code == 403  # the API still enforces roles


# ---------------- officer actions ----------------
def test_officer_edits_reject_and_questions():
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        tid = _new_ticket(w, "Pitampura")
        patch = lambda body: w.patch(f"/tickets/{tid}", headers=OK, json={"actor": "Officer", **body})  # noqa: E731
        assert patch({"crew": "Crew Z9", "priority": "CRITICAL"}).json()["crew"] == "Crew Z9"
        assert patch({"eta": "2099-01-01T10:00:00+05:30"}).status_code == 400  # needs a reason
        r = patch({"eta": "2099-01-01T10:00:00+05:30", "note": "Part on order"})
        assert r.status_code == 200 and r.json()["eta"].startswith("2099-01-01T04:30")
        assert patch({"priority": "URGENT"}).status_code == 400
        # ask the citizen, who answers
        assert patch({"question": True}).status_code == 400  # a question needs text
        assert patch({"question": True, "note": "Which gate?"}).json()["awaiting_citizen"] is True
        fb = lambda body: w.post(f"/tickets/{tid}/citizen", headers=OK, json=body)  # noqa: E731
        assert fb({"action": "reply"}).status_code == 400
        assert fb({"action": "reply", "note": "Gate 2"}).json()["awaiting_citizen"] is False
        assert fb({"action": "reply", "note": "again"}).status_code == 409  # nothing asked now
        # reject: needs a reason, then the ticket is final
        assert patch({"status": "REJECTED"}).status_code == 400
        r = patch({"status": "REJECTED", "note": "Private property, not a DJB main"})
        assert r.json()["ticket_status"] == "REJECTED" and r.json()["sla"]["state"] is None
        assert patch({"crew": "Crew A1"}).status_code == 400
        assert patch({"note": "FYI"}).status_code == 200  # notes are always allowed
        kinds = [e["kind"] for e in w.get(f"/tickets/{tid}/events", headers=OK).json()]
        assert kinds == ["created", "edited", "edited", "question", "citizen_reply", "status", "note"]


def test_transfer_marks_the_ticket_and_refuses_linked_reports():
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        task = rpc(w, "message/send", {"message": msg({"issue_type": "water_pipe_burst", "location": "Narela",
                                                       "complaint_id": "CMP-20990303-0001"}),
                                       "configuration": {"blocking": True}})["result"]
        tid = task["artifacts"][0]["parts"][0]["data"]["ticket_id"]
        body = {"to_department": "roads", "to_ticket_id": "MCD-1", "note": "Road cave-in, not a pipe"}
        assert w.post(f"/tickets/{tid}/transfer", headers=OK, json={**body, "to_department": "water"}).status_code == 400
        r = w.post(f"/tickets/{tid}/transfer", headers=OK, json=body)
        assert r.status_code == 200 and r.json()["ticket_status"] == "TRANSFERRED"
        ev = w.get(f"/tickets/{tid}/events", headers=OK).json()[-1]
        assert ev["kind"] == "transferred" and "roads as MCD-1" in ev["note"]
        assert w.post(f"/tickets/{tid}/transfer", headers=OK, json=body).status_code == 400  # final now
        other = _new_ticket(w, "Alipur")  # TRANSFERRED only comes from the transfer action
        assert w.patch(f"/tickets/{other}", headers=OK, json={"status": "TRANSFERRED", "note": "x"}).status_code == 400


def test_complaint_status_ignores_transferred_and_rejected_tickets():
    from agents.orchestrator.graph import citizen_status
    assert citizen_status(["TRANSFERRED", "IN_PROGRESS"]) == "IN_PROGRESS"
    assert citizen_status(["REJECTED", "RESOLVED"]) == "RESOLVED"
    assert citizen_status(["REJECTED"]) == "REJECTED"
    assert citizen_status(["TRANSFERRED"]) == "NOT_ROUTED"


def test_transfer_through_concierge(srv, monkeypatch):
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        task = rpc(w, "message/send", {"message": msg({"issue_type": "water_pipe_burst", "location": "Bawana",
                                                       "complaint_id": "CMP-20990404-0001"}),
                                       "configuration": {"blocking": True}})["result"]
        tid = task["artifacts"][0]["parts"][0]["data"]["ticket_id"]
    sent = []

    async def fake_orchestrator(payload):
        sent.append(payload)
        return {"complaint_id": payload["complaint_id"], "new_ticket_id": "MCD-261121-0009"}
    monkeypatch.setattr(srv, "call_orchestrator", fake_orchestrator)
    c, _ = login(srv, "water_officer")
    url = f"/api/dept/water/tickets/{tid}/transfer"
    assert c.post(url, json={"to_department": "roads", "note": " "}).status_code == 400
    r = c.post(url, json={"to_department": "roads", "issue_type": "road_cave_in", "note": "Road cave-in"})
    assert r.status_code == 200 and r.json()["new_ticket_id"] == "MCD-261121-0009"
    assert r.json()["ticket"]["ticket_status"] == "TRANSFERRED"
    assert sent[0]["action"] == "transfer" and sent[0]["from_ticket_id"] == tid and sent[1]["action"] == "status"
    citizen, _ = login(srv, "citizen1")
    assert citizen.post(url, json={"to_department": "roads", "note": "x"}).status_code == 403


# ---------------- confirm before filing, map pin ----------------
@pytest.fixture
def fake_concierge(monkeypatch):
    """The Concierge's NLU, geocoder and Orchestrator replaced by fakes; records what is filed."""
    from agents.concierge import core
    filed = []

    async def catalog():
        return []

    async def understand(text, catalog, mode=None):
        loc = "Rohini" if "rohini" in text.lower() else "Laxmi Nagar"
        return {"summary": text[:60], "location": loc, "urgency": "normal",
                "issues": [{"issue_type": "water_pipe_burst", "department": "water"}]}

    async def geocode(name):
        return {"name": name, "lat": 28.63, "lng": 77.27}

    async def orchestrator(payload):
        filed.append(payload)
        return {"complaint_id": f"CMP-20990505-000{len(filed)}", "overall_status": "REGISTERED",
                "departments": [], "summary": payload.get("summary")}
    monkeypatch.setattr(core, "skill_catalog", catalog)
    monkeypatch.setattr(core, "understand", understand)
    monkeypatch.setattr(core, "geocode", geocode)
    monkeypatch.setattr(core, "call_orchestrator", orchestrator)
    monkeypatch.setattr(core, "render_status", lambda u, new=True: f"Filed {u['complaint_id']}")
    return filed


def test_complaint_is_confirmed_before_filing(fake_concierge):
    import asyncio
    from agents.concierge.core import Session, handle_message
    s = Session()
    run = lambda t: asyncio.run(handle_message(t, s, confirm=True))  # noqa: E731
    r = run("pipe burst near Laxmi Nagar metro")
    assert r["state"] == "confirm" and "Shall I file it?" in r["reply"] and not fake_concierge
    r = run("no, it is in Rohini")  # a correction, not a cancel
    assert r["state"] == "confirm" and r["structured"]["location"] == "Rohini" and not fake_concierge
    r = run("haan")
    assert r["state"] == "completed" and len(fake_concierge) == 1
    assert fake_concierge[0]["location"] == "Rohini"
    assert run("pipe burst in Rohini")["state"] == "confirm"
    assert run("cancel")["state"] == "idle" and len(fake_concierge) == 1
    # other agents (A2A) still get it filed straight away
    assert asyncio.run(handle_message("pipe burst in Rohini", Session()))["state"] == "completed"


def test_confirm_endpoint_files_at_the_pin(srv, fake_concierge):
    c, me = login(srv, "citizen1")
    assert c.post("/api/chat/confirm", json={"session_id": "p1"}).status_code == 409  # nothing drafted
    assert c.post("/api/chat", json={"message": "pipe burst in Laxmi Nagar", "session_id": "p1"}).json()["state"] == "confirm"
    assert c.post("/api/chat/confirm", json={"session_id": "p1", "lat": 19.07, "lng": 72.87}).status_code == 400  # Mumbai
    r = c.post("/api/chat/confirm", json={"session_id": "p1", "lat": 28.6301, "lng": 77.2772})
    assert r.status_code == 200 and r.json()["state"] == "completed"
    geo = fake_concierge[-1]["geo"]
    assert geo["pinned"] and geo["lat"] == 28.6301 and geo["name"] == "Laxmi Nagar"
    cid = r.json()["unified"]["complaint_id"]
    assert srv.auth.owner_of(cid) == me.json()["user"]["id"]
    c.post("/api/chat", json={"message": "pipe burst in Laxmi Nagar", "session_id": "p1"})
    assert c.post("/api/chat/confirm", json={"session_id": "p1", "action": "cancel"}).json()["state"] == "idle"


# ---------------- per-officer accounts, performance ----------------
def test_admin_manages_officer_accounts(srv):
    a, _ = login(srv, "admin")
    body = {"username": "ravi.kumar", "display_name": "Ravi Kumar", "department": "water", "password": "ravi-pass-123"}
    assert a.post("/api/admin/users", json={**body, "department": "nowhere"}).status_code == 400
    assert a.post("/api/admin/users", json={**body, "password": "short"}).status_code == 400
    r = a.post("/api/admin/users", json=body)
    assert r.status_code == 200 and r.json()["role"] == "officer" and r.json()["department"] == "water"
    assert any(u["username"] == "ravi.kumar" for u in a.get("/api/admin/users").json())
    o, r = login(srv, "ravi.kumar", "ravi-pass-123")
    assert r.status_code == 200 and o.get("/api/dept/water/tickets").status_code == 200
    # he changes his password
    assert o.post("/api/me/password", json={"current": "wrong", "new": "ravi-new-pass"}).status_code == 400
    assert o.post("/api/me/password", json={"current": "ravi-pass-123", "new": "ravi-new-pass"}).status_code == 200
    # switched off: his session ends and he can't sign in again
    uid = r.json()["user"]["id"]
    assert a.patch(f"/api/admin/users/{uid}", json={"active": False}).json()["active"] is False
    assert o.get("/api/me").status_code == 401
    assert login(srv, "ravi.kumar", "ravi-new-pass")[1].status_code == 401
    # back on, with a password reset by the admin
    a.patch(f"/api/admin/users/{uid}", json={"active": True, "password": "reset-pass-99"})
    assert login(srv, "ravi.kumar", "reset-pass-99")[1].status_code == 200
    admin_id = a.get("/api/me").json()["id"]
    assert a.patch(f"/api/admin/users/{admin_id}", json={"active": False}).status_code == 400
    assert o.get("/api/admin/users").status_code in (401, 403)
    assert login(srv, "water_officer")[0].post("/api/admin/users", json=body).status_code == 403


def test_department_stats_and_admin_performance(srv):
    from agents.domain.water import app as water_app
    with TestClient(water_app) as w:
        tid = _new_ticket(w, "Mayur Vihar")
        w.patch(f"/tickets/{tid}", headers=OK, json={"status": "RESOLVED", "note": "Fixed", "actor": "Meena Rao"})
        s = w.get("/stats", headers=OK).json()
    meena = next(o for o in s["officers"] if o["name"] == "Meena Rao")
    assert meena["resolved"] == 1 and s["fixed"] >= 1 and s["avg_fix_hours"] is not None
    assert {"open", "overdue", "on_time_pct", "reopen_pct", "by_status"} <= s.keys()
    a, _ = login(srv, "admin")
    p = a.get("/api/admin/performance").json()
    assert any(d["key"] == "water" and d["online"] for d in p["departments"])
    assert any(o["name"] == "Meena Rao" for o in p["officers"]) and "total" in p["complaints"]
    assert login(srv, "water_officer")[0].get("/api/admin/performance").status_code == 403

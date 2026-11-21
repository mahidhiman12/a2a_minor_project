"""
Citizen Concierge Agent (HOST)  ->  uvicorn agents.concierge.server:app --port 8000

The only component people see. Serves the login page and three role-based pages:
  /            citizen chat UI (live A2A trail, Agent Cards, My complaints, heatmap)
  /dept/<key>  department officer dashboard (one per department found via Agent Cards)
  /admin       admin overview of every department
It is also exposed as an A2A agent (so other systems, e.g. a helpline IVR agent,
could delegate to it). The A2A routes (agent card + JSON-RPC POST /) need no login.
"""
from __future__ import annotations

import asyncio
import logging
import os
import ssl
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agents.concierge import auth
from agents.concierge.core import (COMPLAINT_ID_RX, DELHI_BOUNDS, Session, call_orchestrator, file_draft,
                                   handle_message)
from common import config
from common.a2a import (AgentCard, AgentProvider, AgentSkill, TaskStore, get_text,
                        make_artifact, mount_a2a)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("concierge")
# The website is the React app in <repo>/frontend. `npm run build` puts it in frontend/dist and
# this server hands out its index.html for every page route (the app routes in the browser).
# Without a build, or with CONCIERGE_UI=classic, the original pages in ./static are used.
SPA_DIST = config.FRONTEND_DIST
CLASSIC = Path(__file__).parent / "static"
USE_SPA = os.getenv("CONCIERGE_UI", "app").lower() != "classic" and (SPA_DIST / "index.html").is_file()
sessions: dict[str, Session] = {}
# Building a TLS context costs ~0.7 s per httpx client on Windows; build it once.
_TLS = ssl.create_default_context()


@asynccontextmanager
async def lifespan(_app):
    try:  # create <dept>_officer accounts for every department agent that is up
        await departments(force=True)
    except Exception as e:  # orchestrator not up yet: accounts are created on first login
        log.warning("department discovery at startup failed: %s", e)
    yield


app = FastAPI(title="Citizen Concierge Agent", lifespan=lifespan)
if USE_SPA:  # hashed JS/CSS bundles of the React app (public, no secrets)
    app.mount("/assets", StaticFiles(directory=SPA_DIST / "assets"), name="assets")
else:
    log.warning("frontend/dist not found - serving the classic pages. Build the website with: "
                "cd frontend && npm install && npm run build")


def page(classic_name: str) -> FileResponse:
    """The React app's index.html, or the matching classic page when there is no build."""
    if USE_SPA:
        return FileResponse(SPA_DIST / "index.html", headers={"Cache-Control": "no-cache"})
    return FileResponse(CLASSIC / classic_name)


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    if USE_SPA and (SPA_DIST / "favicon.svg").is_file():
        return FileResponse(SPA_DIST / "favicon.svg")
    raise HTTPException(404)


class ChatIn(BaseModel):
    message: str
    session_id: str = "default"
    mode: str | None = None


class LoginIn(BaseModel):
    username: str
    password: str


class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: str | None = None


class FeedbackIn(BaseModel):
    action: str                 # "confirm" or "reopen"
    note: str | None = None


class TicketUpdateIn(BaseModel):
    status: str | None = None   # None = post a note only
    note: str | None = None
    question: bool = False      # the note is a question the citizen should answer
    crew: str | None = None
    priority: str | None = None
    eta: str | None = None      # ISO 8601


class TransferIn(BaseModel):
    to_department: str
    issue_type: str | None = None
    note: str


# ------------------------------ auth helpers ------------------------------
def bearer_token(request: Request) -> str | None:
    h = request.headers.get("authorization") or ""
    return h[7:].strip() if h.lower().startswith("bearer ") else None


def current_user(request: Request) -> dict | None:
    """Per-tab sign-in: a tab that holds its own session token sends it as
    'Authorization: Bearer <token>' and is that user, whatever the shared cookie says.
    A tab without one (e.g. a freshly opened one) falls back to the cookie."""
    token = bearer_token(request)
    if token is not None:
        return auth.read_session(token)  # an invalid/expired tab token never falls back
    return auth.read_session(request.cookies.get(auth.COOKIE))


def api_user(request: Request, *roles: str) -> dict:
    """For /api/*: 401 if logged out, 403 if the role is not allowed."""
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Please log in")
    if roles and user["role"] not in roles:
        raise HTTPException(403, "Your role cannot use this")
    return user


def can_see_dept(user: dict, dept: str) -> bool:
    return user["role"] == "admin" or (user["role"] == "officer" and user["department"] == dept)


def to_login():
    return RedirectResponse("/login", status_code=303)


def error_page(code: int, title: str, text: str, user: dict | None) -> HTMLResponse:
    home = auth.home_for(user) if user else "/login"
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>:root{{color-scheme:light dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;
background:#F2F2F7;color:#000;padding:16px;-webkit-font-smoothing:antialiased;
font:17px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Helvetica Neue",system-ui,sans-serif}}
.c{{background:#fff;border-radius:14px;padding:22px 20px 16px;max-width:300px;text-align:center}}
h1{{margin:0 0 4px;font-size:17px;font-weight:600}}p{{margin:0 0 18px;font-size:13px;color:rgba(60,60,67,.6)}}
a{{display:block;border-top:.5px solid rgba(60,60,67,.29);margin:0 -20px -16px;padding:12px;color:#007AFF;
text-decoration:none;font-weight:600}}@media(prefers-color-scheme:dark){{body{{background:#000;color:#fff}}
.c{{background:#2C2C2E}}p{{color:rgba(235,235,245,.6)}}a{{color:#0A84FF;border-color:rgba(84,84,88,.65)}}}}</style>
</head><body><div class="c"><h1>{title}</h1><p>{text}<br><small>Error {code}</small></p>
<a href="{home}">Go to My Page</a></div></body></html>""", status_code=code)



# ------------------------------ department discovery ------------------------------
_dept_cache: tuple[float, list[dict]] = (0.0, [])


async def fetch_agents() -> list[dict]:
    """Agent Cards as discovered by the Orchestrator (it alone knows the agent URLs)."""
    return await _orch("/agents")


async def departments(force: bool = False) -> list[dict]:
    """Departments = online agents found through Agent Cards. Every one of them gets a
    <key>_officer login and a /dept/<key> dashboard - no per-department code anywhere."""
    global _dept_cache
    if not force and _dept_cache[1] and time.time() - _dept_cache[0] < 15:
        return _dept_cache[1]
    try:
        agents = await fetch_agents()
    except Exception as e:
        log.warning("could not reach the Orchestrator for Agent Cards: %s", e)
        return _dept_cache[1]
    depts = [{"key": a["key"], "name": a.get("name"), "base": a["_base"].rstrip("/"),
              "organisation": (a.get("provider") or {}).get("organization") or a.get("name"),
              "online": True}
             for a in agents if not a.get("_offline")]
    auth.seed_department_officers([d["key"] for d in depts])
    _dept_cache = (time.time(), depts)
    return depts


async def find_department(key: str) -> dict | None:
    for d in await departments():
        if d["key"] == key:
            return d
    if key in auth.officer_departments():  # known department whose agent is down right now
        return {"key": key, "name": key.title(), "organisation": key.title(), "base": None,
                "online": False}
    return None


async def dept_call(method: str, dept: str, path: str, json: dict | None = None):
    """Server-side call to a department agent's ticket REST API with the service token."""
    d = await find_department(dept)
    if not d:
        raise HTTPException(404, f"No department agent '{dept}' was discovered")
    if not d["online"]:
        raise HTTPException(503, f"The {dept} agent is offline")
    try:
        async with httpx.AsyncClient(timeout=10, verify=_TLS) as h:
            r = await h.request(method, d["base"] + path, json=json,
                                headers={"X-Service-Token": config.SERVICE_TOKEN})
    except httpx.HTTPError as e:
        raise HTTPException(503, f"The {dept} agent is not reachable ({e})") from None
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = r.text
        raise HTTPException(r.status_code, detail)
    return d, r.json()


# ------------------------------ pages ------------------------------
# With the React app every page route returns the app: each browser tab can be signed in as
# a different user (per-tab sign-in), which the server can't see on a page load, so the app
# routes and guards in the browser. Every /api route still enforces the role. The classic
# pages (no build, or CONCIERGE_UI=classic) keep the server-side checks below.
@app.get("/login")
def login_page(request: Request):
    if USE_SPA:
        return page("login.html")
    user = current_user(request)
    if user:
        return RedirectResponse(auth.home_for(user), status_code=303)
    return page("login.html")


@app.get("/")
def index(request: Request):
    """The React app's public landing page. The classic pages have no landing page, so there
    `/` keeps sending people to their own page (or to the login)."""
    if USE_SPA:
        return page("index.html")
    user = current_user(request)
    if not user:
        return to_login()
    return RedirectResponse(auth.home_for(user), status_code=303)


@app.get("/home")
def citizen_home(request: Request):
    if USE_SPA:
        return page("index.html")
    user = current_user(request)
    if not user:
        return to_login()
    if user["role"] != "citizen":
        return RedirectResponse(auth.home_for(user), status_code=303)
    return page("index.html")


@app.get("/dept/{dept}")
async def dept_page(dept: str, request: Request):
    if USE_SPA:
        return page("dept.html")
    user = current_user(request)
    if not user:
        return to_login()
    if not can_see_dept(user, dept):
        return error_page(403, "Not your department",
                          f"Your account cannot open the <b>{dept}</b> dashboard.", user)
    if not await find_department(dept):
        return error_page(404, "Unknown department",
                          f"No department agent called <b>{dept}</b> was found through the "
                          "Agent Cards.", user)
    return page("dept.html")


@app.get("/admin")
def admin_page(request: Request):
    if USE_SPA:
        return page("admin.html")
    user = current_user(request)
    if not user:
        return to_login()
    if user["role"] != "admin":
        return error_page(403, "Admins only", "Your account cannot open the admin overview.", user)
    return page("admin.html")


# ------------------------------ auth API ------------------------------
@app.post("/api/login")
async def login(body: LoginIn):
    name = body.username.strip().lower()
    if name.endswith("_officer") and not auth.user_exists(name):
        await departments(force=True)  # a department agent may have just come online
    user = auth.authenticate(name, body.password)
    if not user:
        return JSONResponse({"detail": "Wrong username or password"}, status_code=401)
    return signed_in(user)


def signed_in(user: dict) -> JSONResponse:
    """The tab that signed in keeps `token` for itself (per-tab sign-in). The cookie is the
    default account for tabs opened later; tabs that already hold a token are not affected."""
    token = auth.make_session(user)
    resp = JSONResponse({"ok": True, "user": user, "redirect": auth.home_for(user), "token": token})
    resp.set_cookie(auth.COOKIE, token, max_age=int(config.SESSION_HOURS * 3600),
                    httponly=True, samesite="lax", secure=False, path="/")
    return resp


@app.post("/api/register")
def register(body: RegisterIn):
    """Self-registration creates CITIZEN accounts only; officers are created from Agent Cards."""
    try:
        user = auth.create_user(body.username, body.password, "citizen", None, body.display_name)
    except ValueError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    return signed_in(user)


@app.post("/api/logout")
def logout(request: Request):
    """Signs out this tab. The shared cookie is cleared only if it belongs to the same user,
    so signing out the officer tab doesn't sign out the citizen tab (or the other way round)."""
    resp = JSONResponse({"ok": True, "redirect": "/login"})
    tab = auth.read_session(bearer_token(request)) if bearer_token(request) else None
    cookie = auth.read_session(request.cookies.get(auth.COOKIE))
    if tab is None or (cookie and cookie["id"] == tab["id"]):
        resp.delete_cookie(auth.COOKIE, path="/")
    return resp


@app.get("/api/me")
def me(request: Request):
    """Who this tab is. A tab signed in only through the cookie also gets the token, so it
    can pin itself to this account before another tab signs in as someone else."""
    user = api_user(request)
    out = {**user, "home": auth.home_for(user)}
    if bearer_token(request) is None:
        out["token"] = request.cookies.get(auth.COOKIE)
    return out


# ------------------------------ citizen API ------------------------------
@app.post("/api/chat")
async def chat(body: ChatIn, request: Request):
    user = api_user(request, "citizen")
    m = COMPLAINT_ID_RX.search(body.message)
    if m and auth.owner_of(m.group(0)) != user["id"]:
        return {"reply": f"Complaint **{m.group(0).upper()}** was not filed from your account, "
                         "so I can't show it. Open **My complaints** to see yours.",
                "state": "failed"}
    s = sessions.setdefault(f"{user['id']}:{body.session_id}", Session())
    try:
        out = await handle_message(body.message, s, body.mode, confirm=True)
    except httpx.ConnectError:
        return {"reply": "The Orchestrator agent is not reachable. Is it running on "
                         f"{config.ORCHESTRATOR_URL}?", "state": "failed"}
    if out.get("state") == "completed" and out.get("unified"):
        auth.record_owner(out["unified"]["complaint_id"], user["id"])
    return out


class ConfirmIn(BaseModel):
    session_id: str = "default"
    action: str = "file"            # "file" or "cancel"
    lat: float | None = None        # the exact spot, if the citizen moved the map pin
    lng: float | None = None


@app.post("/api/chat/confirm")
async def chat_confirm(body: ConfirmIn, request: Request):
    """The 'File complaint' / 'Cancel' buttons under the Concierge's summary. Filing can carry
    the exact spot the citizen marked on the map."""
    user = api_user(request, "citizen")
    s = sessions.get(f"{user['id']}:{body.session_id}")
    if not s or not s.draft:
        raise HTTPException(409, "There's nothing waiting to be filed. Describe the problem first.")
    if body.action == "cancel":
        s.draft = s.pending = None
        return {"reply": "Okay, I haven't filed anything. Describe the problem again whenever "
                         "you're ready.", "state": "idle"}
    if body.action != "file":
        raise HTTPException(400, "action must be 'file' or 'cancel'")
    pin = None
    if body.lat is not None and body.lng is not None:
        south, north, west, east = DELHI_BOUNDS
        if not (south <= body.lat <= north and west <= body.lng <= east):
            raise HTTPException(400, "Please put the pin somewhere in Delhi")
        pin = (body.lat, body.lng)
    try:
        out = await file_draft(s, pin)
    except httpx.ConnectError:
        raise HTTPException(503, "The Orchestrator agent is not reachable") from None
    auth.record_owner(out["unified"]["complaint_id"], user["id"])
    return out


@app.get("/api/my-complaints")
async def my_complaints(request: Request):
    """The citizen's complaints with live status, refreshed through the Orchestrator's
    A2A complaint_status skill (which calls tasks/get on each department agent)."""
    user = api_user(request, "citizen")

    async def one(cid: str):
        try:
            return await call_orchestrator({"action": "status", "complaint_id": cid})
        except Exception:
            try:  # fall back to the last stored status
                return (await _orch(f"/complaints/{cid}")).get("unified")
            except Exception:
                return None

    ids = auth.complaints_of(user["id"])[:30]
    return [u for u in await asyncio.gather(*(one(c) for c in ids)) if u]


@app.get("/api/complaints/{cid}")
async def complaint_detail(cid: str, request: Request):
    """One complaint for its owner (or an admin): live unified status refreshed over A2A,
    plus the structured complaint the Concierge extracted (issues, urgency, place)."""
    user = api_user(request, "citizen", "admin")
    cid = cid.upper()
    if user["role"] == "citizen" and auth.owner_of(cid) != user["id"]:
        raise HTTPException(403, "Not your complaint")
    try:
        stored = await _orch(f"/complaints/{cid}")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(404, f"No complaint {cid}") from None
        raise HTTPException(503, "The Orchestrator could not load this complaint") from None
    except httpx.HTTPError:
        raise HTTPException(503, "The Orchestrator agent is not reachable") from None
    unified, live = stored.get("unified"), False
    try:
        unified, live = await call_orchestrator({"action": "status", "complaint_id": cid}), True
    except Exception as e:  # department agent down: show the last stored status
        log.warning("live status refresh for %s failed: %s", cid, e)
    return {"unified": unified, "structured": stored.get("structured"), "live": live,
            "updates": await department_updates(unified)}


@app.get("/api/public/overview")
async def public_overview():
    """Anonymised, read-only figures for the public landing page. No login. Never returns a
    citizen's own words, names or exact addresses - only issue names, locality and status."""
    out = {"agents_online": 0, "departments": [], "recent": [], "hotspots": []}
    try:
        cards = await fetch_agents()
    except Exception:
        return out
    online = [a for a in cards if not a.get("_offline")]
    out["agents_online"] = len(online)
    out["departments"] = [{"key": a["key"], "name": a.get("name"), "online": not a.get("_offline"),
                           "skills": [s.get("name") or s.get("id") for s in a.get("skills") or []]}
                          for a in cards]
    try:
        rows = (await _orch("/complaints"))[:6]
        full = await asyncio.gather(*(_orch(f"/complaints/{r['complaint_id']}") for r in rows),
                                    return_exceptions=True)
        for r, f in zip(rows, full):
            u = (f.get("unified") if isinstance(f, dict) else None) or {}
            deps = u.get("departments") or []
            out["recent"].append({
                "issue": next((d.get("issue_name") for d in deps if d.get("issue_name")), None),
                "location": r.get("location"), "status": r.get("overall_status"),
                "departments": [d["department"] for d in deps], "created_at": r.get("created_at")})
        heat = await _orch("/heatmap")
        out["hotspots"] = [{"locality": p["locality"], "complaints": p["complaints"]}
                           for p in heat.get("points", [])[:5]]
    except Exception as e:
        log.warning("public overview: %s", e)
    return out


async def _orch(path: str):
    async with httpx.AsyncClient(timeout=15, verify=_TLS) as h:
        r = await h.get(config.ORCHESTRATOR_URL + path)
        r.raise_for_status()
        return r.json()


@app.get("/api/agents")
async def agents(request: Request):
    api_user(request)
    out = await fetch_agents()
    for a in out:  # operator consoles now live on the Concierge, behind login
        a["_dashboard"] = f"/dept/{a['key']}"
    return out


@app.get("/api/departments")
async def list_departments(request: Request):
    api_user(request)
    return [{k: d[k] for k in ("key", "name", "organisation", "online")}
            for d in await departments()]


@app.get("/api/complaints")
async def complaints(request: Request):
    """Every complaint (admin only). Citizens use /api/my-complaints."""
    api_user(request, "admin")
    owners = auth.owners_map()
    return [{**c, "citizen": owners.get(c["complaint_id"])} for c in await _orch("/complaints")]


@app.get("/api/heatmap")
async def heatmap(request: Request):
    api_user(request)
    return await _orch("/heatmap")


@app.get("/api/trail/{cid}")
async def trail(cid: str, request: Request):
    user = api_user(request, "citizen", "admin")
    if user["role"] == "citizen" and auth.owner_of(cid) != user["id"]:
        raise HTTPException(403, "Not your complaint")
    return await _orch(f"/complaints/{cid}/trail")


@app.get("/api/config")
def cfg(request: Request):
    api_user(request)
    return {"nlu_mode": config.NLU_MODE, "ollama_model": config.OLLAMA_MODEL,
            "gemini_model": config.GEMINI_MODEL, "gemini_key_set": bool(config.GEMINI_API_KEY),
            "orchestrator": config.ORCHESTRATOR_URL}


# ------------------------------ department dashboard API ------------------------------
@app.get("/api/dept/{dept}/tickets")
async def dept_tickets(dept: str, request: Request):
    user = api_user(request, "officer", "admin")
    if not can_see_dept(user, dept):
        raise HTTPException(403, "Not your department")
    d, tickets = await dept_call("GET", dept, "/tickets")
    return {"department": {k: d[k] for k in ("key", "name", "organisation")},
            "tickets": tickets}


@app.patch("/api/dept/{dept}/tickets/{ticket_id}")
async def dept_update(dept: str, ticket_id: str, body: TicketUpdateIn, request: Request):
    user = api_user(request, "officer", "admin")
    if not can_see_dept(user, dept):
        raise HTTPException(403, "Not your department")
    _, ticket = await dept_call("PATCH", dept, f"/tickets/{ticket_id}",
                                {**body.model_dump(), "actor": user["display_name"]})
    return ticket


@app.post("/api/dept/{dept}/tickets/{ticket_id}/transfer")
async def dept_transfer(dept: str, ticket_id: str, body: TransferIn, request: Request):
    """'This isn't ours': the Orchestrator registers a ticket with the other department over
    A2A, then this department marks its own ticket TRANSFERRED. If the other department
    can't take it, nothing changes here."""
    user = api_user(request, "officer", "admin")
    if not can_see_dept(user, dept):
        raise HTTPException(403, "Not your department")
    if not body.note.strip():
        raise HTTPException(400, "Say why it belongs to the other department")
    if body.to_department == dept:
        raise HTTPException(400, "Pick another department")
    _, t = await dept_call("GET", dept, f"/tickets/{ticket_id}")
    if t["ticket_status"] in ("CLOSED", "REJECTED", "TRANSFERRED"):
        raise HTTPException(400, f"A {t['ticket_status']} ticket can't be transferred")
    if t.get("duplicate_of"):
        raise HTTPException(400, f"This report is linked to {t['duplicate_of']}. Transfer that ticket instead.")
    if any(x for x in t.get("duplicates") or []):
        raise HTTPException(400, "Other reports are linked to this ticket, so it can't be transferred. "
                                 "Reject it with a reason instead.")
    if not t.get("complaint_ref"):
        raise HTTPException(400, "Only tickets from a citizen complaint can be transferred")
    try:
        unified = await call_orchestrator({"action": "transfer", "complaint_id": t["complaint_ref"],
                                           "from_ticket_id": ticket_id, "to_department": body.to_department,
                                           "issue_type": body.issue_type, "note": body.note.strip()})
    except httpx.HTTPError:
        raise HTTPException(503, "The Orchestrator agent is not reachable") from None
    except RuntimeError as e:  # e.g. the other department's agent is offline
        raise HTTPException(409, f"The transfer didn't go through: {e}") from None
    _, ticket = await dept_call("POST", dept, f"/tickets/{ticket_id}/transfer",
                                {"to_department": body.to_department, "note": body.note.strip(),
                                 "to_ticket_id": unified.get("new_ticket_id"), "actor": user["display_name"]})
    try:  # show the old ticket as TRANSFERRED in the complaint right away
        await call_orchestrator({"action": "status", "complaint_id": t["complaint_ref"]})
    except Exception as e:
        log.warning("status refresh after transfer of %s: %s", ticket_id, e)
    return {"ticket": ticket, "new_ticket_id": unified.get("new_ticket_id"),
            "to_department": body.to_department}


@app.get("/api/dept/{dept}/tickets/{ticket_id}")
async def dept_ticket(dept: str, ticket_id: str, request: Request):
    """One ticket for its department's officer (or an admin): the ticket and its history,
    plus the complaint it came from and every other department's ticket on it."""
    user = api_user(request, "officer", "admin")
    if not can_see_dept(user, dept):
        raise HTTPException(403, "Not your department")
    d, ticket = await dept_call("GET", dept, f"/tickets/{ticket_id}")
    complaint = None
    if ticket.get("complaint_ref"):
        try:
            stored = await _orch(f"/complaints/{ticket['complaint_ref']}")
            s, u = stored.get("structured") or {}, stored.get("unified") or {}
            complaint = {"complaint_id": ticket["complaint_ref"], "summary": s.get("summary"),
                         "location": s.get("location"), "urgency": s.get("urgency"),
                         # the crew needs the exact spot and the citizen's own words
                         "geo": s.get("geo"), "citizen_text": s.get("citizen_text"),
                         "issues": s.get("issues") or [], "created_at": u.get("created_at"),
                         "overall_status": u.get("overall_status"),
                         "coordination_plan": u.get("coordination_plan") or [],
                         "departments": u.get("departments") or []}
        except Exception as e:  # the ticket is still useful without its complaint
            log.warning("complaint %s for ticket %s: %s", ticket["complaint_ref"], ticket_id, e)
    return {"department": {k: d[k] for k in ("key", "name", "organisation")},
            "ticket": ticket, "complaint": complaint}


@app.post("/api/complaints/{cid}/tickets/{ticket_id}/feedback")
async def ticket_feedback(cid: str, ticket_id: str, body: FeedbackIn, request: Request):
    """The citizen who filed the complaint confirms a department's fix or reopens it."""
    user = api_user(request, "citizen")
    cid = cid.upper()
    if auth.owner_of(cid) != user["id"]:
        raise HTTPException(403, "Not your complaint")
    try:
        unified = (await _orch(f"/complaints/{cid}")).get("unified") or {}
    except httpx.HTTPError:
        raise HTTPException(503, "The Orchestrator agent is not reachable") from None
    dept = next((d["department"] for d in unified.get("departments") or []
                 if d.get("ticket_id") == ticket_id), None)
    if not dept:
        raise HTTPException(404, f"Ticket {ticket_id} is not part of complaint {cid}")
    _, ticket = await dept_call("POST", dept, f"/tickets/{ticket_id}/citizen",
                                {"action": body.action, "note": body.note})
    return ticket


# ------------------------------ accounts (admin) & own password ------------------------------
class NewOfficerIn(BaseModel):
    username: str
    display_name: str
    department: str
    password: str


class UserPatchIn(BaseModel):
    active: bool | None = None
    password: str | None = None   # admin sets a new password (e.g. the officer forgot theirs)


class PasswordIn(BaseModel):
    current: str
    new: str


@app.get("/api/admin/users")
def admin_users(request: Request):
    api_user(request, "admin")
    return auth.list_users()


@app.post("/api/admin/users")
async def admin_create_officer(body: NewOfficerIn, request: Request):
    """One account per officer, so every update on a ticket shows who made it."""
    api_user(request, "admin")
    if not await find_department(body.department):
        raise HTTPException(400, f"No department '{body.department}' was found through the Agent Cards")
    if not body.display_name.strip():
        raise HTTPException(400, "Enter the officer's name")
    if len(body.password) < 8:
        raise HTTPException(400, "Use at least 8 characters for the password")
    try:
        return auth.create_user(body.username, body.password, "officer", body.department,
                                body.display_name.strip())
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, body: UserPatchIn, request: Request):
    me_ = api_user(request, "admin")
    target = auth.get_user(user_id)
    if not target:
        raise HTTPException(404, "No such account")
    if body.active is False and (target["id"] == me_["id"] or target["role"] == "admin"):
        raise HTTPException(400, "Admin accounts can't be switched off here")
    if body.password is not None:
        try:
            auth.set_password(user_id, body.password)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
    if body.active is not None:
        target = auth.set_active(user_id, body.active)
    return target


@app.post("/api/me/password")
def change_my_password(body: PasswordIn, request: Request):
    user = api_user(request)
    try:
        auth.change_password(user["id"], body.current, body.new)
    except PermissionError as e:
        raise HTTPException(400, str(e)) from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@app.get("/api/admin/performance")
async def admin_performance(request: Request):
    """How each department and officer is doing, plus complaint-level figures."""
    api_user(request, "admin")
    depts = await departments()
    stats = await asyncio.gather(*(dept_call("GET", d["key"], "/stats") for d in depts),
                                 return_exceptions=True)
    rows = []
    for d, s in zip(depts, stats):
        rows.append({**s[1], "key": d["key"], "online": True} if isinstance(s, tuple)
                    else {"key": d["key"], "name": d.get("organisation") or d.get("name"), "online": False})
    try:
        complaints = await _orch("/complaints")
    except Exception:
        complaints = []
    by_status: dict[str, int] = {}
    for c in complaints:
        by_status[c.get("overall_status") or "UNKNOWN"] = by_status.get(c.get("overall_status") or "UNKNOWN", 0) + 1
    accounts = {u["display_name"]: u for u in auth.list_users() if u["role"] == "officer"}
    officers = [{**o, "department": r["key"], "username": (accounts.get(o["name"]) or {}).get("username"),
                 "active": (accounts.get(o["name"]) or {}).get("active")}
                for r in rows if r.get("online") for o in r.get("officers", [])]
    return {"departments": rows, "officers": sorted(officers, key=lambda o: -o["updates"]),
            "complaints": {"total": len(complaints), "by_status": by_status,
                           "multi_department": sum(bool(c.get("composite")) for c in complaints)}}


@app.get("/api/sla")
async def sla_summary(request: Request):
    """Admin: per department, how many tickets are open, overdue or due soon, and how often
    the department fixed things on time."""
    api_user(request, "admin")

    async def one(d: dict):
        _, tickets = await dept_call("GET", d["key"], "/tickets")
        own = [t for t in tickets if not t.get("duplicate_of")]  # linked reports count once
        states = [(t.get("sla") or {}).get("state") for t in own]
        met, missed = states.count("met"), states.count("missed")
        return {"key": d["key"], "name": d.get("name"), "online": True,
                "open": sum(t["ticket_status"] not in ("RESOLVED", "CLOSED") for t in own),
                "overdue": states.count("overdue"), "due_soon": states.count("due_soon"),
                "awaiting_confirmation": sum(t["ticket_status"] == "RESOLVED" for t in own),
                "fixed": met + missed,
                "on_time_pct": round(100 * met / (met + missed)) if met + missed else None}

    depts = await departments()
    out = await asyncio.gather(*(one(d) for d in depts), return_exceptions=True)
    return [r if isinstance(r, dict) else {"key": d["key"], "name": d.get("name"), "online": False}
            for d, r in zip(depts, out)]


async def department_updates(unified: dict | None) -> list[dict]:
    """The history of every department ticket on a complaint, oldest first, for the citizen.
    Officer names are left out; the citizen sees which department did what."""
    deps = [d for d in (unified or {}).get("departments") or [] if d.get("ticket_id")]

    async def one(d: dict):
        _, events = await dept_call("GET", d["department"], f"/tickets/{d['ticket_id']}/events")
        return [{"department": d["department"], "department_name": d.get("department_name"),
                 "ticket_id": d["ticket_id"], "ts": e["ts"], "kind": e["kind"],
                 "status": e.get("status"), "note": e.get("note") if e["kind"] != "created" else None}
                for e in events]

    out = []
    for r in await asyncio.gather(*(one(d) for d in deps), return_exceptions=True):
        if isinstance(r, list):  # a department that is down just has no updates to show
            out += r
    return sorted(out, key=lambda e: e["ts"] or "")


# ---- A2A interface: lets other agents talk to the concierge (no login) ----
async def handle(task: dict, store: TaskStore):
    store.set_state(task["id"], "working")
    s = sessions.setdefault(task["contextId"], Session())
    out = await handle_message(get_text(task["history"][-1]), s)
    store.add_artifact(task["id"], make_artifact("reply", out))
    store.set_state(task["id"], "input-required" if out["state"] == "input-required" else "completed",
                    out["reply"])


mount_a2a(app, AgentCard(
    name="Citizen Concierge Agent",
    description="Citizen-facing host agent. Accepts plain-language civic complaints "
                "(English/Hinglish), extracts structured intent and location, and returns "
                "a consolidated multi-department status.",
    url=config.url("concierge") + "/",
    provider=AgentProvider(organization="Citizen Grievance Coordination Cell (simulated)"),
    defaultInputModes=["text/plain"],
    skills=[AgentSkill(id="file_complaint", name="File a civic complaint",
                       description="Register a water / electricity / roads complaint",
                       tags=["citizen", "intake"],
                       examples=["Road work near Laxmi Nagar metro broke the water pipe"]),
            AgentSkill(id="check_status", name="Check complaint status",
                       description="Unified status of a complaint id", tags=["status"],
                       examples=["status CMP-20261021-0001"])],
), handle)


# ---- every other page route belongs to the React app (it routes and guards in the browser;
#      the /api routes above enforce the same roles). Registered last so it never shadows them.
@app.get("/{path:path}", include_in_schema=False)
def spa_fallback(path: str):
    if USE_SPA and not path.startswith(("api/", "assets/", ".well-known/")):
        return page("index.html")
    raise HTTPException(404)

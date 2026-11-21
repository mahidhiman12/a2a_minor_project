"""
Orchestrator Agent  ->  uvicorn agents.orchestrator.server:app --port 8001

An A2A agent itself (it has its own Agent Card). Skills:
  * resolve_complaint  - decompose a structured complaint, dispatch to department
                         agents, return a unified status artifact
  * complaint_status   - refresh the unified status of an existing complaint
Keeps an auditable task trail (every A2A request/response and state change)
in its own SQLite database.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException

from agents.orchestrator.graph import agent_key, build_graph, build_unified, discover_agents
from common import config
from common.a2a import (A2AClient, AgentCard, AgentProvider, AgentSkill, TaskStore, data_part,
                        get_data, make_artifact, make_message, mount_a2a, now_iso, text_part)
from common.localities import LOCALITY_COORDS, normalise_locality

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("orchestrator")

app = FastAPI(title="Orchestrator Agent")
DB = config.DB_DIR / "orchestrator.db"
graph = build_graph()


def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


with db() as c:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS complaints(complaint_id TEXT PRIMARY KEY, created_at TEXT,
        structured TEXT, unified TEXT, subtasks TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, complaint_id TEXT,
        ts TEXT, actor TEXT, event TEXT, detail TEXT);
    """)


def next_complaint_id() -> str:
    with db() as c:
        n = c.execute("SELECT COUNT(*) FROM complaints").fetchone()[0] + 1
    return f"CMP-{datetime.now(timezone.utc):%Y%m%d}-{n:04d}"


def event_logger(complaint_id: str):
    def log_event(actor: str, event: str, detail: dict):
        with db() as c:
            c.execute("INSERT INTO events(complaint_id, ts, actor, event, detail) VALUES(?,?,?,?,?)",
                      (complaint_id, now_iso(), actor, event, json.dumps(detail, default=str)))
    return log_event


def wire_logger(log_event):
    """Records every JSON-RPC message on the wire (distributed trace)."""
    def on_wire(direction: str, url: str, payload: dict):
        if direction == "request":
            log_event("orchestrator", "jsonrpc_request",
                      {"to": url, "method": payload["method"], "payload": payload})
        else:
            res = payload.get("result") or {}
            log_event(url, "jsonrpc_response",
                      {"from": url, "state": (res.get("status") or {}).get("state"),
                       "payload": payload})
    return on_wire


async def resolve(complaint: dict) -> dict:
    complaint = dict(complaint)
    complaint.setdefault("complaint_id", next_complaint_id())
    cid = complaint["complaint_id"]
    log_event = event_logger(cid)
    with db() as c:
        c.execute("INSERT OR REPLACE INTO complaints VALUES(?,?,?,?,?)",
                  (cid, now_iso(), json.dumps(complaint), None, None))
    log_event("orchestrator", "complaint_received", {"structured_complaint": complaint})
    client = A2AClient(on_wire=wire_logger(log_event))
    try:
        final = await graph.ainvoke({"complaint": complaint, "_client": client, "_log": log_event})
    finally:
        await client.aclose()
    unified = final["unified"]
    subtasks = [{"department": r["department"], "agent_name": r["agent_name"],
                 "agent_url": r["agent_url"], "issue_type": r["issue_type"],
                 "task_id": (r.get("task") or {}).get("id"), "state": r.get("state"),
                 "error": r.get("error"), "reason": r.get("reason")}
                for r in final.get("results", [])]
    with db() as c:
        c.execute("UPDATE complaints SET unified=?, subtasks=? WHERE complaint_id=?",
                  (json.dumps(unified), json.dumps(subtasks), cid))
    return unified


TICKET_FIELDS = ("ticket_id", "issue_name", "department_name", "priority", "ticket_status",
                 "assigned_office", "crew", "eta", "duplicate_of", "resolved_at", "auto_close_at",
                 "awaiting_citizen")


async def ticket_from_department(agent_url: str, ticket_id: str | None) -> dict | None:
    """Fallback when the department no longer knows the A2A task (e.g. a task created before
    tasks were saved to disk): read the ticket itself from the department's ticket API."""
    if not ticket_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as h:
            r = await h.get(agent_url.rstrip("/") + f"/tickets/{ticket_id}",
                            headers={"X-Service-Token": config.SERVICE_TOKEN})
        r.raise_for_status()
        t = r.json()
        return {k: t.get(k) for k in TICKET_FIELDS}
    except Exception:
        return None


async def refresh_status(complaint_id: str) -> dict:
    with db() as c:
        row = c.execute("SELECT * FROM complaints WHERE complaint_id=?", (complaint_id,)).fetchone()
    if not row or not row["subtasks"]:
        raise KeyError(complaint_id)
    complaint = json.loads(row["structured"])
    subtasks = json.loads(row["subtasks"])
    old = json.loads(row["unified"])
    log_event = event_logger(complaint_id)
    client = A2AClient(on_wire=wire_logger(log_event))
    results = []
    try:
        for s in subtasks:
            r = {**s, "task": {"id": s["task_id"]}}
            if s.get("task_id") and s.get("state") == "completed":
                try:
                    task = await client.get_task(s["agent_url"], s["task_id"])
                    r["result"] = get_data(task["artifacts"][0]) if task["artifacts"] else {}
                except Exception as e:
                    # task unknown to the agent: read the ticket directly, or (agent offline)
                    # fall back to the last known state
                    prev = next((d for d in old["departments"] if d["a2a_task_id"] == s["task_id"]), {})
                    live = await ticket_from_department(s["agent_url"], prev.get("ticket_id"))
                    r["result"] = live or {k: prev.get(k) for k in TICKET_FIELDS}
                    log_event(s["agent_name"], "status_refresh_failed",
                              {"error": str(e), "fallback": "ticket API" if live else "last known"})
            results.append(r)
    finally:
        await client.aclose()
    unified = build_unified(complaint, results, old.get("unroutable_issues", []))
    with db() as c:
        c.execute("UPDATE complaints SET unified=? WHERE complaint_id=?",
                  (json.dumps(unified), complaint_id))
    log_event("orchestrator", "status_refreshed", {"overall_status": unified["overall_status"]})
    return unified


async def transfer(data: dict) -> dict:
    """An officer says a ticket belongs to another department: register a new ticket with
    that department's agent over A2A (message/send, then tasks/get until done), add it to the
    complaint, and return the refreshed unified status. The old ticket is marked TRANSFERRED
    by its own department afterwards (the Concierge asks it to)."""
    cid, to = data["complaint_id"], data["to_department"]
    with db() as c:
        row = c.execute("SELECT * FROM complaints WHERE complaint_id=?", (cid,)).fetchone()
    if not row or not row["subtasks"]:
        raise KeyError(cid)
    complaint, subtasks = json.loads(row["structured"]), json.loads(row["subtasks"])
    old = json.loads(row["unified"])
    prev = next((d for d in old["departments"] if d.get("ticket_id") == data["from_ticket_id"]), None)
    if not prev:
        raise ValueError(f"Ticket {data['from_ticket_id']} is not part of complaint {cid}")
    log_event = event_logger(cid)
    client = A2AClient(on_wire=wire_logger(log_event))
    try:
        agent = next((a for a in await discover_agents(client)
                      if not a.get("_offline") and agent_key(a) == to), None)
        if not agent:
            raise ValueError(f"No {to} department agent is online")
        skills = [s["id"] for s in agent.get("skills", [])]
        issue_type = data.get("issue_type") if data.get("issue_type") in skills else skills[0]
        agent_url = agent.get("url") or agent["_base"] + "/"
        note = data.get("note") or ""
        description = (f"Transferred from {prev.get('department_name') or prev['department']} "
                       f"({prev['ticket_id']}): {note}. Original report: {complaint.get('summary', '')}")
        depts = sorted({s["department"] for s in subtasks if not s.get("transferred_to")} - {prev["department"]} | {to})
        log_event("orchestrator", "transfer_requested", {"from": prev["ticket_id"], "to": to,
                                                         "issue_type": issue_type, "note": note})
        msg = make_message(
            [text_part(description),
             data_part({"complaint_id": cid, "issue_type": issue_type, "description": description,
                        "location": complaint.get("location"), "landmark": complaint.get("landmark"),
                        "geo": complaint.get("geo"), "urgency": complaint.get("urgency", "normal"),
                        "related_departments": [d for d in depts if d != to]})],
            context_id=cid)
        task = await client.send_message(agent_url, msg)
        task = await client.wait_for_task(agent_url, task)
        if task["status"]["state"] != "completed":
            reason = (task["status"].get("message") or {}).get("parts", [{}])[0].get("text")
            raise RuntimeError(reason or f"The {to} agent did not accept the ticket")
    finally:
        await client.aclose()
    for s in subtasks:
        if s.get("task_id") == prev.get("a2a_task_id"):
            s["transferred_to"] = to
    subtasks.append({"department": to, "agent_name": agent["name"], "agent_url": agent_url,
                     "issue_type": issue_type, "task_id": task["id"], "state": "completed",
                     "error": None, "reason": None})
    with db() as c:
        c.execute("UPDATE complaints SET subtasks=? WHERE complaint_id=?", (json.dumps(subtasks), cid))
    new_ticket = (get_data(task["artifacts"][0]) if task.get("artifacts") else {}).get("ticket_id")
    log_event("orchestrator", "transferred", {"from": prev["ticket_id"], "to": to, "new_ticket": new_ticket})
    unified = await refresh_status(cid)
    unified["new_ticket_id"] = new_ticket
    return unified


# ------------------------------ A2A interface ------------------------------
async def handle(task: dict, store: TaskStore):
    data = get_data(task["history"][-1])
    store.set_state(task["id"], "working", "Orchestrator is coordinating department agents")
    if data.get("action") == "status":
        try:
            unified = await refresh_status(data["complaint_id"])
        except KeyError:
            store.set_state(task["id"], "failed", f"Unknown complaint id {data.get('complaint_id')}")
            return
    elif data.get("action") == "transfer":
        try:
            unified = await transfer(data)
        except KeyError:
            store.set_state(task["id"], "failed", f"Unknown complaint id {data.get('complaint_id')}")
            return
        except Exception as e:  # e.g. target agent offline or it rejected the issue type
            store.set_state(task["id"], "failed", str(e))
            return
    else:
        unified = await resolve(data.get("complaint", data))
    store.add_artifact(task["id"], make_artifact("unified_status", unified,
                                                 "Consolidated multi-department status"))
    store.set_state(task["id"], "completed", f"Unified status for {unified['complaint_id']}")


card = AgentCard(
    name="Orchestrator Agent",
    description="Decomposes structured citizen complaints into department sub-tasks, "
                "dispatches them to department agents over A2A, tracks task states and "
                "returns one unified status artifact.",
    url=config.ORCHESTRATOR_URL + "/",
    provider=AgentProvider(organization="Citizen Grievance Coordination Cell (simulated)"),
    skills=[
        AgentSkill(id="resolve_complaint", name="Resolve complaint",
                   description="Input DataPart: {summary, location, urgency, issues:[{issue_type, "
                               "department, description}]}. Output: unified_status artifact.",
                   tags=["orchestration", "routing"]),
        AgentSkill(id="complaint_status", name="Complaint status",
                   description="Input DataPart: {action:'status', complaint_id}. Output: "
                               "refreshed unified_status artifact.", tags=["status"]),
        AgentSkill(id="transfer_ticket", name="Transfer ticket",
                   description="Input DataPart: {action:'transfer', complaint_id, from_ticket_id, "
                               "to_department, issue_type?, note}. Registers a ticket with the other "
                               "department over A2A. Output: refreshed unified_status artifact.",
                   tags=["routing", "transfer"]),
    ],
)
mount_a2a(app, card, handle)


# ------------------------------ REST (UI / admin) ------------------------------
@app.get("/agents")
async def agents():
    client = A2AClient()
    try:
        cards = await discover_agents(client)
    finally:
        await client.aclose()
    return [{"key": agent_key(c), **{k: v for k, v in c.items()}} for c in cards]


@app.get("/complaints")
def complaints():
    with db() as c:
        rows = c.execute("SELECT complaint_id, created_at, unified FROM complaints "
                         "ORDER BY created_at DESC").fetchall()
    return [{"complaint_id": r["complaint_id"], "created_at": r["created_at"],
             **({k: json.loads(r["unified"]).get(k) for k in
                 ("summary", "location", "overall_status", "composite")} if r["unified"] else {})}
            for r in rows]


@app.get("/complaints/{cid}")
def complaint(cid: str):
    with db() as c:
        r = c.execute("SELECT * FROM complaints WHERE complaint_id=?", (cid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return {"structured": json.loads(r["structured"]),
            "unified": json.loads(r["unified"]) if r["unified"] else None}


@app.get("/complaints/{cid}/trail")
def trail(cid: str):
    with db() as c:
        rows = c.execute("SELECT ts, actor, event, detail FROM events WHERE complaint_id=? "
                         "ORDER BY id", (cid,)).fetchall()
    return [{"ts": r["ts"], "actor": r["actor"], "event": r["event"],
             "detail": json.loads(r["detail"])} for r in rows]


@app.get("/heatmap")
def heatmap():
    """Complaint density per locality for the map view. Built from this agent's own
    audit DB (last known ticket status), so it needs no extra calls to departments."""
    with db() as c:
        rows = c.execute("SELECT structured, unified FROM complaints WHERE unified IS NOT NULL").fetchall()
    points, unmapped = {}, 0
    for r in rows:
        u, geo = json.loads(r["unified"]), json.loads(r["structured"]).get("geo") or {}
        loc = normalise_locality(u.get("location"))
        if loc in LOCALITY_COORDS:
            lat, lng = LOCALITY_COORDS[loc]
        elif geo.get("lat") is not None:  # any place geocoded by Nominatim
            loc, lat, lng = u.get("location") or geo.get("name"), geo["lat"], geo["lng"]
        else:
            unmapped += 1
            continue
        p = points.setdefault(loc, {"locality": loc, "lat": lat, "lng": lng,
                                    "complaints": 0, "tickets": []})
        p["complaints"] += 1
        p["tickets"] += [{"department": d["department"], "priority": d.get("priority"),
                          "status": d.get("ticket_status")}
                         for d in u.get("departments", []) if d.get("ticket_id")]
    return {"points": sorted(points.values(), key=lambda p: -p["complaints"]),
            "unmapped": unmapped}


@app.get("/health")
def health():
    return {"ok": True}

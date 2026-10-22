"""
Generic Municipal Infrastructure (domain) Agent.

Each department (Water / Electricity / Roads) is a separate process built from
this factory with its own DomainSpec, its own SQLite database and its own
Agent Card. They share NO state with each other or with the orchestrator.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from common import config
from common.a2a import (AgentCard, AgentProvider, AgentSkill, TaskStore, get_data,
                        make_artifact, mount_a2a)
from common.localities import LOCALITIES, nearest_locality, normalise_locality

log = logging.getLogger("domain")

TICKET_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]
PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


@dataclass
class IssueType:
    id: str
    name: str
    description: str
    priority: str          # base priority
    sla_hours: int         # target resolution time
    tags: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)


@dataclass
class DomainSpec:
    key: str               # "water"
    name: str              # "Water Board Agent"
    organisation: str      # "Delhi Jal Board (simulated)"
    ticket_prefix: str     # "DJB"
    asset_type: str        # "Water main"
    issues: list[IssueType]
    rules: list[str] = field(default_factory=list)  # human readable business rules


class TicketUpdate(BaseModel):
    status: str
    note: str | None = None


def build_domain_app(spec: DomainSpec) -> FastAPI:
    app = FastAPI(title=spec.name)
    db_path = config.DB_DIR / f"{spec.key}.db"
    issues = {i.id: i for i in spec.issues}

    # ---------------- simulated department database ----------------
    def db():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db():
        with db() as c:
            c.executescript("""
            CREATE TABLE IF NOT EXISTS assets(
                asset_id TEXT PRIMARY KEY, locality TEXT, asset_type TEXT,
                zone_office TEXT, crew TEXT);
            CREATE TABLE IF NOT EXISTS tickets(
                ticket_id TEXT PRIMARY KEY, issue_type TEXT, locality TEXT,
                description TEXT, priority TEXT, status TEXT, asset_id TEXT,
                zone_office TEXT, crew TEXT, created_at TEXT, eta TEXT,
                complaint_ref TEXT, related TEXT, duplicate_of TEXT, notes TEXT);
            """)
            if c.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0:
                rnd = random.Random(spec.key)  # deterministic seed per department
                for i, (loc, district) in enumerate(LOCALITIES.items()):
                    c.execute("INSERT INTO assets VALUES(?,?,?,?,?)", (
                        f"{spec.ticket_prefix}-AST-{i + 1:03d}", loc, spec.asset_type,
                        f"{spec.ticket_prefix} {district} Zone Office",
                        f"Crew {rnd.choice('ABCDEFGH')}{rnd.randint(1, 9)}"))

    init_db()

    def ticket_row_to_result(row: sqlite3.Row, duplicate: bool = False) -> dict:
        it = issues.get(row["issue_type"])
        return {
            "department": spec.key,
            "department_name": spec.organisation,
            "ticket_id": row["ticket_id"],
            "issue_type": row["issue_type"],
            "issue_name": it.name if it else row["issue_type"],
            "locality": row["locality"],
            "priority": row["priority"],
            "ticket_status": row["status"],
            "assigned_office": row["zone_office"],
            "crew": row["crew"],
            "asset_id": row["asset_id"],
            "created_at": row["created_at"],
            "eta": row["eta"],
            "sla_hours": it.sla_hours if it else None,
            "duplicate_of": row["duplicate_of"],
            "is_duplicate": duplicate,
            "notes": row["notes"],
        }

    # ---------------- business rules ----------------
    def compute_priority(it: IssueType, urgency: str) -> str:
        idx = PRIORITY_ORDER.index(it.priority)
        if urgency == "high":   # bump one level, but only safety issues become CRITICAL
            idx = max(idx, min(idx + 1, PRIORITY_ORDER.index("HIGH")))
        if urgency == "critical":
            idx = len(PRIORITY_ORDER) - 1
        return PRIORITY_ORDER[idx]

    def process_subtask(sub: dict) -> dict:
        issue_type = sub.get("issue_type")
        it = issues[issue_type]
        locality = normalise_locality(sub.get("location"))
        zone, geo = locality, sub.get("geo") or {}
        notes = []
        if not locality and geo.get("lat") is not None:
            # a place outside our asset register: serve it from the nearest zone office
            locality = sub.get("location") or geo.get("name")
            zone, dist = nearest_locality(geo["lat"], geo["lng"])
            notes.append(f"Served by nearest zone: {zone} ({dist:.1f} km)")
        locality = locality or "Unknown"
        now = datetime.now(timezone.utc)
        with db() as c:
            asset = c.execute("SELECT * FROM assets WHERE locality=?", (zone,)).fetchone()
            office = asset["zone_office"] if asset else f"{spec.ticket_prefix} Central Control Room"
            crew = asset["crew"] if asset else "Unassigned (location to be verified)"
            asset_id = asset["asset_id"] if asset else None

            # Rule: an OPEN/ASSIGNED/IN_PROGRESS ticket for the same issue in the same
            # locality within 24h is treated as a duplicate and linked, not re-created.
            since = (now - timedelta(hours=24)).isoformat()
            existing = c.execute(
                "SELECT * FROM tickets WHERE issue_type=? AND locality=? AND locality!='Unknown' "
                "AND status IN ('OPEN','ASSIGNED','IN_PROGRESS') AND created_at>=? "
                "AND duplicate_of IS NULL ORDER BY created_at LIMIT 1",
                (issue_type, locality, since)).fetchone()

            n = c.execute("SELECT COUNT(*) FROM tickets").fetchone()[0] + 1
            ticket_id = f"{spec.ticket_prefix}-{now:%y%m%d}-{n:04d}"
            priority = compute_priority(it, sub.get("urgency", "normal"))
            eta = (now + timedelta(hours=it.sla_hours)).isoformat()
            if sub.get("related_departments"):
                notes.append("Coordinate with: " + ", ".join(sub["related_departments"]))
            if existing:
                notes.append(f"Linked to existing ticket {existing['ticket_id']}")
            status = "ASSIGNED" if asset else "OPEN"
            c.execute("INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                ticket_id, issue_type, locality, sub.get("description", ""), priority,
                existing["status"] if existing else status, asset_id, office, crew,
                now.isoformat(), existing["eta"] if existing else eta,
                sub.get("complaint_id"), json.dumps(sub.get("related_departments", [])),
                existing["ticket_id"] if existing else None, "; ".join(notes)))
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            return ticket_row_to_result(row, duplicate=bool(existing))

    # ---------------- A2A task handler ----------------
    async def handle(task: dict, store: TaskStore):
        store.set_state(task["id"], "working", f"{spec.name} is registering the ticket")
        await asyncio.sleep(config.DEPT_DELAY * random.uniform(0.6, 1.4))  # simulate dept system
        sub = get_data(task["history"][-1])
        if sub.get("issue_type") not in issues:
            store.set_state(task["id"], "rejected",
                            f"{spec.name} does not handle issue type '{sub.get('issue_type')}'")
            return
        result = process_subtask(sub)
        store.add_artifact(task["id"], make_artifact(
            "ticket", result, f"{spec.organisation} ticket"))
        log.info("[%s] ctx=%s ticket %s created", spec.key, task["contextId"], result["ticket_id"])
        store.set_state(task["id"], "completed",
                        f"Ticket {result['ticket_id']} registered, ETA {result['eta'][:16]}")

    async def refresh(task: dict, store: TaskStore):
        """On tasks/get, refresh the ticket artifact with live status from the DB."""
        for art in task["artifacts"]:
            for part in art["parts"]:
                tid = part.get("data", {}).get("ticket_id")
                if tid:
                    with db() as c:
                        row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (tid,)).fetchone()
                    if row:
                        part["data"] = ticket_row_to_result(row, part["data"].get("is_duplicate"))

    card = AgentCard(
        name=spec.name,
        description=f"Autonomous agent for {spec.organisation}. Receives department "
                    f"sub-tasks, registers tickets in the department system and returns "
                    f"ticket id, priority, assigned crew and estimated resolution time.",
        url=config.url(spec.key) + "/",
        provider=AgentProvider(organization=spec.organisation),
        skills=[AgentSkill(id=i.id, name=i.name, description=i.description,
                           tags=[spec.key] + i.tags, examples=i.examples) for i in spec.issues],
    )
    mount_a2a(app, card, handle, refresh=refresh)

    # ---------------- operator REST API + console ----------------
    @app.get("/tickets")
    def list_tickets():
        with db() as c:
            rows = c.execute("SELECT * FROM tickets ORDER BY created_at DESC").fetchall()
        return [ticket_row_to_result(r, bool(r["duplicate_of"])) for r in rows]

    @app.patch("/tickets/{ticket_id}")
    def update_ticket(ticket_id: str, upd: TicketUpdate):
        if upd.status not in TICKET_STATUSES:
            raise HTTPException(400, f"status must be one of {TICKET_STATUSES}")
        with db() as c:
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if not row:
                raise HTTPException(404, "ticket not found")
            # Keep duplicates in sync with their parent ticket.
            c.execute("UPDATE tickets SET status=?, notes=COALESCE(?, notes) "
                      "WHERE ticket_id=? OR duplicate_of=?",
                      (upd.status, upd.note, ticket_id, ticket_id))
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
        return ticket_row_to_result(row)

    @app.get("/rules")
    def rules():
        return {"department": spec.organisation, "rules": spec.rules,
                "issue_types": [{"id": i.id, "priority": i.priority, "sla_hours": i.sla_hours}
                                for i in spec.issues]}

    @app.get("/console", response_class=HTMLResponse)
    def console():
        return CONSOLE_HTML.replace("{{NAME}}", spec.organisation).replace(
            "{{STATUSES}}", json.dumps(TICKET_STATUSES))

    @app.get("/health")
    def health():
        return {"ok": True, "agent": spec.name}

    return app


CONSOLE_HTML = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{NAME}} console</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#f6f7f9;color:#1d2330}
table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:14px}
th{background:#eef1f5}select{padding:4px}.dup{color:#888}</style></head><body>
<h2>{{NAME}} &mdash; operator console</h2>
<p>Tickets received from the Orchestrator over A2A. Change a status to simulate field work;
the citizen's unified status updates automatically.</p>
<table><thead><tr><th>Ticket</th><th>Issue</th><th>Locality</th><th>Priority</th><th>Crew</th><th>ETA</th><th>Status</th></tr></thead>
<tbody id="t"></tbody></table>
<script>
const S={{STATUSES}};
async function load(){const r=await fetch('tickets');const d=await r.json();
document.getElementById('t').innerHTML=d.map(x=>`<tr class="${x.duplicate_of?'dup':''}"><td>${x.ticket_id}${x.duplicate_of?'<br><small>dup of '+x.duplicate_of+'</small>':''}</td><td>${x.issue_name}</td><td>${x.locality}</td><td>${x.priority}</td><td>${x.crew}</td><td>${(x.eta||'').slice(0,16).replace('T',' ')}</td>
<td>${x.duplicate_of?x.ticket_status:`<select onchange="upd('${x.ticket_id}',this.value)">${S.map(s=>`<option ${s==x.ticket_status?'selected':''}>${s}</option>`).join('')}</select>`}</td></tr>`).join('')||'<tr><td colspan=7>No tickets yet</td></tr>';}
async function upd(id,s){await fetch('tickets/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})});load();}
load();setInterval(load,4000);
</script></body></html>"""

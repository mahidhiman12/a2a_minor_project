"""
Generic Municipal Infrastructure (domain) Agent.

Each department (Water / Electricity / Roads) is a separate process built from
this factory with its own DomainSpec, its own SQLite database and its own
Agent Card. They share NO state with each other or with the orchestrator.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import random
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from common import config
from common.a2a import (AgentCard, AgentProvider, AgentSkill, TaskStore, get_data,
                        make_artifact, mount_a2a)
from common.localities import LOCALITIES, nearest_locality, normalise_locality

log = logging.getLogger("domain")

# REJECTED: not this department's job / not a valid complaint (reason required).
# TRANSFERRED: handed to another department, which registered its own ticket.
TICKET_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "REJECTED", "TRANSFERRED"]
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
    status: str | None = None   # None = add a note without changing the status
    note: str | None = None
    actor: str | None = None    # display name of the officer, sent by the Concierge
    question: bool = False      # the note is a question the citizen is asked to answer
    crew: str | None = None     # reassign
    priority: str | None = None
    eta: str | None = None      # new expected fix time (ISO 8601); needs a note


class TransferIn(BaseModel):
    to_department: str
    to_ticket_id: str | None = None   # the ticket the other department registered
    note: str
    actor: str | None = None


DONE_STATUSES = ("RESOLVED", "CLOSED")
# No more work happens on these; only notes can be added.
FINAL_STATUSES = ("CLOSED", "REJECTED", "TRANSFERRED")

# The statuses an officer may move a ticket to. An officer never sets CLOSED: a ticket closes
# when the citizen confirms the fix, or by itself AUTO_CLOSE_DAYS after it was resolved.
# TRANSFERRED is set by the transfer endpoint, once the other department has a ticket.
OFFICER_NEXT = {
    "OPEN": ["ASSIGNED", "IN_PROGRESS", "RESOLVED", "REJECTED"],
    "ASSIGNED": ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"],
    "IN_PROGRESS": ["ASSIGNED", "RESOLVED", "REJECTED"],
    "RESOLVED": ["IN_PROGRESS"],  # the fix didn't hold: take it back
    "CLOSED": [], "REJECTED": [], "TRANSFERRED": [],
}
NOTE_REQUIRED = {"RESOLVED": "Add a note saying what was done. The citizen sees it.",
                 "REJECTED": "Say why this ticket is rejected. The citizen sees it."}


class CitizenFeedback(BaseModel):
    action: str                 # "confirm" (it's fixed), "reopen" (it isn't), "reply" (answer a question)
    note: str | None = None     # required to reopen or reply


def require_service_token(x_service_token: str | None = Header(None)):
    """Ticket REST endpoints are for the Concierge only (it sends the shared token on
    behalf of a logged-in officer). A2A endpoints never use this."""
    if not x_service_token or not hmac.compare_digest(x_service_token, config.SERVICE_TOKEN):
        raise HTTPException(401, "X-Service-Token header missing or invalid")


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
            -- what happened to each ticket: registered, status changes, officer notes,
            -- other reports linked to it. The citizen sees these on their complaint.
            CREATE TABLE IF NOT EXISTS ticket_events(
                id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT, ts TEXT,
                kind TEXT, status TEXT, note TEXT, actor TEXT);
            CREATE INDEX IF NOT EXISTS ticket_events_ticket ON ticket_events(ticket_id);
            """)
            # migration: last status change time (for "resolved today" on the dashboard)
            if "updated_at" not in [r[1] for r in c.execute("PRAGMA table_info(tickets)")]:
                c.execute("ALTER TABLE tickets ADD COLUMN updated_at TEXT")
            # migration: when the department marked it fixed (SLA met/missed, auto-close clock)
            if "resolved_at" not in [r[1] for r in c.execute("PRAGMA table_info(tickets)")]:
                c.execute("ALTER TABLE tickets ADD COLUMN resolved_at TEXT")
                c.execute("UPDATE tickets SET resolved_at=COALESCE(updated_at, created_at) "
                          "WHERE status IN ('RESOLVED','CLOSED')")
            # migration: an officer asked the citizen something and is waiting for the answer
            if "awaiting_citizen" not in [r[1] for r in c.execute("PRAGMA table_info(tickets)")]:
                c.execute("ALTER TABLE tickets ADD COLUMN awaiting_citizen INTEGER DEFAULT 0")
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
            "resolved_at": row["resolved_at"],
            # while RESOLVED: when it closes by itself unless the citizen reopens it
            "auto_close_at": (datetime.fromisoformat(row["resolved_at"])
                              + timedelta(days=config.AUTO_CLOSE_DAYS)).isoformat()
            if row["status"] == "RESOLVED" and row["resolved_at"] else None,
            "awaiting_citizen": bool(row["awaiting_citizen"]),
        }

    def sla_of(row: sqlite3.Row) -> dict:
        """on_track / due_soon / overdue while open; met / missed once fixed."""
        if not row["eta"] or row["status"] in ("REJECTED", "TRANSFERRED"):
            return {"state": None, "due_at": None, "hours_left": None}
        due = datetime.fromisoformat(row["eta"])
        if row["status"] in DONE_STATUSES:
            done = row["resolved_at"] or row["updated_at"] or row["created_at"]
            return {"state": "met" if datetime.fromisoformat(done) <= due else "missed",
                    "due_at": row["eta"], "hours_left": None}
        left = (due - datetime.now(timezone.utc)).total_seconds() / 3600
        it = issues.get(row["issue_type"])
        soon = max(2.0, 0.25 * (it.sla_hours if it else 24))  # last quarter of the SLA, at least 2h
        return {"state": "overdue" if left < 0 else "due_soon" if left <= soon else "on_track",
                "due_at": row["eta"], "hours_left": round(left, 1)}

    def auto_close(c):
        """Close RESOLVED tickets the citizen neither confirmed nor reopened in time.
        Runs whenever tickets are read, so no scheduler is needed."""
        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(days=config.AUTO_CLOSE_DAYS)).isoformat()
        for r in c.execute("SELECT ticket_id FROM tickets WHERE status='RESOLVED' "
                           "AND resolved_at IS NOT NULL AND resolved_at<=?", (cutoff,)).fetchall():
            c.execute("UPDATE tickets SET status='CLOSED', updated_at=? WHERE ticket_id=?",
                      (now.isoformat(), r["ticket_id"]))
            add_event(c, r["ticket_id"], "auto_closed", "CLOSED",
                      f"Closed automatically: no reply from the citizen within "
                      f"{config.AUTO_CLOSE_DAYS:g} days of the fix", "system", now)

    # ---------------- ticket history ----------------
    def add_event(c, ticket_id: str, kind: str, status: str | None, note: str | None,
                  actor: str | None, at: datetime | None = None):
        c.execute("INSERT INTO ticket_events(ticket_id, ts, kind, status, note, actor) "
                  "VALUES(?,?,?,?,?,?)", (ticket_id, (at or datetime.now(timezone.utc)).isoformat(),
                                          kind, status, note, actor))

    def events_of(c, row: sqlite3.Row) -> list[dict]:
        """Oldest first. Tickets created before the history table existed get a synthetic
        'created' entry so every history starts with the registration."""
        ev = [{"ts": e["ts"], "kind": e["kind"], "status": e["status"], "note": e["note"],
               "actor": e["actor"]}
              for e in c.execute("SELECT * FROM ticket_events WHERE ticket_id=? ORDER BY ts, id",
                                 (row["ticket_id"],))]
        if not any(e["kind"] == "created" for e in ev):
            ev.insert(0, {"ts": row["created_at"], "kind": "created", "status": None,
                          "note": row["notes"] or None, "actor": "system"})
        return ev

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
            c.execute(
                "INSERT INTO tickets(ticket_id, issue_type, locality, description, priority, "
                "status, asset_id, zone_office, crew, created_at, eta, complaint_ref, related, "
                "duplicate_of, notes, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    ticket_id, issue_type, locality, sub.get("description", ""), priority,
                    existing["status"] if existing else status, asset_id, office, crew,
                    now.isoformat(), existing["eta"] if existing else eta,
                    sub.get("complaint_id"), json.dumps(sub.get("related_departments", [])),
                    existing["ticket_id"] if existing else None, "; ".join(notes),
                    now.isoformat()))
            add_event(c, ticket_id, "created", existing["status"] if existing else status,
                      "; ".join(notes) or None, "system", now)
            if existing:
                add_event(c, existing["ticket_id"], "linked", None,
                          f"Another report of the same problem was linked: {ticket_id}", "system", now)
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
        with db() as c:
            auto_close(c)
            for art in task["artifacts"]:
                for part in art["parts"]:
                    tid = part.get("data", {}).get("ticket_id")
                    if tid:
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
    mount_a2a(app, card, handle, refresh=refresh, store_path=db_path)  # tasks survive restarts

    # ---------------- operator REST API (service token) ----------------
    # Extra fields for the dashboard only; the A2A ticket artifact is unchanged.
    def dashboard_row(r: sqlite3.Row) -> dict:
        return {**ticket_row_to_result(r, bool(r["duplicate_of"])),
                "description": r["description"], "complaint_ref": r["complaint_ref"],
                "related_departments": json.loads(r["related"] or "[]"),
                "updated_at": r["updated_at"] or r["created_at"],
                "sla": sla_of(r), "allowed_next": OFFICER_NEXT.get(r["status"], [])}

    @app.get("/tickets", dependencies=[Depends(require_service_token)])
    def list_tickets():
        with db() as c:
            auto_close(c)
            rows = c.execute("SELECT * FROM tickets ORDER BY created_at DESC").fetchall()
        return [dashboard_row(r) for r in rows]

    @app.get("/tickets/{ticket_id}", dependencies=[Depends(require_service_token)])
    def get_ticket(ticket_id: str):
        """One ticket with its full history and the reports linked to it."""
        with db() as c:
            auto_close(c)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if not row:
                raise HTTPException(404, "ticket not found")
            dups = c.execute("SELECT ticket_id, locality, created_at, complaint_ref FROM tickets "
                             "WHERE duplicate_of=? ORDER BY created_at", (ticket_id,)).fetchall()
            return {**dashboard_row(row), "events": events_of(c, row),
                    "duplicates": [dict(d) for d in dups]}

    @app.get("/tickets/{ticket_id}/events", dependencies=[Depends(require_service_token)])
    def ticket_events(ticket_id: str):
        with db() as c:
            auto_close(c)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if not row:
                raise HTTPException(404, "ticket not found")
            return events_of(c, row)

    IST = timezone(timedelta(hours=5, minutes=30))  # times in notes are for people in Delhi

    def fmt_time(iso: str | None) -> str:
        return datetime.fromisoformat(iso).astimezone(IST).strftime("%d %b, %I:%M %p IST") if iso else "not set"

    @app.patch("/tickets/{ticket_id}", dependencies=[Depends(require_service_token)])
    def update_ticket(ticket_id: str, upd: TicketUpdate):
        """Status change, note or question for the citizen, and/or new crew, priority or
        expected fix time. Every change is recorded in the ticket's history."""
        note = (upd.note or "").strip() or None
        if upd.status is not None and upd.status not in TICKET_STATUSES:
            raise HTTPException(400, f"status must be one of {TICKET_STATUSES}")
        if upd.priority is not None and upd.priority not in PRIORITY_ORDER:
            raise HTTPException(400, f"priority must be one of {PRIORITY_ORDER}")
        if upd.question and not note:
            raise HTTPException(400, "Write the question for the citizen")
        eta = None
        if upd.eta:
            try:
                eta = datetime.fromisoformat(upd.eta.replace("Z", "+00:00"))
                eta = (eta if eta.tzinfo else eta.replace(tzinfo=IST)).astimezone(timezone.utc)
            except ValueError:
                raise HTTPException(400, "eta must be a date and time (ISO 8601)") from None
        with db() as c:
            auto_close(c)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if not row:
                raise HTTPException(404, "ticket not found")
            changed = upd.status is not None and upd.status != row["status"]
            crew = (upd.crew or "").strip() or None
            edits = []  # (column, new value, readable change)
            if crew and crew != row["crew"]:
                edits.append(("crew", crew, f"Crew: {row['crew'] or 'none'} → {crew}"))
            if upd.priority and upd.priority != row["priority"]:
                edits.append(("priority", upd.priority, f"Priority: {row['priority']} → {upd.priority}"))
            if eta and eta.isoformat() != row["eta"]:
                edits.append(("eta", eta.isoformat(), f"Expected fix: {fmt_time(row['eta'])} → {fmt_time(eta.isoformat())}"))
            if edits and row["status"] in FINAL_STATUSES:
                raise HTTPException(400, f"A {row['status']} ticket can't be changed any more")
            if any(col == "eta" for col, _, _ in edits) and not note:
                raise HTTPException(400, "Say why the expected fix time is changing. The citizen sees it.")
            if changed and upd.status == "CLOSED":
                raise HTTPException(400, "Tickets close when the citizen confirms the fix, or on "
                                         f"their own {config.AUTO_CLOSE_DAYS:g} days after being resolved")
            if changed and upd.status == "TRANSFERRED":
                raise HTTPException(400, "Use the transfer action to send a ticket to another department")
            if changed and upd.status not in OFFICER_NEXT.get(row["status"], []):
                raise HTTPException(400, f"A {row['status']} ticket can't be set to {upd.status}")
            if changed and upd.status in NOTE_REQUIRED and not note:
                raise HTTPException(400, NOTE_REQUIRED[upd.status])
            if not changed and not note and not edits:
                raise HTTPException(400, f"The ticket is already {row['status']}" if upd.status
                                    else "Send a new status, a note, a question or a change")
            now = datetime.now(timezone.utc)
            # Duplicates follow their parent ticket, and their citizens see the same update.
            # A linked report that is already finished (e.g. its citizen confirmed) stays as it is.
            ids = [ticket_id] + [r["ticket_id"] for r in c.execute(
                "SELECT ticket_id FROM tickets WHERE duplicate_of=? AND status NOT IN (?,?,?)",
                (ticket_id, *FINAL_STATUSES))]
            for tid in ids:
                if edits:
                    for col, val, _ in edits:
                        c.execute(f"UPDATE tickets SET {col}=? WHERE ticket_id=?", (val, tid))  # col is ours
                    add_event(c, tid, "edited", None, "; ".join(t for _, _, t in edits)
                              + (f". {note}" if note and not changed and not upd.question else ""),
                              upd.actor, now)
                if changed:  # updated_at = last status change; resolved_at = when it was fixed
                    c.execute("UPDATE tickets SET status=?, updated_at=?, resolved_at=?, "
                              "awaiting_citizen=CASE WHEN ? THEN 0 ELSE awaiting_citizen END "
                              "WHERE ticket_id=?",
                              (upd.status, now.isoformat(),
                               now.isoformat() if upd.status == "RESOLVED" else None,
                               upd.status in FINAL_STATUSES, tid))
                    add_event(c, tid, "status", upd.status, None if upd.question else note, upd.actor, now)
                if upd.question:
                    c.execute("UPDATE tickets SET awaiting_citizen=1 WHERE ticket_id=?", (tid,))
                    add_event(c, tid, "question", None, note, upd.actor, now)
                elif note and not changed and not edits:
                    add_event(c, tid, "note", None, note, upd.actor, now)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
        return dashboard_row(row)

    @app.post("/tickets/{ticket_id}/transfer", dependencies=[Depends(require_service_token)])
    def transfer_ticket(ticket_id: str, body: TransferIn):
        """Mark a ticket as handed over. Called by the Concierge after the Orchestrator has
        registered the replacement ticket with the other department over A2A."""
        note = body.note.strip()
        if not note:
            raise HTTPException(400, "Say why it belongs to the other department")
        if body.to_department == spec.key:
            raise HTTPException(400, "Pick another department")
        with db() as c:
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if not row:
                raise HTTPException(404, "ticket not found")
            problem = transfer_problem(c, row)
            if problem:
                raise HTTPException(400, problem)
            now = datetime.now(timezone.utc)
            c.execute("UPDATE tickets SET status='TRANSFERRED', updated_at=?, awaiting_citizen=0 "
                      "WHERE ticket_id=?", (now.isoformat(), ticket_id))
            where = body.to_department + (f" as {body.to_ticket_id}" if body.to_ticket_id else "")
            add_event(c, ticket_id, "transferred", "TRANSFERRED", f"Sent to {where}: {note}", body.actor, now)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
        return dashboard_row(row)

    def transfer_problem(c, row) -> str | None:
        """Why this ticket can't be transferred, or None."""
        if row["status"] in FINAL_STATUSES:
            return f"A {row['status']} ticket can't be transferred"
        if row["duplicate_of"]:
            return f"This report is linked to {row['duplicate_of']}. Transfer that ticket instead."
        if c.execute("SELECT COUNT(*) FROM tickets WHERE duplicate_of=? AND status NOT IN (?,?,?)",
                     (row["ticket_id"], *FINAL_STATUSES)).fetchone()[0]:
            return "Other reports are linked to this ticket, so it can't be transferred. Reject it with a reason instead."
        if not row["complaint_ref"]:
            return "Only tickets from a citizen complaint can be transferred"
        return None

    @app.post("/tickets/{ticket_id}/citizen", dependencies=[Depends(require_service_token)])
    def citizen_feedback(ticket_id: str, fb: CitizenFeedback):
        """The citizen answers 'Is it fixed?' for a RESOLVED ticket (confirm closes it, reopen
        sends it back to the crew with the citizen's reason), or answers an officer's question."""
        note = (fb.note or "").strip() or None
        if fb.action not in ("confirm", "reopen", "reply"):
            raise HTTPException(400, "action must be 'confirm', 'reopen' or 'reply'")
        if fb.action == "reopen" and not note:
            raise HTTPException(400, "Tell the department what is still wrong")
        if fb.action == "reply" and not note:
            raise HTTPException(400, "Write your answer")
        with db() as c:
            auto_close(c)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if not row:
                raise HTTPException(404, "ticket not found")
            if fb.action == "reply":
                if not row["awaiting_citizen"]:
                    raise HTTPException(409, "The department hasn't asked you anything")
                now = datetime.now(timezone.utc)
                c.execute("UPDATE tickets SET awaiting_citizen=0 WHERE ticket_id=?", (ticket_id,))
                add_event(c, ticket_id, "citizen_reply", None, note, "citizen", now)
                if row["duplicate_of"]:  # the officer works on the original ticket: tell them there
                    c.execute("UPDATE tickets SET awaiting_citizen=0 WHERE ticket_id=?", (row["duplicate_of"],))
                    add_event(c, row["duplicate_of"], "citizen_reply", None,
                              f"From the citizen of linked report {ticket_id}: {note}", "citizen", now)
                return dashboard_row(c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone())
            if row["status"] == "CLOSED":
                raise HTTPException(409, "This ticket is already closed. If the problem is back, "
                                         "please file a new complaint.")
            if row["status"] != "RESOLVED":
                raise HTTPException(409, "The department hasn't marked this as fixed yet")
            now = datetime.now(timezone.utc)
            if fb.action == "confirm":
                c.execute("UPDATE tickets SET status='CLOSED', updated_at=? WHERE ticket_id=?",
                          (now.isoformat(), ticket_id))
                add_event(c, ticket_id, "confirmed", "CLOSED", note, "citizen", now)
            else:
                # Not fixed for one citizen means not fixed: reopen the original ticket and
                # every linked report that is still waiting for confirmation.
                root = row["duplicate_of"] or ticket_id
                group = c.execute("SELECT * FROM tickets WHERE (ticket_id=? OR duplicate_of=?) "
                                  "AND status='RESOLVED'", (root, root)).fetchall()
                for r in group:
                    back = "ASSIGNED" if r["asset_id"] else "OPEN"
                    c.execute("UPDATE tickets SET status=?, updated_at=?, resolved_at=NULL "
                              "WHERE ticket_id=?", (back, now.isoformat(), r["ticket_id"]))
                    add_event(c, r["ticket_id"], "reopened", back,
                              note if r["ticket_id"] == ticket_id
                              else f"Reopened after another report of the same problem: {note}",
                              "citizen", now)
            row = c.execute("SELECT * FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
        return dashboard_row(row)

    @app.get("/stats", dependencies=[Depends(require_service_token)])
    def stats():
        """Department performance for the admin: workload, speed, deadlines, how often fixes
        were reopened, and what each officer did. Linked duplicate reports count once."""
        with db() as c:
            auto_close(c)
            rows = c.execute("SELECT * FROM tickets WHERE duplicate_of IS NULL").fetchall()
            ids = {r["ticket_id"] for r in rows}
            events = [e for e in c.execute("SELECT * FROM ticket_events ORDER BY ts, id").fetchall()
                      if e["ticket_id"] in ids]
        by_status = {s: 0 for s in TICKET_STATUSES}
        for r in rows:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        slas = [sla_of(r)["state"] for r in rows]
        fixed = [r for r in rows if r["status"] in ("RESOLVED", "CLOSED") and r["resolved_at"]]
        hours = [(datetime.fromisoformat(r["resolved_at"]) - datetime.fromisoformat(r["created_at"]))
                 .total_seconds() / 3600 for r in fixed]
        ever_resolved = {e["ticket_id"] for e in events if e["kind"] == "status" and e["status"] == "RESOLVED"}
        reopened = {e["ticket_id"] for e in events if e["kind"] == "reopened"}
        met, missed = slas.count("met"), slas.count("missed")
        officers: dict[str, dict] = {}
        for e in events:
            if e["actor"] in (None, "system", "citizen"):
                continue
            o = officers.setdefault(e["actor"], {"name": e["actor"], "updates": 0, "resolved": 0,
                                                 "rejected": 0, "transferred": 0, "questions": 0,
                                                 "last_active": None})
            o["updates"] += 1
            o["resolved"] += e["kind"] == "status" and e["status"] == "RESOLVED"
            o["rejected"] += e["kind"] == "status" and e["status"] == "REJECTED"
            o["transferred"] += e["kind"] == "transferred"
            o["questions"] += e["kind"] == "question"
            o["last_active"] = e["ts"]
        return {
            "department": spec.key, "name": spec.organisation, "tickets": len(rows),
            "by_status": by_status,
            "open": sum(by_status[s] for s in ("OPEN", "ASSIGNED", "IN_PROGRESS")),
            "overdue": slas.count("overdue"), "due_soon": slas.count("due_soon"),
            "fixed": len(fixed), "on_time_pct": round(100 * met / (met + missed)) if met + missed else None,
            "avg_fix_hours": round(sum(hours) / len(hours), 1) if hours else None,
            "reopened": len(reopened),
            "reopen_pct": round(100 * len(reopened & ever_resolved) / len(ever_resolved)) if ever_resolved else None,
            "confirmed": sum(e["kind"] == "confirmed" for e in events),
            "auto_closed": sum(e["kind"] == "auto_closed" for e in events),
            "awaiting_citizen": sum(bool(r["awaiting_citizen"]) for r in rows),
            "officers": sorted(officers.values(), key=lambda o: -o["updates"]),
        }

    @app.get("/rules")
    def rules():
        return {"department": spec.organisation, "rules": spec.rules,
                "issue_types": [{"id": i.id, "priority": i.priority, "sla_hours": i.sla_hours}
                                for i in spec.issues]}

    @app.get("/console")
    def console():
        """The operator console moved to the Concierge (login + role check)."""
        return RedirectResponse(f"{config.CONCIERGE_URL}/dept/{spec.key}", status_code=307)

    @app.get("/health")
    def health():
        return {"ok": True, "agent": spec.name}

    return app


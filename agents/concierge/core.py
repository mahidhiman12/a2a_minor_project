"""
Citizen Concierge (host agent) logic - shared by the FastAPI web app and the
Google ADK version (adk_host/agent.py).

Responsibilities
  1. understand the citizen's plain-language message (NLU)
  2. ask follow-up questions if the location or problem is missing
  3. send the structured complaint to the Orchestrator over A2A
  4. turn the unified status artifact back into plain language
"""
from __future__ import annotations

import logging
import re
import time

from agents.concierge.nlu import extract_location, understand
from common import config
from common.a2a import A2AClient, data_part, get_data, make_message, text_part
from common.geocode import GeocoderUnavailable, geocode

log = logging.getLogger("concierge")

COMPLAINT_ID_RX = re.compile(r"\bCMP-\d{8}-\d{4}\b", re.I)
DEPT_WORDS = {
    "water": r"water|paani|pani|\bnal\b|tap|sewer|drain",
    "electricity": r"electric|bijli|power|current|light|wire",
    "roads": r"road|sadak|street|footpath|lane",
    "sanitation": r"garbage|kachra|kooda|trash|waste|dustbin",
}
STATUS_TEXT = {"REGISTERED": "registered and assigned", "IN_PROGRESS": "in progress",
               "RESOLVED": "resolved", "NOT_ROUTED": "not routed"}

_catalog_cache: tuple[float, list[dict]] = (0, [])


async def skill_catalog() -> list[dict]:
    """Skills of all department agents, discovered through the Orchestrator's registry
    (which reads each agent's Agent Card). Used to tell the NLU what is possible."""
    global _catalog_cache
    if time.time() - _catalog_cache[0] < 30 and _catalog_cache[1]:
        return _catalog_cache[1]
    import httpx
    async with httpx.AsyncClient(timeout=10) as h:
        agents = (await h.get(config.ORCHESTRATOR_URL + "/agents")).json()
    cat = [{**s, "_dept": a["key"]} for a in agents if not a.get("_offline")
           for s in a.get("skills", [])]
    _catalog_cache = (time.time(), cat)
    return cat


async def call_orchestrator(payload: dict) -> dict:
    """A2A: message/send to the Orchestrator, then poll tasks/get until done."""
    client = A2AClient(timeout=60)
    try:
        card = await client.get_card(config.ORCHESTRATOR_URL)
        msg = make_message([text_part(payload.get("summary") or payload.get("action", "")),
                            data_part(payload)])
        task = await client.send_message(card["url"], msg)
        task = await client.wait_for_task(card["url"], task, timeout=60)
        if task["status"]["state"] != "completed":
            reason = (task["status"].get("message") or {}).get("parts", [{}])[0].get("text", "")
            raise RuntimeError(reason or task["status"]["state"])
        return get_data(task["artifacts"][0])
    finally:
        await client.aclose()


def _fmt_time(iso: str | None) -> str:
    if not iso:
        return "-"
    from datetime import datetime
    try:
        dt = datetime.fromisoformat(iso).astimezone()
        return dt.strftime("%d %b, %I:%M %p")
    except Exception:
        return iso[:16]


def render_status(u: dict, new: bool = True) -> str:
    lines = []
    if new:
        n = len({d["department"] for d in u["departments"]})
        t = len(u["departments"])
        lines.append(f"Your complaint **{u['complaint_id']}** has been registered"
                     + (f" with **{n} departments**" if n > 1 else "")
                     + (f" ({t} tickets)" if t > n or (t > 1 and n == 1) else "") + ".")
    else:
        lines.append(f"Status of **{u['complaint_id']}**: "
                     f"**{STATUS_TEXT.get(u['overall_status'], u['overall_status'])}**.")
    for d in u["departments"]:
        if d["a2a_task_state"] == "completed":
            dup = f" (linked to existing ticket {d['duplicate_of']})" if d.get("duplicate_of") else ""
            lines.append(f"- **{d['department_name']}** - {d['issue_name']}: ticket "
                         f"`{d['ticket_id']}`{dup}, priority {d['priority']}, "
                         f"{d['ticket_status'].replace('_', ' ').lower()}, {d['crew']}, "
                         f"expected by {_fmt_time(d['eta'])}")
        else:
            lines.append(f"- {d['agent']}: could not register ({d.get('error') or d['a2a_task_state']})")
    for i in u.get("unroutable_issues", []):
        lines.append(f"- No department agent is available for '{i['issue_type']}' right now.")
    if u.get("coordination_plan") and new:
        lines.append("\nHow the departments will coordinate:")
        lines += [f"  {p}" for p in u["coordination_plan"]]
    if new:
        lines.append(f"\nOverall expected resolution: **{_fmt_time(u.get('overall_eta'))}**. "
                     f"Ask me \"status {u['complaint_id']}\" any time for a single, combined update.")
    return "\n".join(lines)


def _clean_place(text: str) -> str | None:
    """'in rajouri garden please' -> 'Rajouri Garden' (a short free-text answer)."""
    t = re.sub(r"^\s*(it'?s|it is|this is|area is|locality is|in|at|near)\s+", "", text, flags=re.I)
    t = re.sub(r"\s+(me|mein|mai|main|hai|please|pls)\s*$", "", t.strip(" .,!?"), flags=re.I)
    return t.title() if t and len(t.split()) <= 6 else None


class Session:
    def __init__(self):
        self.pending: dict | None = None   # complaint waiting for more info
        self.last_complaint: str | None = None


async def handle_message(text: str, session: Session, mode: str | None = None) -> dict:
    """Returns {"reply": str, "structured": dict|None, "unified": dict|None, "state": str}"""
    text = text.strip()

    # ---- status queries ----
    m = COMPLAINT_ID_RX.search(text)
    if m or (re.search(r"\b(status|update|track)\b", text, re.I) and session.last_complaint
             and not session.pending):
        cid = m.group(0).upper() if m else session.last_complaint
        try:
            u = await call_orchestrator({"action": "status", "complaint_id": cid})
        except Exception as e:
            return {"reply": f"I couldn't find complaint {cid}. ({e})", "state": "failed"}
        session.last_complaint = cid
        return {"reply": render_status(u, new=False), "unified": u, "state": "status"}

    # ---- follow-up answer to a pending question ----
    if session.pending:
        p = session.pending
        combined = p["text"] + ". " + text
    else:
        combined = text

    catalog = await skill_catalog()
    s = await understand(combined, catalog, mode)

    # The citizen is answering "which locality?": their answer IS the location, even if
    # it is a place the NLU has never seen ("rajouri garden"). Geocoding checks it below.
    if session.pending and session.pending.get("need") == "location":
        s["location"] = extract_location(text)[0] or _clean_place(text) or s["location"]

    if not s["issues"]:
        depts = [d for d, rx in DEPT_WORDS.items() if re.search(rx, combined, re.I)]
        session.pending = {"text": combined}
        if depts:
            opts = [sk["name"] for sk in catalog if sk["_dept"] in depts]
            return {"reply": "Could you tell me a little more about the problem? For example: "
                             + ", ".join(opts) + ".", "structured": s, "state": "input-required"}
        if re.fullmatch(r"(hi|hello|hey|namaste|help)\W*", text, re.I):
            session.pending = None
            return {"reply": "Namaste! Tell me about any water, electricity or road problem in "
                             "your area (in English or Hinglish), and include the locality. "
                             "I'll register it with every department involved.", "state": "idle"}
        return {"reply": "I couldn't identify a civic problem. Please describe what is wrong "
                         "(e.g. 'pipe burst', 'no electricity', 'pothole') and where.",
                "structured": s, "state": "input-required"}

    if not s["location"]:
        session.pending = {"text": combined, "need": "location"}
        names = ", ".join(sorted({i["issue_type"].replace("_", " ") for i in s["issues"]}))
        return {"reply": f"Got it - {names}. Which locality / area is this in? "
                         f"(e.g. Laxmi Nagar, Rajouri Garden, Dwarka Sector 10)", "structured": s,
                "state": "input-required"}

    # ---- geocode any place name (OpenStreetMap Nominatim, free) ----
    try:
        geo = await geocode(s["location"])
    except GeocoderUnavailable as e:  # offline: keep the name, departments use a control room
        log.warning("geocoding unavailable, continuing without coordinates: %s", e)
        geo = None
    else:
        if geo is None and not (session.pending or {}).get("geo_retry"):
            session.pending = {"text": combined, "need": "location", "geo_retry": True}
            return {"reply": f"I couldn't find \"{s['location']}\" in Delhi. Could you give the "
                             "area name or a nearby landmark (e.g. 'Rajouri Garden metro')?",
                    "structured": s, "state": "input-required"}
    if geo:
        s["location"], s["geo"] = geo["name"], geo

    session.pending = None
    s["citizen_text"] = combined
    unified = await call_orchestrator(s)
    session.last_complaint = unified["complaint_id"]
    return {"reply": render_status(unified), "structured": s, "unified": unified,
            "state": "completed"}

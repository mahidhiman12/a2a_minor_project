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

import re
import time

from agents.concierge.nlu import understand
from common import config
from common.a2a import A2AClient, data_part, get_data, make_message, text_part

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
        session.pending = {"text": combined}
        names = ", ".join(sorted({i["issue_type"].replace("_", " ") for i in s["issues"]}))
        return {"reply": f"Got it - {names}. Which locality / area is this in? "
                         f"(e.g. Laxmi Nagar, Shastri Park, Dwarka)", "structured": s,
                "state": "input-required"}

    session.pending = None
    s["citizen_text"] = combined
    unified = await call_orchestrator(s)
    session.last_complaint = unified["complaint_id"]
    return {"reply": render_status(unified), "structured": s, "unified": unified,
            "state": "completed"}

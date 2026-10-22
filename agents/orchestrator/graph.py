"""
Orchestrator workflow, built as a LangGraph state machine.

    discover ──► decompose ──► dispatch ──► track ──► aggregate ──► END
       │             │            │           │           │
  read Agent    split into    A2A          poll        merge results
  Cards         sub-tasks     message/send tasks/get   into unified
                by skill                               status artifact

No LLM is needed here: routing is done by matching each issue to the agent
whose Agent Card advertises a skill with that id (capability-based routing).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, TypedDict

from langgraph.graph import END, StateGraph

from common import config
from common.a2a import A2AClient, data_part, get_data, make_message, now_iso, text_part

PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

# --------------------------------------------------------------------------
# Agent registry (Agent Card discovery with a short cache)
# --------------------------------------------------------------------------
_card_cache: dict[str, tuple[float, dict]] = {}
CARD_TTL = 30


async def discover_agents(client: A2AClient, urls: list[str] | None = None) -> list[dict]:
    agents = []
    for base in urls or config.DOMAIN_AGENT_URLS:
        cached = _card_cache.get(base)
        if cached and time.time() - cached[0] < CARD_TTL:
            agents.append(cached[1])
            continue
        try:
            card = await client.get_card(base)
            card["_base"] = base
            _card_cache[base] = (time.time(), card)
            agents.append(card)
        except Exception as e:  # agent offline -> just not available for routing
            agents.append({"name": base, "_base": base, "_offline": str(e), "skills": []})
    return agents


def agent_key(card: dict) -> str:
    """Department key = first tag shared by all skills (e.g. 'water')."""
    skills = card.get("skills") or []
    if skills:
        common_tags = set(skills[0].get("tags", []))
        for s in skills[1:]:
            common_tags &= set(s.get("tags", []))
        if common_tags:
            return sorted(common_tags)[0]
    return card.get("name", "unknown")


# --------------------------------------------------------------------------
# Graph state
# --------------------------------------------------------------------------
class OrchState(TypedDict, total=False):
    complaint: dict
    agents: list[dict]
    subtasks: list[dict]
    unroutable: list[dict]
    results: list[dict]
    unified: dict
    # runtime helpers (not persisted)
    _client: Any
    _log: Callable[[str, str, dict], None]


def build_graph():
    async def discover(state: OrchState) -> OrchState:
        agents = await discover_agents(state["_client"])
        state["_log"]("orchestrator", "agents_discovered", {
            "agents": [{"name": a.get("name"), "url": a.get("url", a["_base"]),
                        "skills": [s["id"] for s in a.get("skills", [])],
                        "offline": a.get("_offline")} for a in agents]})
        return {"agents": agents}

    async def decompose(state: OrchState) -> OrchState:
        c = state["complaint"]
        skill_index = {}
        for a in state["agents"]:
            for s in a.get("skills", []):
                skill_index[s["id"]] = a
        subtasks, unroutable = [], []
        for issue in c.get("issues", []):
            agent = skill_index.get(issue["issue_type"])
            if not agent:
                # fallback: route by department hint using agent card tags
                hint = issue.get("department")
                agent = next((a for a in state["agents"] if hint and agent_key(a) == hint
                              and not a.get("_offline")), None)
                if agent:
                    # pick that agent's first skill as a generic fallback
                    issue = {**issue, "issue_type": agent["skills"][0]["id"], "rerouted": True}
            if not agent:
                unroutable.append(issue)
                continue
            subtasks.append({
                "department": agent_key(agent),
                "agent_name": agent["name"],
                "agent_url": agent.get("url") or agent["_base"] + "/",
                "issue_type": issue["issue_type"],
                "description": issue.get("description") or c.get("summary", ""),
            })
        depts = sorted({s["department"] for s in subtasks})
        for s in subtasks:
            s["related_departments"] = [d for d in depts if d != s["department"]]
        state["_log"]("orchestrator", "decomposed", {
            "subtasks": [{k: s[k] for k in ("department", "issue_type", "agent_name")}
                         for s in subtasks],
            "unroutable": unroutable,
            "composite": len(depts) > 1})
        return {"subtasks": subtasks, "unroutable": unroutable}

    async def dispatch(state: OrchState) -> OrchState:
        c, client = state["complaint"], state["_client"]

        async def send(sub):
            msg = make_message(
                [text_part(sub["description"]),
                 data_part({"complaint_id": c["complaint_id"], "issue_type": sub["issue_type"],
                            "description": sub["description"], "location": c.get("location"),
                            "landmark": c.get("landmark"), "geo": c.get("geo"),
                            "urgency": c.get("urgency", "normal"),
                            "related_departments": sub["related_departments"]})],
                context_id=c["complaint_id"])
            try:
                task = await client.send_message(sub["agent_url"], msg)
                state["_log"](sub["agent_name"], "task_" + task["status"]["state"],
                              {"task_id": task["id"], "issue_type": sub["issue_type"]})
                return {**sub, "task": task}
            except Exception as e:
                state["_log"](sub["agent_name"], "dispatch_failed", {"error": str(e)})
                return {**sub, "task": None, "error": str(e)}

        sent = await asyncio.gather(*(send(s) for s in state["subtasks"]))
        return {"subtasks": list(sent)}

    async def track(state: OrchState) -> OrchState:
        client = state["_client"]

        async def wait(sub):
            if not sub.get("task"):
                return {**sub, "state": "failed"}
            try:
                task = await client.wait_for_task(
                    sub["agent_url"], sub["task"],
                    on_state=lambda t: state["_log"](sub["agent_name"],
                                                     "task_" + t["status"]["state"],
                                                     {"task_id": t["id"]}))
            except Exception as e:
                state["_log"](sub["agent_name"], "task_timeout", {"error": str(e)})
                return {**sub, "state": "failed", "error": str(e)}
            result = get_data(task["artifacts"][0]) if task.get("artifacts") else {}
            reason = (task["status"].get("message") or {}).get("parts", [{}])[0].get("text")
            return {**sub, "task": task, "state": task["status"]["state"],
                    "result": result, "reason": reason}

        results = await asyncio.gather(*(wait(s) for s in state["subtasks"]))
        return {"results": list(results)}

    async def aggregate(state: OrchState) -> OrchState:
        unified = build_unified(state["complaint"], state.get("results", []),
                                state.get("unroutable", []))
        state["_log"]("orchestrator", "aggregated", {"overall_status": unified["overall_status"],
                                                     "tickets": [d.get("ticket_id") for d in unified["departments"]]})
        return {"unified": unified}

    g = StateGraph(OrchState)
    for name, fn in [("discover", discover), ("decompose", decompose), ("dispatch", dispatch),
                     ("track", track), ("aggregate", aggregate)]:
        g.add_node(name, fn)
    g.set_entry_point("discover")
    g.add_edge("discover", "decompose")
    g.add_edge("decompose", "dispatch")
    g.add_edge("dispatch", "track")
    g.add_edge("track", "aggregate")
    g.add_edge("aggregate", END)
    return g.compile()


# --------------------------------------------------------------------------
# Unified status artifact
# --------------------------------------------------------------------------
def citizen_status(ticket_statuses: list[str]) -> str:
    if not ticket_statuses:
        return "NOT_ROUTED"
    if all(s in ("RESOLVED", "CLOSED") for s in ticket_statuses):
        return "RESOLVED"
    if any(s in ("IN_PROGRESS", "RESOLVED", "CLOSED") for s in ticket_statuses):
        return "IN_PROGRESS"
    return "REGISTERED"


def coordination_plan(depts: list[dict]) -> list[str]:
    """Simple cross-department sequencing rules for composite complaints."""
    keys = {d["department"] for d in depts}
    plan = []
    if "roads" in keys and keys & {"water", "electricity"}:
        utils = " and ".join(sorted(keys & {"water", "electricity"}))
        plan.append(f"Step 1: {utils} crew(s) repair the damaged utility line.")
        plan.append("Step 2: Roads department restores / resurfaces the road after the "
                    "utility ticket is resolved.")
    elif len(keys) > 1:
        plan.append("Departments work in parallel; orchestrator tracks each ticket.")
    if any(d.get("priority") == "CRITICAL" for d in depts):
        plan.insert(0, "CRITICAL item flagged to the department for immediate response.")
    return plan


def build_unified(complaint: dict, results: list[dict], unroutable: list[dict]) -> dict:
    depts = []
    for r in results:
        res = r.get("result") or {}
        depts.append({
            "department": r["department"], "agent": r["agent_name"], "a2a_task_id":
            (r.get("task") or {}).get("id"), "a2a_task_state": r.get("state"),
            "issue_type": r["issue_type"], "ticket_id": res.get("ticket_id"),
            "issue_name": res.get("issue_name"), "department_name": res.get("department_name"),
            "priority": res.get("priority"), "ticket_status": res.get("ticket_status"),
            "assigned_office": res.get("assigned_office"), "crew": res.get("crew"),
            "eta": res.get("eta"), "duplicate_of": res.get("duplicate_of"),
            "error": r.get("error") or (r.get("reason") if r.get("state") != "completed" else None),
        })
    ok = [d for d in depts if d["a2a_task_state"] == "completed"]
    etas = [d["eta"] for d in ok if d.get("eta")]
    prios = [d["priority"] for d in ok if d.get("priority") in PRIORITY_ORDER]
    return {
        "complaint_id": complaint["complaint_id"],
        "summary": complaint.get("summary"),
        "location": complaint.get("location"),
        "composite": len({d["department"] for d in depts}) > 1,
        "overall_status": citizen_status([d["ticket_status"] for d in ok if d["ticket_status"]]),
        "all_subtasks_completed": bool(depts) and len(ok) == len(depts),
        "highest_priority": max(prios, key=PRIORITY_ORDER.index) if prios else None,
        "overall_eta": max(etas) if etas else None,
        "departments": depts,
        "unroutable_issues": unroutable,
        "coordination_plan": coordination_plan(ok),
        "updated_at": now_iso(),
    }

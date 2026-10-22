"""
Citizen Concierge Agent (HOST)  ->  uvicorn agents.concierge.server:app --port 8000

The only component the citizen sees. Serves the web chat UI at http://127.0.0.1:8000
and is also exposed as an A2A agent (so other systems, e.g. a helpline IVR agent,
could delegate to it).
"""
from __future__ import annotations

import logging
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

from agents.concierge.core import Session, handle_message
from common import config
from common.a2a import (AgentCard, AgentProvider, AgentSkill, TaskStore, get_text,
                        make_artifact, mount_a2a)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
app = FastAPI(title="Citizen Concierge Agent")
STATIC = Path(__file__).parent / "static"
sessions: dict[str, Session] = {}


class ChatIn(BaseModel):
    message: str
    session_id: str = "default"
    mode: str | None = None


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.post("/api/chat")
async def chat(body: ChatIn):
    s = sessions.setdefault(body.session_id, Session())
    try:
        return await handle_message(body.message, s, body.mode)
    except httpx.ConnectError:
        return {"reply": "The Orchestrator agent is not reachable. Is it running on "
                         f"{config.ORCHESTRATOR_URL}?", "state": "failed"}


async def _orch(path: str):
    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(config.ORCHESTRATOR_URL + path)
        return r.json()


@app.get("/api/agents")
async def agents():
    return await _orch("/agents")


@app.get("/api/complaints")
async def complaints():
    return await _orch("/complaints")


@app.get("/api/trail/{cid}")
async def trail(cid: str):
    return await _orch(f"/complaints/{cid}/trail")


@app.get("/api/config")
def cfg():
    return {"nlu_mode": config.NLU_MODE, "ollama_model": config.OLLAMA_MODEL,
            "gemini_model": config.GEMINI_MODEL, "gemini_key_set": bool(config.GEMINI_API_KEY),
            "orchestrator": config.ORCHESTRATOR_URL}


# ---- A2A interface: lets other agents talk to the concierge ----
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

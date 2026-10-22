"""
Minimal, dependency-light implementation of the Agent2Agent (A2A) protocol.

Implements the parts of the A2A spec (v0.3) this project needs:
  * Agent Card discovery at  GET /.well-known/agent-card.json
  * JSON-RPC 2.0 endpoint at POST /   with methods:
        message/send   -> create a Task from a Message
        tasks/get      -> fetch the latest state of a Task
        tasks/cancel   -> cancel a Task
  * Task lifecycle states: submitted -> working -> completed / failed / canceled
  * Messages made of Parts (TextPart, DataPart) and Task Artifacts

We implement the protocol by hand (instead of the official a2a-sdk) so that
every byte on the wire is visible and explainable, and so nothing breaks when
the SDK changes versions. The wire format follows the spec, so these agents can
talk to any other A2A-compliant agent.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

log = logging.getLogger("a2a")

PROTOCOL_VERSION = "0.3.0"
TERMINAL_STATES = {"completed", "failed", "canceled", "rejected"}

# JSON-RPC 2.0 standard error codes + A2A specific ones
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
TASK_NOT_FOUND = -32001
TASK_NOT_CANCELABLE = -32002


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


# --------------------------------------------------------------------------
# Agent Card (capability manifest)
# --------------------------------------------------------------------------
class AgentSkill(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str] = []
    examples: list[str] = []


class AgentCapabilities(BaseModel):
    streaming: bool = False
    pushNotifications: bool = False
    stateTransitionHistory: bool = True


class AgentProvider(BaseModel):
    organization: str
    url: str = ""


class AgentCard(BaseModel):
    protocolVersion: str = PROTOCOL_VERSION
    name: str
    description: str
    url: str
    version: str = "1.0.0"
    preferredTransport: str = "JSONRPC"
    provider: Optional[AgentProvider] = None
    capabilities: AgentCapabilities = Field(default_factory=AgentCapabilities)
    defaultInputModes: list[str] = ["application/json", "text/plain"]
    defaultOutputModes: list[str] = ["application/json", "text/plain"]
    skills: list[AgentSkill] = []


# --------------------------------------------------------------------------
# Message / Task helpers (kept as plain dicts = exactly what goes on the wire)
# --------------------------------------------------------------------------
def text_part(text: str) -> dict:
    return {"kind": "text", "text": text}


def data_part(data: dict) -> dict:
    return {"kind": "data", "data": data}


def make_message(parts: list[dict], role: str = "user", context_id: str | None = None,
                 task_id: str | None = None, metadata: dict | None = None) -> dict:
    msg = {"kind": "message", "messageId": new_id("msg-"), "role": role, "parts": parts}
    if context_id:
        msg["contextId"] = context_id
    if task_id:
        msg["taskId"] = task_id
    if metadata:
        msg["metadata"] = metadata
    return msg


def make_artifact(name: str, data: dict, description: str = "") -> dict:
    return {"artifactId": new_id("art-"), "name": name, "description": description,
            "parts": [data_part(data)]}


def get_data(message_or_artifact: dict) -> dict:
    """Merge all DataParts of a message/artifact into one dict."""
    out: dict = {}
    for p in message_or_artifact.get("parts", []):
        if p.get("kind") == "data":
            out.update(p.get("data", {}))
    return out


def get_text(message_or_artifact: dict) -> str:
    return "\n".join(p.get("text", "") for p in message_or_artifact.get("parts", [])
                     if p.get("kind") == "text")


# --------------------------------------------------------------------------
# Server side: in-memory task store + JSON-RPC router
# --------------------------------------------------------------------------
class TaskStore:
    def __init__(self):
        self.tasks: dict[str, dict] = {}

    def create(self, message: dict) -> dict:
        task_id = new_id("task-")
        task = {
            "kind": "task",
            "id": task_id,
            "contextId": message.get("contextId") or new_id("ctx-"),
            "status": {"state": "submitted", "timestamp": now_iso()},
            "history": [message],
            "artifacts": [],
            "metadata": {"stateHistory": [{"state": "submitted", "timestamp": now_iso()}]},
        }
        self.tasks[task_id] = task
        return task

    def set_state(self, task_id: str, state: str, note: str | None = None) -> dict:
        task = self.tasks[task_id]
        task["status"] = {"state": state, "timestamp": now_iso()}
        if note:
            task["status"]["message"] = make_message([text_part(note)], role="agent",
                                                     context_id=task["contextId"], task_id=task_id)
        task["metadata"]["stateHistory"].append({"state": state, "timestamp": now_iso()})
        return task

    def add_artifact(self, task_id: str, artifact: dict) -> None:
        self.tasks[task_id]["artifacts"].append(artifact)


# A handler receives (task, store) and is responsible for moving the task to a
# terminal state. It runs in the background so message/send returns immediately
# with the task in "submitted"/"working" state, like a real asynchronous agent.
TaskHandler = Callable[[dict, TaskStore], Awaitable[None]]
RefreshHandler = Callable[[dict, TaskStore], Awaitable[None]]


def mount_a2a(app: FastAPI, card: AgentCard, handler: TaskHandler,
              refresh: RefreshHandler | None = None, blocking_default: bool = False) -> TaskStore:
    """Attach A2A endpoints (agent card + JSON-RPC) to a FastAPI app."""
    store = TaskStore()
    app.state.a2a_store = store

    @app.get("/.well-known/agent-card.json")
    @app.get("/.well-known/agent.json")  # older spec path, kept for compatibility
    async def agent_card():
        return card.model_dump()

    def rpc_error(req_id, code, message, data=None):
        err = {"code": code, "message": message}
        if data is not None:
            err["data"] = data
        return JSONResponse({"jsonrpc": "2.0", "id": req_id, "error": err})

    def rpc_result(req_id, result):
        return JSONResponse({"jsonrpc": "2.0", "id": req_id, "result": result})

    @app.post("/")
    async def jsonrpc(request: Request):
        try:
            body = await request.json()
        except Exception:
            return rpc_error(None, PARSE_ERROR, "Parse error")
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0" or "method" not in body:
            return rpc_error(body.get("id") if isinstance(body, dict) else None,
                             INVALID_REQUEST, "Invalid Request")
        req_id, method, params = body.get("id"), body["method"], body.get("params") or {}

        if method == "message/send":
            message = params.get("message")
            if not message or not message.get("parts"):
                return rpc_error(req_id, INVALID_PARAMS, "params.message with parts is required")
            task = store.create(message)
            log.info("[%s] task %s submitted (ctx=%s)", card.name, task["id"], task["contextId"])
            blocking = (params.get("configuration") or {}).get("blocking", blocking_default)
            job = asyncio.create_task(_run(handler, task, store, card.name))
            if blocking:
                await job
            return rpc_result(req_id, task)

        if method == "tasks/get":
            task = store.tasks.get(params.get("id"))
            if not task:
                return rpc_error(req_id, TASK_NOT_FOUND, "Task not found")
            if refresh and task["status"]["state"] == "completed":
                await refresh(task, store)
            return rpc_result(req_id, task)

        if method == "tasks/cancel":
            task = store.tasks.get(params.get("id"))
            if not task:
                return rpc_error(req_id, TASK_NOT_FOUND, "Task not found")
            if task["status"]["state"] in TERMINAL_STATES:
                return rpc_error(req_id, TASK_NOT_CANCELABLE, "Task already finished")
            return rpc_result(req_id, store.set_state(task["id"], "canceled"))

        return rpc_error(req_id, METHOD_NOT_FOUND, f"Method not found: {method}")

    return store


async def _run(handler: TaskHandler, task: dict, store: TaskStore, agent_name: str):
    try:
        await handler(task, store)
    except Exception as e:  # never leave a task hanging
        log.exception("[%s] task %s failed", agent_name, task["id"])
        store.set_state(task["id"], "failed", f"Internal error: {e}")


# --------------------------------------------------------------------------
# Client side
# --------------------------------------------------------------------------
class A2AClient:
    """Tiny async A2A client: discover agent cards and exchange JSON-RPC messages."""

    def __init__(self, timeout: float = 30.0, on_wire: Callable[[str, str, dict], None] | None = None):
        self.http = httpx.AsyncClient(timeout=timeout)
        self.on_wire = on_wire  # optional hook to record every request/response (tracing)

    async def get_card(self, base_url: str) -> dict:
        r = await self.http.get(base_url.rstrip("/") + "/.well-known/agent-card.json")
        r.raise_for_status()
        return r.json()

    async def call(self, url: str, method: str, params: dict) -> dict:
        payload = {"jsonrpc": "2.0", "id": new_id(), "method": method, "params": params}
        if self.on_wire:
            self.on_wire("request", url, payload)
        r = await self.http.post(url, json=payload)
        r.raise_for_status()
        body = r.json()
        if self.on_wire:
            self.on_wire("response", url, body)
        if "error" in body:
            raise A2AError(body["error"].get("code"), body["error"].get("message"))
        return body["result"]

    async def send_message(self, url: str, message: dict, blocking: bool = False) -> dict:
        return await self.call(url, "message/send",
                               {"message": message, "configuration": {"blocking": blocking}})

    async def get_task(self, url: str, task_id: str) -> dict:
        return await self.call(url, "tasks/get", {"id": task_id})

    async def wait_for_task(self, url: str, task: dict, poll_interval: float = 0.3,
                            timeout: float = 30.0,
                            on_state: Callable[[dict], None] | None = None) -> dict:
        """Poll tasks/get until the task reaches a terminal state."""
        last_state = task["status"]["state"]
        loop = asyncio.get_event_loop()
        deadline = loop.time() + timeout
        while task["status"]["state"] not in TERMINAL_STATES:
            if loop.time() > deadline:
                raise TimeoutError(f"Task {task['id']} did not finish in {timeout}s")
            await asyncio.sleep(poll_interval)
            task = await self.get_task(url, task["id"])
            if task["status"]["state"] != last_state:
                last_state = task["status"]["state"]
                if on_state:
                    on_state(task)
        return task

    async def aclose(self):
        await self.http.aclose()


class A2AError(Exception):
    def __init__(self, code, message):
        super().__init__(f"A2A error {code}: {message}")
        self.code = code

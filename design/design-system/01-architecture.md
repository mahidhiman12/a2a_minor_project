# 1. Project architecture analysis

Source: the A2A grievance project repository (≈3,400 lines; Python 3.10+). Read in full: `common/`, `agents/`, `adk_host/`, `run_all.py`, `README.md`, tests and data.

## Stack at a glance

| Layer | Today |
|---|---|
| Frontend | One hand-written file, `agents/concierge/static/index.html` (260 lines): vanilla JS, inline CSS, no build step, no framework. Leaflet 1.9.4 + leaflet.heat loaded lazily from unpkg for the heatmap. |
| Department operator consoles | Inline HTML template string inside `agents/domain/base.py`, served at `/console` on each department port. |
| Backend | FastAPI + Uvicorn. **Six independent processes**, each with its own port and SQLite DB, launched by `run_all.py`. |
| Agent framework | LangGraph state machine in the Orchestrator; optional Google ADK `LlmAgent` host in `adk_host/`. |
| Protocol | A2A v0.3.0 implemented by hand in `common/a2a.py`: Agent Card at `/.well-known/agent-card.json`, JSON-RPC 2.0 `message/send`, `tasks/get`, `tasks/cancel`, in-memory `TaskStore`. |
| NLU | `agents/concierge/nlu.py`: weighted regex lexicon (English + Hinglish) by default; Ollama or Gemini optional, with automatic fallback to rules. |
| Geo | OpenStreetMap Nominatim (`common/geocode.py`, cached in SQLite, 1 req/s) + 20 built-in Delhi localities (`common/localities.py`). |
| Auth | **None.** Sessions are a random `session_id` generated in the browser and kept in server memory. |
| Routing | None client-side; four tabs toggled with CSS classes. Server routes are listed below. |

## Process topology

```
Browser ──HTTP──► Citizen Concierge :8000  (UI + REST proxy + A2A agent)
                        │  A2A JSON-RPC (message/send, tasks/get)
                        ▼
                  Orchestrator :8001  (LangGraph, SQLite audit trail, REST for UI)
                        │  reads Agent Cards, A2A JSON-RPC in parallel
        ┌───────────────┼───────────────┬───────────────┐
   Water :8101    Electricity :8102  Roads :8103   Sanitation :8104 (opt-in)
   DJB, SQLite    ELC, SQLite        MCD, SQLite   SAN, SQLite
```

The browser only ever talks to the Concierge on :8000, which proxies read endpoints to the Orchestrator. Department consoles are separate pages on their own ports.

## API surface

**Concierge :8000** (the only origin the citizen UI calls)

| Method | Path | Returns |
|---|---|---|
| GET | `/` | the single-page UI |
| POST | `/api/chat` | `{reply, structured, unified, state}` — `state` ∈ `idle`, `input-required`, `completed`, `status`, `failed` |
| GET | `/api/agents` | discovered Agent Cards (+ `_base`, `_offline`) |
| GET | `/api/complaints` | list: `complaint_id, created_at, summary, location, overall_status, composite` |
| GET | `/api/trail/{cid}` | ordered audit events `{ts, actor, event, detail}` |
| GET | `/api/heatmap` | `{points:[{locality, lat, lng, complaints, tickets[]}], unmapped}` |
| GET | `/api/config` | NLU mode, model names, orchestrator URL |
| GET/POST | `/.well-known/agent-card.json`, `/` | A2A interface (skills `file_complaint`, `check_status`) |

**Orchestrator :8001**: `/agents`, `/complaints`, `/complaints/{cid}`, `/complaints/{cid}/trail`, `/heatmap`, `/health`, `/docs` (Swagger), plus A2A (skills `resolve_complaint`, `complaint_status`).

**Each department :810x**: `GET /tickets`, `PATCH /tickets/{id}` (`{status}`), `GET /rules`, `GET /console`, `GET /health`, plus A2A.

## Data model

| Store | Table | Key fields |
|---|---|---|
| `orchestrator.db` | `complaints` | `complaint_id`, `created_at`, `structured` (JSON), `unified` (JSON), `subtasks` (JSON) |
| | `events` | `complaint_id`, `ts`, `actor`, `event`, `detail` (JSON) — the audit trail |
| `<dept>.db` | `assets` | `asset_id`, `locality`, `asset_type`, `zone_office`, `crew` |
| | `tickets` | `ticket_id`, `issue_type`, `locality`, `description`, `priority`, `status`, `asset_id`, `zone_office`, `crew`, `created_at`, `eta`, `complaint_ref`, `related`, `duplicate_of`, `notes` |
| `geocode.db` | cache | place → lat/lng |
| memory | A2A `TaskStore`, Concierge `sessions` | lost on restart |

**The unified status artifact** (what most screens render): `complaint_id, summary, location, composite, overall_status (REGISTERED | IN_PROGRESS | RESOLVED | NOT_ROUTED), all_subtasks_completed, highest_priority, overall_eta, departments[], unroutable_issues[], coordination_plan[], updated_at`. Each department entry carries `department, agent, a2a_task_id, a2a_task_state, issue_type, issue_name, ticket_id, priority, ticket_status, assigned_office, crew, eta, duplicate_of, error`.

## State vocabularies the UI must design for

| Vocabulary | Values |
|---|---|
| Complaint (citizen-facing) | REGISTERED · IN_PROGRESS · RESOLVED · NOT_ROUTED |
| Ticket (department) | OPEN · ASSIGNED · IN_PROGRESS · RESOLVED · CLOSED |
| A2A task | submitted · working · input-required · completed · failed · canceled · rejected |
| Priority | LOW · MEDIUM · HIGH · CRITICAL |
| Conversation | idle · input-required · completed · status · failed |
| Orchestrator graph step | discover → decompose → dispatch → track → aggregate |

## Observations that shape the redesign

- The backend already returns rich, well-shaped JSON; the redesign is mostly a **frontend** job. No new backend logic is needed for the first release.
- There is **no push**: the UI polls. Live views should poll `trail` every 1–2s while a complaint is resolving and stop when `all_subtasks_completed`.
- The trail is the best storytelling asset in the project — it should become the centrepiece "execution timeline", not a hidden tab.
- Operator consoles live on other ports; the new app should fold them into one Operator area that calls each department's `/tickets` through a Concierge proxy (one small backend addition, flagged in the frontend plan).
- No auth exists; the sitemap marks which routes would need it later, without inventing a login flow the backend can't support yet.

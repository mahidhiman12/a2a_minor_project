# 2. Existing feature inventory

Every feature the current code implements, where it lives, and how it appears in the UI today.

| # | Feature | Where in code | Current UI | Redesign home |
|---|---|---|---|---|
| 1 | **Chat-based complaint intake** in English/Hinglish | `concierge/core.py`, `nlu.py`, `POST /api/chat` | Left chat card with bubbles | Citizen › File a complaint (guided chat + live summary) |
| 2 | **Sample complaint chips** (5 demo prompts) | `index.html` `SAMPLES` | Chips above composer | Prompt suggestions in the composer; landing "Try it" |
| 3 | **Clarifying questions** (missing locality, unknown place, landmark) | `core.py` `input-required` states | Plain bot message | Concierge question card with quick-reply chips |
| 4 | **Multi-department decomposition** (composite complaints) | `orchestrator/graph.py` decompose | "Composite complaint" text | "2 departments involved" split view with per-dept tickets |
| 5 | **Urgency detection** (urgent/critical words → priority bump) | `nlu.py`, `base.py compute_priority` | `urgency:` meta text | Priority tag on each ticket; "Flagged critical" banner |
| 6 | **Ticket creation per department** with office, crew, asset, ETA | `domain/base.py process_subtask` | Rows in "Unified status" | Ticket cards inside Complaint detail |
| 7 | **Duplicate detection** (same issue + locality → linked) | `base.py` `duplicate_of` | Mentioned in reply text | "Linked to existing ticket" notice with link |
| 8 | **Coordination plan** (utilities first, then roads) | `graph.py coordination_plan` | Muted lines under status | Step plan component on Complaint detail |
| 9 | **Unified status** across departments | `graph.py build_unified` | Card in trail tab | Status hero on Complaint detail + Track page |
| 10 | **Status check by ID** (`status CMP-…`) | `core.py`, orchestrator `complaint_status` | Typed into chat | Dedicated Track page with ID input; still works in chat |
| 11 | **Live A2A trail** (every JSON-RPC request/response, task states, timings) | orchestrator `events`, `/trail/{cid}` | List with `details` → raw JSON | Execution timeline + JSON-RPC inspector drawer |
| 12 | **Agent flow diagram** (Concierge → Orchestrator → departments, lit/done/idle) | `index.html loadTrail` | 3-column static grid | Workflow graph with animated edges and node states |
| 13 | **Agent Card discovery** (name, URL, protocol, transport, skills, offline flag) | `graph.discover_agents`, `/api/agents` | "Agent Cards" tab | Agents directory + Agent detail with raw card viewer |
| 14 | **All complaints list** | `/api/complaints` | Simple table | Complaints table with filters, search, status/priority columns |
| 15 | **Complaint heatmap** (by department, unresolved only, priority-weighted) + top hotspots | `/api/heatmap`, Leaflet | "Heatmap" tab | Insights › Map with side hotspot list |
| 16 | **Geocoding any Delhi place** + nearest zone office | `common/geocode.py`, `localities.py` | Invisible | Location chip with "served by Janakpuri office, 4.6 km" |
| 17 | **NLU engine switcher** (rules / Ollama / Gemini) | `/api/config`, header select | Header dropdown | Settings › AI engine (and a small badge in operator top bar) |
| 18 | **LLM fallback to rules** | `nlu.py` | `NLU: rules` meta | "Answered by rules engine" provenance chip |
| 19 | **Department operator consoles** (list tickets, change status) | `base.py /console`, `PATCH /tickets/{id}` | Separate page per port | Operator › Department queue (one app, department switcher) |
| 20 | **Department rules** (issue types, default priorities, SLAs) | `GET /rules` | Not shown | Agent detail › Skills & rules |
| 21 | **Extensible departments** (Sanitation joins with zero code changes) | `domain/sanitation.py`, `DOMAIN_AGENT_URLS` | Appears in cards | "New agent discovered" toast + directory entry |
| 22 | **A2A server for Concierge/Orchestrator** (callable by other agents) | `mount_a2a` | Not shown | Agent detail for Concierge and Orchestrator |
| 23 | **Google ADK host variant** | `adk_host/` | ADK dev UI (separate) | Docs/About only — out of app scope |
| 24 | **Evaluation metrics** (routing accuracy, F1, baseline) | `evaluate.py` | CLI only | Insights › Evaluation (static report card; optional) |
| 25 | **Health endpoints** | `/health` on all | Not shown | System status strip in operator top bar |

**Not present today** (so not designed as working features): authentication and roles, citizen accounts and "my complaints" history across devices, notifications/push, attachments/photos, multilingual UI chrome, SLA escalation. The sitemap marks these as future.

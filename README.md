# Autonomous Citizen Grievance & Service Resolution System (A2A)

Minor Project · B.Tech IT · ADGIPS (GGSIPU) · 2023–27
Mahi Dhiman, Riya Jha, Khushi Singh, Lotla Yamini · Supervisor: Dr Sanjay Kumar

A citizen types one complaint in plain English or Hinglish, for example *"Road repair work near Laxmi Nagar metro broke the water pipe"*. A team of independent AI agents then works out that **two departments** are involved, files a ticket with each one over the **Agent2Agent (A2A) protocol**, tracks both tickets and gives the citizen **one combined status**.

**No paid API is needed.** By default the system runs fully offline. You can optionally plug in a free LLM: Ollama on your own laptop, or the free tier of Google Gemini.

---

## 1. Architecture

```
                         ┌───────────────────────────┐
   Citizen  ── chat ──►  │ Citizen Concierge (HOST)  │  :8000   web UI + NLU
                         │  agents/concierge/        │  (rules / Ollama / Gemini)
                         └─────────────┬─────────────┘  ADK version: adk_host/
                                       │ A2A  JSON-RPC 2.0  message/send, tasks/get
                         ┌─────────────▼─────────────┐
                         │   Orchestrator Agent      │  :8001   LangGraph state machine
                         │  agents/orchestrator/     │  SQLite audit trail
                         └──┬──────────┬──────────┬──┘
           reads Agent Cards│          │          │ A2A JSON-RPC 2.0
                 ┌──────────▼┐  ┌──────▼─────┐  ┌─▼──────────┐   ┌ ─ ─ ─ ─ ─ ─ ┐
                 │  Water    │  │ Electricity│  │   Roads    │     Sanitation
                 │  :8101    │  │   :8102    │  │   :8103    │   │ :8104 (demo)│
                 │ SQLite DB │  │ SQLite DB  │  │ SQLite DB  │    └ ─ ─ ─ ─ ─ ─ ┘
                 └───────────┘  └────────────┘  └────────────┘
```

Each box is a **separate process with its own port and its own database**, just like real departments. They share no code paths at runtime and no data. They talk only through A2A.

### Orchestrator workflow (LangGraph)

```
discover ──► decompose ──► dispatch ──► track ──► aggregate ──► END
read Agent   split into    message/send poll       merge into one
Cards        sub-tasks     (parallel)   tasks/get  unified status artifact
```

### Mapping the synopsis to the code

The repository is a monorepo: the Python agents are in `backend/`, the website in `frontend/` and the design system in `design/`. Paths in this table are relative to `backend/`.

| Synopsis section | Where it is implemented |
|---|---|
| 4.1 Agent Cards at a well-known endpoint | `common/a2a.py` → `GET /.well-known/agent-card.json` |
| 4.1 JSON-RPC 2.0 messaging | `common/a2a.py` → `POST /` with `message/send`, `tasks/get`, `tasks/cancel` |
| 4.2 Citizen Concierge Agent (NLU, entities) | `agents/concierge/nlu.py`, `core.py`, `server.py` |
| 4.3 Water / Electricity / Roads agents | `agents/domain/water.py`, `electricity.py`, `roads.py` (+ `base.py`) |
| 4.3 Per-agent simulated data store | `data/db/water.db`, `electricity.db`, `roads.db` (SQLite) |
| 4.4 Orchestrator: decomposition, state model | `agents/orchestrator/graph.py` (LangGraph), `server.py` |
| 4.4 Task states submitted → working → completed | `common/a2a.py` `TaskStore`, visible in the UI trail |
| 4.5 Six-step workflow | Followed end-to-end. See the "Live A2A trail" tab |
| 4.6 Validation | `evaluate.py`, `data/complaints_eval.json`, `data/complaints_test.json` |
| 5 Host layer: Google ADK | `adk_host/citizen_concierge/agent.py` |
| 5 Observability / distributed tracing | Every JSON-RPC request and response is logged per complaint (`/complaints/{id}/trail`) |
| 5 Postman / test scripts | `docs/postman_collection.json`, `tests/test_system.py` |
| Expected outcome: extensible without code changes | `agents/domain/sanitation.py` + `python run_all.py --with-sanitation` |

---

## 2. Setup (Windows, macOS or Linux)

You need **Python 3.10 or newer**. Check with `python --version`.

```bash
# 1. go into the backend folder of the project
cd a2a_minor_project/backend

# 2. (recommended) create a virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

# 3. install the dependencies
pip install -r requirements.txt

# 4. (optional) settings
copy .env.example .env          # Windows   (cp on macOS/Linux)
```

The website (`frontend/`) needs Node.js 18+. See `frontend/README.md`; in short: `cd frontend && npm install && npm run build`.

## 3. Run it

From `backend/`:

```bash
python run_all.py --reset
```
Or, from the repo root, double-click `start_windows.bat` (Windows) or run `./start.sh`.

Then open **http://127.0.0.1:8000/login** and sign in with one of the demo accounts in section 4.

| URL | What it shows | Who can open it |
|---|---|---|
| http://127.0.0.1:8000/login | Login page, plus registration for new citizens | everyone |
| http://127.0.0.1:8000/ | Citizen chat, with a live A2A trail, the Agent Cards, **My complaints** and a heatmap | citizens |
| http://127.0.0.1:8000/dept/water | Water department dashboard (also `/dept/electricity`, `/dept/roads`, `/dept/sanitation`, …) | that department's officer, admin |
| http://127.0.0.1:8000/admin | Admin overview of every department and every complaint | admin |
| http://127.0.0.1:8101/.well-known/agent-card.json | A raw A2A Agent Card | everyone (A2A is never behind the login) |
| http://127.0.0.1:8001/docs | Orchestrator API (Swagger UI) | everyone |

The old operator consoles (`http://127.0.0.1:8101/console` and so on) now redirect to the department dashboards.

Press **Ctrl+C** to stop all the agents.

---

## 4. Login & roles

There is one login page at `/login`. Where you land after signing in depends on your role:

| Role | Lands on | Can do |
|---|---|---|
| **citizen** | `/` (chat) | File complaints, see **only their own** complaints with a Registered → In progress → Resolved timeline, see the heatmap |
| **officer** (one department) | `/dept/<department>` | See that department's tickets, filter them by status, priority and locality, and change their status |
| **admin** | `/admin` | See an overview of every department and every complaint, and open any department dashboard |

If you are already logged in, `/login` sends you to your own page. If you are logged out, every page sends you to `/login`. Opening another role's page returns **403** (for example a citizen on `/dept/water`, or the water officer on `/dept/roads`).

### Demo accounts

Accounts are created on startup if they don't already exist. The passwords come from `.env`; the defaults are in `.env.example`.

| Username | Role | Default password (`.env` setting) |
|---|---|---|
| `citizen1` | citizen (Asha Verma) | `citizen123` (`DEMO_CITIZEN_PASSWORD`) |
| `water_officer` | officer · water | `officer123` (`DEMO_OFFICER_PASSWORD`) |
| `electricity_officer` | officer · electricity | `officer123` (`DEMO_OFFICER_PASSWORD`) |
| `roads_officer` | officer · roads | `officer123` (`DEMO_OFFICER_PASSWORD`) |
| `sanitation_officer` | officer · sanitation (only when the Sanitation agent runs) | `officer123` (`DEMO_OFFICER_PASSWORD`) |
| `admin` | admin | `admin123` (`DEMO_ADMIN_PASSWORD`) |

To give a single account its own password, set `DEMO_PASSWORD_<USERNAME>`, for example `DEMO_PASSWORD_WATER_OFFICER=...`. Passwords are read only when an account is first created. To change them later, delete `backend/data/db/users.db` (or run `python run_all.py --reset`). New citizens can register themselves on the login page. Officer and admin accounts cannot self-register.

### Department logins come from the Agent Cards

The Concierge does not have a list of departments. It asks the Orchestrator's `/agents` endpoint, which reads each agent's Agent Card. For every department agent it finds there, the Concierge creates a `<department>_officer` login and serves a dashboard at `/dept/<department>`. Start the system with `--with-sanitation` and `sanitation_officer` and `/dept/sanitation` appear with **zero code changes**. The heatmap's department filter and the admin overview are built the same way.

### How it works

* **Users**: SQLite table `users` in `data/db/users.db` (`id, username, password_hash, role, department, display_name, created_at`). Passwords are hashed with PBKDF2-HMAC-SHA256 (200,000 iterations, 16-byte random salt per user, `hashlib`). Plain text is never stored.
* **Session**: a cookie signed with `itsdangerous` (`SECRET_KEY` from `.env`). It is `HttpOnly`, `SameSite=Lax`, and expires after `SESSION_HOURS` (default 8). The cookie holds only the user id; the role is read from the database on every request.
* **Endpoints**: `GET /login`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/register` (citizens only).
* **Complaint ownership**: the Concierge stores `complaint_owners(complaint_id, user_id)` in its own database. The A2A payload sent to the Orchestrator is unchanged.
* **Department dashboards**: the browser only talks to the Concierge. The Concierge calls the department agent's `GET /tickets` and `PATCH /tickets/{id}` on the server side and adds the `X-Service-Token` header (`SERVICE_TOKEN` in `.env`). Without that header the agents return **401**, so nobody can change a ticket by calling `:8101` directly.
* **Not behind the login**: the A2A endpoints (`/.well-known/agent-card.json` and JSON-RPC `POST /`) on every agent, including the Concierge, and the Orchestrator's REST API. Agent-to-agent traffic and `python evaluate.py` work exactly as before.

### Limitations (demo-grade auth)

This is enough for a demo, not for production. List these as limitations in the report:
* **No HTTPS**: cookies and passwords travel in plain HTTP on localhost. The cookie is not marked `Secure`.
* **No rate limiting or account lockout** on `/api/login`, so passwords can be brute-forced.
* **One shared service token** for all department agents, no rotation. The Orchestrator's REST endpoints and all A2A endpoints are unauthenticated (agents trust anything on the local network).
* No CSRF tokens (`SameSite=Lax` cookies only), no password reset, no email/OTP verification, and no audit log of who changed a ticket beyond the note on the ticket.
* Sessions cannot be revoked before they expire, except by changing `SECRET_KEY`, which logs everyone out.

---

## 5. Choosing the "brain" (all free)

Only the Concierge needs language understanding. Set `NLU_MODE` in `.env`, or switch it live from the dropdown in the top-right corner of the UI.

| Mode | Cost | Setup | Notes |
|---|---|---|---|
| `rules` (default) | Free, offline | nothing | Weighted regex lexicon for English and Hinglish (bijli, paani, gaddha, malba…) |
| `ollama` | Free, offline | Install from https://ollama.com, then run `ollama pull llama3.2` | Runs on your laptop. 8 GB RAM is enough for `llama3.2` (3B) |
| `gemini` | Free tier | Get a key at https://aistudio.google.com/apikey and put `GOOGLE_API_KEY=...` in `.env` | Best accuracy. Free tier is rate-limited, which is fine for a demo |

If the LLM is down or returns bad JSON, the Concierge automatically **falls back to the rules engine**, so a live demo never breaks.

### Google ADK host agent (optional, as named in the synopsis)

`adk_host/citizen_concierge/agent.py` is the same Concierge built as a **Google ADK `LlmAgent`**. Its tools (`list_department_skills`, `register_complaint`, `check_complaint_status`) call the Orchestrator over A2A. ADK needs an LLM that can call tools:

* Gemini free tier: set `GOOGLE_API_KEY` in `.env`, or
* Ollama: set `NLU_MODE=ollama` and `OLLAMA_MODEL=qwen2.5:7b` (or `llama3.1:8b`). Very small models are poor at calling tools.

```bash
python run_all.py            # terminal 1, in backend/: start the agents
cd backend/adk_host          # terminal 2
adk web --port 8080          # ADK dev UI at http://127.0.0.1:8080, choose "citizen_concierge"
```

---

## 6. Demo script for the viva (about 5 minutes)

0. **Login & roles.** Open http://127.0.0.1:8000/login and sign in as `citizen1`. Show the user's name and the *Log out* button in the header. Point out that opening http://127.0.0.1:8000/dept/water as a citizen returns **403**.
1. **Agent discovery.** Open the *Agent Cards* tab. Explain that the Orchestrator knows only three URLs, and that everything else (names, skills, endpoints) was read from each agent's `/.well-known/agent-card.json`.
2. **Composite complaint.** Click the first sample chip: *"Road repair work near Laxmi Nagar metro… broke the water pipe"*. Point out:
   * the NLU detected `excavation_damage` (roads) and `water_pipe_burst` (water)
   * two tickets (`MCD-…` and `DJB-…`), each with a priority, a crew and an ETA
   * the coordination plan: water repairs first, then roads resurfaces
   * the **Live A2A trail**: `message/send` → `submitted` → `working` → `completed`. Click *details* to show the raw JSON-RPC.
3. **Follow-up question.** Type *"There is a huge pothole on the main road"*. The Concierge asks for the locality. Answer *"Rohini"*.
4. **Hinglish.** Type *"Rohini me bijli nahi hai subah se"*.
5. **Duplicate detection.** Send the Laxmi Nagar complaint again. The new ticket is *linked to the existing ticket*.
6. **Department dashboard and unified status.** Open a second browser window (or a private window, so the citizen stays logged in) and sign in as `water_officer`. The water dashboard shows the summary cards, the `DJB-…` ticket with **roads** listed under related departments, and the duplicate from step 5 grouped under its parent. Try http://127.0.0.1:8000/dept/roads: **403**. Set the water ticket to `RESOLVED`. Back in the citizen window, open **My complaints**: the timeline shows **In progress**. Sign in as `roads_officer` and resolve the roads ticket; the timeline moves to **Resolved**.
   * Security point: `curl -X PATCH http://127.0.0.1:8101/tickets/DJB-…` without the service token returns **401**. Only the Concierge can change tickets, and only for a logged-in officer of that department.
7. **Extensibility.** Stop the agents and run `python run_all.py --with-sanitation`. Type *"Garbage not collected in Rohini and the drain is blocked"*. A brand-new Sanitation agent gets a ticket, with **zero changes** to the Orchestrator or Concierge code. Log in as `sanitation_officer`: its login and dashboard were also created automatically from the Agent Card. The admin overview (`admin`) now shows four departments.
8. **Validation.** Run `python evaluate.py` (results below).

---

## 7. What actually goes over the wire (A2A)

**Agent Card** (`GET http://127.0.0.1:8101/.well-known/agent-card.json`, shortened):
```json
{
  "protocolVersion": "0.3.0",
  "name": "Water Board Agent",
  "url": "http://127.0.0.1:8101/",
  "preferredTransport": "JSONRPC",
  "capabilities": {"streaming": false, "pushNotifications": false, "stateTransitionHistory": true},
  "skills": [
    {"id": "water_pipe_burst", "name": "Pipe burst / leakage", "tags": ["water", "pipe", "leak", "burst"]},
    {"id": "water_no_supply", "name": "No water supply", "tags": ["water", "no water", "supply"]}
  ]
}
```

**Orchestrator → Water agent** (`message/send`):
```json
{"jsonrpc": "2.0", "id": "a1b2", "method": "message/send",
 "params": {"message": {"kind": "message", "role": "user", "messageId": "msg-…", "contextId": "CMP-20261021-0001",
   "parts": [{"kind": "text", "text": "Water pipe burst: road repair broke the pipe"},
             {"kind": "data", "data": {"complaint_id": "CMP-20261021-0001", "issue_type": "water_pipe_burst",
               "location": "Laxmi Nagar", "urgency": "normal", "related_departments": ["roads"]}}]}}}
```

**Water agent → Orchestrator** (a Task, then polled with `tasks/get` until `completed`):
```json
{"jsonrpc": "2.0", "id": "a1b2", "result": {"kind": "task", "id": "task-…", "contextId": "CMP-20261021-0001",
  "status": {"state": "completed"},
  "artifacts": [{"name": "ticket", "parts": [{"kind": "data", "data": {
     "ticket_id": "DJB-261021-0001", "priority": "HIGH", "ticket_status": "ASSIGNED",
     "assigned_office": "DJB East Zone Office", "crew": "Crew C4", "eta": "2026-10-22T03:15:57+00:00"}}]}]}}
```

The A2A protocol is implemented by hand in `common/a2a.py` (~300 lines) rather than with the `a2a-sdk` package. This keeps every message visible and easy to explain, and nothing breaks when the SDK changes version. The wire format follows the A2A specification.

---

## 8. Validation results (`python evaluate.py`, rules mode)

| Metric | Dev set (45, 15 multi-dept) | **Held-out test set (20, 6 multi-dept)** |
|---|---|---|
| Routing accuracy (exact set of departments) | 100% | **85.0%** |
| Routing accuracy on multi-department complaints | 15/15 | **5/6** |
| Baseline: single-department portal | 66.7% (0/15 multi-dept) | 60.0% (0/6 multi-dept) |
| Location extraction | 100% | 100% |
| Issue-type micro F1 | 1.00 | 0.87 |
| Unified artifact complete (of dispatched) | 100% | 100% |
| Task-state sequence consistent | 100% | 100% |

*Be honest about this in your report.* The dev set was used while writing the rules, so 100% there is expected. The **held-out test set is the real result**. Its 3 misses show where rules-based NLU falls short: "very weak water pressure" (a phrasing the rules don't cover), Hinglish "taar toot ke gira" and an implied second department. These are exactly the cases an LLM handles better. Run `python evaluate.py --mode ollama` or `--mode gemini` to compare. The baseline models a conventional portal, where one complaint goes to one department. That kind of portal can never fully route a multi-department complaint.

Unit and protocol tests, from `backend/`: `python -m pytest -q` (`tests/test_system.py`: Agent Card fields, task lifecycle, rejection of unsupported skills, JSON-RPC error codes, NLU, aggregation; `tests/test_auth.py`: login, roles, per-tab sign-in, ticket rules, officer actions).

---

## 9. Any place in Delhi (free geocoding)

Citizens are not limited to the 20 built-in localities. Any place name ("Rajouri Garden", "kamla nagar me…") is looked up with **OpenStreetMap Nominatim** (free, no API key) in `common/geocode.py`:

* results are limited to Delhi and cached in `backend/data/db/geocode.db`, with at most 1 request per second as the Nominatim usage policy requires
* the department agent serves the place from its **nearest zone office** (e.g. Rajouri Garden → Janakpuri, 4.6 km) so a real crew is assigned
* the heatmap (new *Heatmap* tab) plots the exact coordinates
* if the place can't be found, the Concierge asks once for a nearby landmark; offline (or `GEOCODER=off`) it falls back to the built-in localities

Optional settings: `GEOCODER=nominatim|off`, `NOMINATIM_EMAIL=you@example.com` (contact address the policy asks for), `NOMINATIM_URL` (for a self-hosted server).

## 10. Adding a new department

1. Copy `agents/domain/sanitation.py`. Give it a `key`, a `ticket_prefix` and its `issues` (skills).
2. Run it on a new port: `uvicorn agents.domain.mydept:app --port 8105`.
3. Add its URL to `DOMAIN_AGENT_URLS` in `.env`.

The Orchestrator discovers it from its Agent Card and the Concierge learns its skills automatically. The Concierge also creates a `<key>_officer` login and a `/dept/<key>` dashboard for it, and the department appears in the admin overview and the heatmap filter. No other code changes are needed.

## 11. Project structure

```
a2a_minor_project/
├── backend/                  Python: every agent, run with `python run_all.py`
│   ├── common/
│   │   ├── a2a.py            A2A protocol: Agent Card, JSON-RPC server, TaskStore, client
│   │   ├── config.py         ports, URLs, NLU mode (.env)
│   │   ├── geocode.py        any place name -> coordinates (OpenStreetMap Nominatim, cached)
│   │   └── localities.py     simulated Delhi geography + fuzzy locality matching
│   ├── agents/
│   │   ├── concierge/        HOST agent: nlu.py, core.py (dialogue), server.py, auth.py (login & roles),
│   │   │                     static/ (classic UI, used when the website isn't built)
│   │   ├── orchestrator/     graph.py (LangGraph), server.py (A2A + audit trail)
│   │   └── domain/           base.py (generic dept agent) + water, electricity, roads, sanitation
│   ├── adk_host/             Google ADK version of the host agent
│   ├── data/                 evaluation datasets; db/ is created at runtime
│   ├── docs/postman_collection.json
│   ├── tests/                test_system.py (A2A, NLU, routing), test_auth.py (login, roles, tickets)
│   ├── evaluate.py           validation script (synopsis 4.6)
│   ├── run_all.py            starts every agent as its own process
│   ├── requirements.txt
│   └── .env.example          copy to backend/.env
├── frontend/                 React + TypeScript website; see frontend/README.md
├── design/                   design system, wireframes, hand-off notes
├── start_windows.bat         starts the backend (double-click)
└── start.sh                  starts the backend (macOS / Linux)
```

## 12. Troubleshooting

* **"Address already in use"**: an old run is still going. Close it, or change the ports in `backend/.env` (`CONCIERGE_PORT=9000` and so on).
* **Ollama mode keeps saying "fallback"**: make sure `ollama serve` is running and the model is pulled (`ollama list`).
* **Gemini 429 error**: you hit the free-tier rate limit. Wait a minute. The rules engine fills in meanwhile.
* **Start with a clean demo**: `python run_all.py --reset`. This also deletes `users.db`; the demo accounts are recreated on the next start.
* **"Wrong username or password" for a demo account**: the accounts were created with the passwords that were in `.env` at the time. Delete `backend/data/db/users.db` and restart.
* **`sanitation_officer` cannot log in**: that account is only created once the Sanitation agent is running (`python run_all.py --with-sanitation`).

## 13. Future scope (from the synopsis)

Multilingual and voice intake, SLA-based automatic escalation (`tasks/get` polling already provides the hook), A2A push notifications instead of polling, OpenTelemetry export of the trail, production-grade authentication (HTTPS, OTP/DigiLocker-style identity, rate limiting, per-agent credentials or mTLS between agents), and integration with real departmental systems.

# Nagrik Sahayak website (React + TypeScript + Vite)

An iOS-style single-page web app. It talks to the Citizen Concierge (FastAPI) only through its
JSON API under `/api`; the browser keeps a signed, HttpOnly session cookie.

## Run it

You need Node.js 18+ and the Python backend set up as in the main README.

### Development (hot reload)

```bash
# terminal 1 - backend: all agents, Concierge API on :8000 (from the repo root)
cd backend
python run_all.py

# terminal 2 - website on http://localhost:5173
cd frontend
npm install        # first time only
npm run dev
```

Vite proxies every `/api/...` request to `http://127.0.0.1:8000`, so the login cookie works
as if it were one site. To use another backend address, copy `.env.example` to `.env.local`
and change `VITE_BACKEND_URL`.

### Production (one server)

```bash
cd frontend
npm run build      # type-checks, then writes frontend/dist
cd ../backend
python run_all.py  # the Concierge now serves the website on http://127.0.0.1:8000
```

Without a `dist/` build (or with `CONCIERGE_UI=classic`), the Concierge falls back to the
old pages in `agents/concierge/static/`.

## Pages (client-side routes)

| Route | Who | What |
|---|---|---|
| `/` | everyone | public landing page (live agent count, departments, anonymised activity, track by ID) |
| `/login` | everyone | sign in / create a citizen account (`?next=` returns you where you were going) |
| `/home` | citizen | dashboard: stats, recent complaints, quick actions, department activity |
| `/file` | citizen | chat with the Concierge; live agent timeline; confirmation with the complaint ID |
| `/complaints` | citizen | my complaints: search and filters |
| `/complaints/:id` | citizen (own), admin | overview (tickets, plan, what was understood) · **Agent execution** (workflow graph, replay, timeline, JSON-RPC inspector) · audit trail |
| `/agents` | all roles | Agent Card directory |
| `/map` | all roles | hotspot heatmap |
| `/settings` | all roles | account, Concierge language engine, appearance, sign out |
| `/dept/:dept` | officer of that department, admin | ticket queue; change status from a sheet |
| `/admin` | admin | totals, departments, searchable list of all complaints |

The design system the UI follows (tokens, brand book, wireframes) is in `../design/`.

## API used (typed in `src/api/client.ts`)

| Method | Path | Used for |
|---|---|---|
| GET | `/api/me` | who is signed in |
| POST | `/api/login`, `/api/register`, `/api/logout` | sessions |
| POST | `/api/chat` | send a complaint or `status <id>` to the Concierge agent |
| GET | `/api/my-complaints` | citizen's complaints with live status |
| GET | `/api/complaints/{id}` | one complaint (owner or admin): live unified status + what the Concierge understood |
| GET | `/api/public/overview` | no login: agent count, departments, hotspots, anonymised recent activity |
| GET | `/api/trail/{id}` | A2A audit trail of one complaint |
| GET | `/api/agents`, `/api/departments`, `/api/config`, `/api/heatmap` | discovery, settings, map |
| GET / PATCH | `/api/dept/{dept}/tickets[/{ticket_id}]` | officer dashboard |
| GET | `/api/complaints` | admin: all complaints |

Interactive API docs: http://127.0.0.1:8000/docs

## Layout

```
src/
  api/          client.ts (fetch wrapper + endpoints), types.ts (response shapes)
  auth.tsx      session state, RequireRole route guard
  components/   AppShell, Public (nav/footer), Workflow (agent graph + timeline), Complaint, Overlays (toast, sheet, drawer), ui
  lib/          status (tones, labels, department names), trail (audit trail -> run steps and graph states), prefs, hooks, format, theme
  pages/        Landing, Login, Home, FileComplaint, MyComplaints, ComplaintDetail, Agents, MapPage, Settings, DeptQueue, AdminOverview
  styles/       tokens.css, components.css, base.css, public.css, app.css
```

Monochrome, Apple-inspired design: colour only for status (green done, blue active, orange pending,
red error). Font: SF Pro on Apple devices, Inter elsewhere. Icons: Lucide. Light/dark follows the
device and can be changed in Settings.

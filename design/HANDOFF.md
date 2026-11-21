# Handoff: Nagrik Sahayak frontend redesign

This brief is for a Claude Code session working **inside the `a2a_minor_project` repository**. It explains what was decided in the design phase, where the design files are, and how to build the new frontend.

## 1. What exists already

**Backend (do not change its behaviour):** six FastAPI processes started by `python run_all.py`:
- Concierge `:8000`: serves the UI and proxies the REST API.
- Orchestrator `:8001`: LangGraph, SQLite audit trail.
- Department agents: Water `:8101`, Electricity `:8102`, Roads `:8103`, Sanitation `:8104`.

They talk to each other over a hand-written A2A JSON-RPC layer (`common/a2a.py`).

**Current UI:** one file, `agents/concierge/static/index.html`, written in vanilla JS. The department consoles are HTML strings inside `agents/domain/base.py`.

**API the new UI uses** (all on `:8000`):

| Method | Path | Returns |
|---|---|---|
| POST | `/api/chat` | `{message, session_id, mode}` → `{reply, structured, unified, state}` |
| GET | `/api/complaints` | list of complaints |
| GET | `/api/trail/{cid}` | audit events `{ts, actor, event, detail}` |
| GET | `/api/agents` | discovered Agent Cards |
| GET | `/api/heatmap` | `{points[], unmapped}` |
| GET | `/api/config` | NLU mode and model names |

Department agents also expose `GET /tickets` and `PATCH /tickets/{id}`.

**Status vocabularies:**
- Complaint: REGISTERED / IN_PROGRESS / RESOLVED / NOT_ROUTED
- Ticket: OPEN / ASSIGNED / IN_PROGRESS / RESOLVED / CLOSED
- A2A task: submitted / working / input-required / completed / failed / canceled / rejected
- Priority: LOW / MEDIUM / HIGH / CRITICAL

**Not supported by the backend:** user accounts, login, attachments, notifications. Design for them only as clearly marked future work. Never fake them.

## 2. Design files (copied into `design/`)

| Path | What |
|---|---|
| `design/design-system/README.md` | **Brand book. Read this first.** Principles, colour, type, layout, motion, iconography. |
| `design/design-system/tokens.json` | All tokens: colours (light and dark), type styles, spacing, radius, shadow, duration. |
| `design/design-system/components/*/README.md` + `preview.html` | 11 reference components: Button, TextField, StatusBadge, PriorityTag, DepartmentChip, StatTile, Sidebar, ComplaintCard, ChatMessage, AgentNode, ExecutionTimeline. |
| `design/design-system/components/bundle.css` | Reference CSS for those components (`ns-` classes). |
| `design/design-system/01-architecture.md` … `06-component-library.md` | Architecture analysis, feature inventory, proposed frontend architecture, sitemap, screen list, component library. |
| `design/wireframes/01-landing.html` | **Approved landing page.** Low-fi, high-fi (desktop, phone, menu open, states) and spec tabs. |
| `design/wireframes/shared/*.css`, `icons.js` | Tokens as CSS variables, component CSS, public nav/footer CSS, icon sprite. |

To view the wireframes, run a static server from `design/wireframes` (for example `python -m http.server 5178`) and open `http://localhost:5178/01-landing.html`.

## 3. Visual direction (summary of the brand book)

- **Monochrome, Apple-inspired.**
  - Backgrounds: white `#FFFFFF`, with `#F5F5F7` for alternate sections and the sidebar.
  - Dividers: `#E5E5EA` hairlines.
  - Text: `#1D1D1F` for primary text. Use `#6E6E73` for secondary text under 21px; `#86868B` only for large text, placeholders and icons.
- **Buttons:** black primary pills, grey `#E8E8ED` secondary pills.
- **Colour only for status:** green done, blue active, orange pending, red error. Always show a 7px dot next to a word. Departments are distinguished by icon and name, never by colour.
- **Type:** `-apple-system` / SF Pro, falling back to Inter. Headings use weight 600; body text is 400 at 17px. Do not bundle SF Pro: its licence restricts it to Apple platforms.
- **Layout:** whitespace and hairlines instead of cards. Radii 12 / 18 / 28, and pills for buttons, chips and badges. Shadows only on floating elements.
- **Motion:** easing `cubic-bezier(.25,.1,.25,1)`, buttons scale to 0.97 when pressed, sections fade up once, and only live status dots loop. Respect `prefers-reduced-motion`.
- **Icons:** Lucide at 1.5px stroke. No emoji.
- **Themes:** light and dark are both required.

## 4. Build plan

Tech stack (from `03-frontend-architecture.md`):
- Vite + React + TypeScript in a new top-level `web/` folder.
- React Router, TanStack Query, Radix UI primitives, `lucide-react`, CSS Modules on top of token CSS variables.
- React Flow for the agent graph, react-leaflet for the map.

The app builds to static files that the Concierge serves, so `python run_all.py` stays the only command needed.

**Phases.** Stop for review after each one.

0. **Scaffold:** create `web/`, generate `web/src/styles/tokens.css` from `tokens.json`, port the reference components into React, and set up a Vite dev proxy from `/api` to `:8000`.
1. **Landing page:** match `design/wireframes/01-landing.html` exactly, on desktop and phone, in light and dark. The activity section reads `/api/complaints` and `/api/heatmap`, with loading, empty and error states as in the spec.
2. **Wireframes for the remaining screens**, one at a time, in the same HTML board format as `01-landing.html`. Wait for approval on each before building it.
   - 02 Authentication: future work, because the backend has no auth.
   - 03 Citizen dashboard
   - 04 Submit complaint: the Concierge chat flow.
   - 05 My complaints
   - 06 Complaint detail and tracking
   - 07 A2A agent execution dashboard
   - 08 Agent directory
   - 09 Profile and settings: NLU engine (rules / Ollama / Gemini) and appearance.
3. **Build each approved screen** against the real API.
4. **Wire up serving:** have the Concierge serve `web/dist` with an SPA fallback. This is the only backend change, and it needs approval first.

## 5. Rules

- Do not change backend logic, API shapes or agent behaviour. Any backend addition needs approval first.
- Do not invent features the backend lacks.
- Use only tokens from `tokens.json`. If a needed value is missing, add a token first.
- Use real data and real figures. The evaluation numbers (85% routing accuracy vs a 60% baseline, 5 of 6 multi-department complaints, 100% location extraction) come from README §7.
- Show each screen to the user and wait for feedback before starting the next one.

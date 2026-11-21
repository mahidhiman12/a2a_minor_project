# 3. Proposed frontend architecture

## Recommendation

A separate **React + TypeScript single-page app built with Vite**, living in a new top-level `web/` folder, that builds to static files the Concierge serves from `agents/concierge/static/`. The Python agents stay exactly as they are.

Why this and not Next.js: the backend is already FastAPI on six ports, there is no SEO-critical content beyond the landing page, and a static build keeps `python run_all.py` the single command to run the demo. If the landing page later needs SEO, it can be pre-rendered with `vite-plugin-ssg` without changing the app.

## Stack

| Concern | Choice | Reason |
|---|---|---|
| Build | Vite 5, TypeScript strict | Fast, zero-config, static output |
| Routing | React Router 6 (data routers) | Nested layouts for Citizen / Operator areas |
| Server state | TanStack Query 5 | Polling with `refetchInterval` for live trails, caching, retries |
| Styling | CSS Modules + the token CSS variables from this system (`tokens.css`) | Tokens stay the single source; no utility-class sprawl |
| Primitives | Radix UI (Dialog, Popover, Tabs, Tooltip, Select, Toast) | Accessible behaviour, unstyled |
| Icons | `lucide-react` | Matches the iconography rules |
| Workflow graph | React Flow (`@xyflow/react`) | Agent nodes and animated A2A edges |
| Map | `react-leaflet` + `leaflet.heat` (already used) | Keeps the current heatmap logic |
| Motion | Framer Motion, sparingly | Timeline step enter, card lift, drawer |
| Forms | React Hook Form + Zod | Track-by-ID, operator status change |
| Testing | Vitest + Testing Library, Playwright for the demo script | |

## Folder structure

```
web/
├── index.html
├── src/
│   ├── app/                 router, providers (QueryClient, Theme), AppShell layouts
│   ├── styles/              tokens.css (generated from tokens.json), global.css
│   ├── components/          the reusable library (see Component library section)
│   │   ├── primitives/      Button, IconButton, Input, Select, Badge, Tag, Avatar …
│   │   ├── data/            DataTable, StatTile, KeyValue, EmptyState, Skeleton
│   │   ├── civic/           ComplaintCard, TicketCard, StatusHero, CoordinationPlan …
│   │   └── agents/          AgentNode, WorkflowGraph, ExecutionTimeline, RpcInspector …
│   ├── features/
│   │   ├── concierge/       chat state machine, composer, message renderers
│   │   ├── complaints/      list, detail, track
│   │   ├── agents/          directory, detail, Agent Card viewer
│   │   ├── operator/        department queue, ticket status change
│   │   └── insights/        heatmap, evaluation
│   ├── api/                 typed client + Zod schemas mirroring the unified artifact
│   └── lib/                 formatters (IST time, IDs), status maps, a11y helpers
└── vite.config.ts           dev proxy: /api → :8000
```

## Data layer

- `api/client.ts` wraps `fetch` against the Concierge origin. Types mirror the backend shapes listed in the architecture section (`Unified`, `DepartmentEntry`, `TrailEvent`, `AgentCard`, `HeatPoint`).
- Query keys: `['complaints']`, `['complaint', id]`, `['trail', id]`, `['agents']`, `['heatmap']`, `['config']`.
- **Live trail**: `useQuery(['trail', id], { refetchInterval: running ? 1500 : false })` where `running = !unified.all_subtasks_completed`. This gives the "real-time" feel without backend push.
- Chat keeps a local reducer (`messages`, `pendingQuestion`, `lastUnified`) and posts to `/api/chat` with a `session_id` persisted in `sessionStorage`.
- Status mapping lives in one file (`lib/status.ts`) that maps every vocabulary (complaint, ticket, A2A, priority) to `{label, tone, icon}` — components never switch on raw strings.

## Small backend additions (flagged, not done)

The UI can ship against today's API. These optional additions make the Operator area and polish possible; none change agent logic:

1. **Concierge proxy for department tickets** — `GET /api/departments/{key}/tickets` and `PATCH /api/departments/{key}/tickets/{id}`, forwarding to the department URL found via Agent Cards. Lets the Operator area live on one origin.
2. **Serve the SPA** — mount `static/` with an SPA fallback so deep links like `/track/CMP-…` work.
3. **`GET /api/complaints/{cid}`** passthrough to the orchestrator's existing endpoint, so Complaint detail doesn't depend on chat.

## Accessibility and quality bars

- WCAG 2.2 AA: all text pairs in tokens meet 4.5:1 (see token usage notes); focus ring always visible; every status uses icon + word.
- Keyboard: full app operable; ⌘K command palette in the operator area.
- Responsive: citizen area is mobile-first (most complaints are filed on phones); operator area is desktop-first but usable at 768px.
- Performance budget: landing < 120 KB JS gzipped; Leaflet and React Flow loaded only on routes that use them.

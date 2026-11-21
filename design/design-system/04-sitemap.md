# 4. Proposed application sitemap

Two areas share one shell and one design language: a **Citizen** area (civic register — warm, mobile-first) and an **Operator** area (operator register — dense, desktop-first, the "Linear-style" workspace). Routes marked *future* depend on backend features that don't exist yet.

```
/                                   Landing page
├── /how-it-works                   The agent story, A2A explained for citizens
├── /file                           File a complaint (Concierge chat)
│   └── /file/:complaintId          Submission confirmation → links to tracking
├── /track                          Track by complaint ID
│   └── /track/:complaintId         Citizen complaint status (unified, plain language)
├── /about                          Project, team, evaluation summary
│
└── /app                            Operator workspace (AppShell with sidebar)
    ├── /app/overview               Dashboard: KPIs, live activity, recent complaints
    ├── /app/complaints             All complaints (table, filters, search)
    │   └── /app/complaints/:id     Complaint detail
    │       ├── ?tab=summary        Unified status, tickets, coordination plan
    │       ├── ?tab=workflow       Workflow graph + execution timeline
    │       └── ?tab=trail          Raw A2A trail with JSON-RPC inspector
    ├── /app/agents                 Agent directory (discovered Agent Cards)
    │   └── /app/agents/:key        Agent detail: card, skills, rules, health, recent tasks
    ├── /app/departments/:key       Department queue (replaces per-port /console)
    │   └── …/tickets/:ticketId     Ticket drawer: change status, notes
    ├── /app/insights
    │   ├── /app/insights/map       Heatmap + hotspots
    │   └── /app/insights/evaluation  Routing accuracy report (from evaluate.py)
    └── /app/settings               AI engine (rules / Ollama / Gemini), appearance

future: /signin, /me/complaints (citizen history), /app/notifications, /app/sla
```

## Navigation

- **Public top nav** (landing, how it works, track, about): logo · How it works · Track a complaint · About · [File a complaint] (black pill) · "Operator workspace" text link.
- **Operator sidebar**: Overview · Complaints · Agents · Departments (expandable: Water, Electricity, Roads, Sanitation — built from discovered agents) · Insights · Settings. Footer of sidebar: system health strip (each agent's `/health`) and NLU engine badge.
- **Operator top bar**: breadcrumb, ⌘K search (IDs, agents, localities), theme toggle.
- **Mobile citizen nav**: bottom bar with Home · File · Track.

## Key flows

1. **File** — Landing CTA → `/file` → chat (with clarifying question if needed) → live "agents working" timeline inline → confirmation card with complaint ID → `/track/:id`.
2. **Track** — `/track` → enter or paste `CMP-…` → status page; auto-refresh while not resolved.
3. **Operate** — `/app/overview` → click a live complaint → Complaint detail (workflow tab) → open a ticket → jump to Department queue → change status → unified status updates.
4. **Explain the system** (viva/demo) — `/app/agents` → Agent detail → raw Agent Card → back to a complaint's workflow graph to show discovery → dispatch → track → aggregate.

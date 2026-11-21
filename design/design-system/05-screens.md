# 5. Screens to design

Grouped by area, in suggested design order. Each line: screen — purpose — key components — states to cover.

## Public / citizen (civic register)

| # | Screen | Purpose | Key components | States |
|---|---|---|---|---|
| C1 | **Landing page** | Explain the promise ("one complaint, every department") and drive to Filing | Centred hero over a product composition (app window + phone), impact numbers from evaluation, 4-step story, department columns, workflow canvas, city activity, track-by-ID, footer | Desktop, tablet, phone; light and dark appearance |
| C2 | **How it works** | Citizen-friendly A2A explainer | Step cards, simplified WorkflowGraph, FAQ accordion | — |
| C3 | **File a complaint** (Concierge) | Guided chat intake | ChatThread, ConciergeMessage, UserMessage, Composer with suggestions, ClarifyingQuestion card with quick replies, LocationChip, inline ExecutionTimeline (compact), Detected-issues summary panel (desktop right rail) | Empty/first visit, typing, clarifying question, LLM fallback notice, orchestrator unreachable, Hinglish example |
| C4 | **Submission confirmation** | Close the loop | Success hero, ComplaintID copy chip, DepartmentTicket list, CoordinationPlan, "Track this" CTA | Single dept, composite, duplicate-linked, partially unroutable |
| C5 | **Track by ID** | Lookup | Large ID input, recent IDs (sessionStorage) | Empty, invalid format, not found |
| C6 | **Citizen complaint status** | Plain-language progress | StatusHero (overall), progress Stepper (Registered → In progress → Resolved), per-department TicketCard, ETA, CoordinationPlan, "last updated" + auto-refresh | Registered, in progress, resolved, not routed, CRITICAL flagged |
| C7 | **About** | Project, team, evaluation results | Editorial text, MetricCard row | — |

## Operator workspace (operator register)

| # | Screen | Purpose | Key components | States |
|---|---|---|---|---|
| O1 | **App shell** | Navigation frame | Sidebar, TopBar, Breadcrumb, CommandPalette, HealthStrip, ThemeToggle | Collapsed sidebar, mobile drawer |
| O2 | **Overview dashboard** | Pulse of the system | StatTile row (open, in progress, resolved today, multi-dept share), LiveActivityFeed, AgentHealth grid, Recent complaints table, Mini heatmap | Empty system, agents offline |
| O3 | **Complaints list** | Triage | DataTable (ID, summary, location, departments, priority, status, updated), FilterBar, Search, saved views as Tabs | Empty, filtered-empty, loading skeleton |
| O4 | **Complaint detail · Summary** | One complaint at a glance | Header (ID, location, priority, status), StatusHero, TicketCard ×n, CoordinationPlan, Structured NLU output (KeyValue), duplicate notice | Composite, single, failed dispatch |
| O5 | **Complaint detail · Workflow** | The agent story | WorkflowGraph (Concierge → Orchestrator → departments, node states), ExecutionTimeline (discover → decompose → dispatch → track → aggregate with timings) | Running (live pulse), completed, partial failure |
| O6 | **Complaint detail · Trail** | Audit | TrailEventRow list, RpcInspector drawer with JSON viewer, filter by actor/event | Long trails, errors |
| O7 | **Agent directory** | Discovered agents | AgentCard tiles (name, role, URL, protocol, skills, health), "Discovered from /.well-known" note | Offline agent, newly discovered agent |
| O8 | **Agent detail** | One agent's card & behaviour | AgentHeader, Skills list with SkillTag + rules table, Raw Agent Card JSON, recent tasks table | Concierge, Orchestrator, Department variants |
| O9 | **Department queue** | Replace per-port consoles | DataTable of tickets, status Select, Ticket drawer (details, status change, notes, linked complaint) | Duplicate tickets, CRITICAL first |
| O10 | **Insights · Map** | Hotspots | Map with heat layer + markers, FilterBar (department, unresolved), Hotspot list bars | Offline tiles fallback, no data |
| O11 | **Insights · Evaluation** | Show validation honestly | MetricCard grid (dev vs held-out), comparison bar vs baseline, misses list | — |
| O12 | **Settings** | AI engine & appearance | SegmentedControl (rules/Ollama/Gemini), status of key/model, theme | Gemini key missing |

## System screens

Empty states (per list), 404, agent-offline banner, orchestrator-unreachable full-page error, loading skeletons for each layout, toast set (ticket updated, new agent discovered, copied ID).

**Total: 7 citizen + 12 operator screens + system states.** Wireframes should start with C1, C3, C6, O2 and O5 — they carry the identity and the agent story.

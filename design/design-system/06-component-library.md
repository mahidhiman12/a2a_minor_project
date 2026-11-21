# 6. Suggested reusable component library

Four layers, built bottom-up. Components with a live preview in this system are marked ●; the rest are specified here and get previews when wireframes are approved.

## Primitives

| Component | Notes |
|---|---|
| ● **Button** | Pills: `primary` (black) · `secondary` (grey) · `plain` · `destructive`; sizes sm 28 / md 36 / lg 48; optional icon; loading. One primary per view. |
| IconButton | Square, `radius-md`, tooltip required. |
| ● **TextField** | Label, helper, error; prefix icon; `bg-subtle` at rest, blue `focus` border when focused; also Textarea and the large Track-by-ID variant. |
| Select, Combobox | Radix; locality combobox with geocode hint. |
| SegmentedControl | NLU engine, list views. |
| Checkbox, Switch, Radio | |
| ● **StatusBadge** | Maps any vocabulary (complaint, ticket, A2A, overall) to a status dot + word. |
| ● **PriorityTag** | LOW / MEDIUM / HIGH / CRITICAL; four bars; only CRITICAL turns `red`. |
| ● **DepartmentChip** | Icon + name + ticket prefix, no colour; also as filter chip. |
| SkillTag | Mono, on `bg-subtle`. |
| IdChip | Mono ID with copy-on-click and "Copied" tooltip. |
| Avatar / AgentAvatar | Agent icon on a `bg-subtle` square. |
| Tooltip, Popover, Dialog, Drawer, Toast | Radix + tokens. |
| Tabs | Underline style for pages, pill style inside cards. |
| Skeleton, Spinner, LivePulse | LiveDot = 7px blue dot that breathes. |

## Layout & data

| Component | Notes |
|---|---|
| AppShell, ● **Sidebar**, TopBar, Breadcrumb | Operator frame. |
| PublicNav, Footer, Section, BentoGrid | Landing frame. |
| Card, CardHeader | Only for one object: `surface`, `radius-lg`, `separator` border, `space-6`. |
| ● **StatTile** | Label, value, delta, sparkline slot. |
| DataTable | Sortable headers, row hover, selected row on `fill`, sticky header, empty state. |
| FilterBar | Chips + search + "clear". |
| KeyValue list | Structured NLU output, ticket details. |
| EmptyState | One grey 28px icon + one sentence + one action. |
| CommandPalette | ⌘K. |

## Civic (domain)

| Component | Notes |
|---|---|
| ● **ComplaintCard** | Summary, ID, location, departments, overall status, updated time. List + mobile. |
| TicketCard | One department's ticket: dept, issue, ticket ID, priority, ticket status, office, crew, ETA, duplicate link. |
| StatusHero | Big overall status with stepper Registered → In progress → Resolved. |
| CoordinationPlan | Numbered steps from `coordination_plan[]`. |
| LocationChip | Place + "served by … zone office, 4.6 km". |
| HotspotList, HeatMap | Insights. |
| MetricCard | Evaluation numbers with comparison. |

## Agents (AI workflow)

| Component | Notes |
|---|---|
| ● **ChatMessage** | Concierge (`bg-subtle` bubble, left) and citizen (black bubble, right); provenance meta ("NLU: rules"); ClarifyingQuestion variant with quick replies. |
| Composer | Textarea + send pill + suggestion chips. |
| ● **AgentNode** | Agent icon, name, role, port; states idle · active (pulse) · done · failed · offline; status dot, no department colours. |
| WorkflowGraph | React Flow canvas of AgentNodes with animated A2A edges labelled `message/send`, `tasks/get`. |
| ● **ExecutionTimeline** | Vertical steps (discover, decompose, dispatch, track, aggregate) with duration, actor and state; compact variant inline in chat. |
| TrailEventRow | Timestamp offset, actor → actor, method/state pill, expandable. |
| RpcInspector | Drawer with request/response JSON on `bg-subtle`, copy, prev/next. |
| AgentCardView | Rendered Agent Card + raw JSON toggle. |
| HealthStrip | One dot per agent from `/health`. |

## Naming and API conventions

- Props are domain-typed: `<StatusBadge kind="ticket" value="IN_PROGRESS" />`, `<DepartmentChip dept="water" />` — the component owns the label, tone and icon via `lib/status.ts`.
- Every interactive component forwards `ref`, accepts `className`, and exposes `data-state` for styling.
- No component hard-codes a colour; only tokens.

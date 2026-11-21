# AgentNode
A white node with a hairline border: icon tile, name, mono subtitle and a status dot.

**Consumer provides.** Agent name, subtitle (port, ticket ID or current step), icon, and `state`: `idle` (45% opacity), `active` (faint blue border and halo, breathing blue dot), `done` (green dot), `error`/`offline` (red dot). In a WorkflowGraph edges are 1px `ink-tertiary` lines; the in-flight edge is dashed `blue`; uninvolved edges are dotted and faint. Edge labels are 10.5px mono on white with a hairline.

# StatusBadge
A 7px coloured dot beside a word — the only place colour appears in the system.

**Consumer provides.** `kind` (`complaint` | `ticket` | `task`) and the raw backend `value`; the component maps it:

| Tone | Complaint | Ticket | A2A task |
|---|---|---|---|
| pending (`orange`) | REGISTERED | OPEN | submitted, input-required |
| active (`blue`) | IN_PROGRESS | ASSIGNED, IN_PROGRESS | working |
| done (`green`) | RESOLVED | RESOLVED, CLOSED | completed |
| error (`red`) | NOT_ROUTED | — | failed, canceled, rejected |
| idle (grey) | — | — | not dispatched |

Default form is dot + word in `ink`. The `badge` form (soft ground, `-ink` text) is for dense operator tables. The active dot breathes only while the item is live.

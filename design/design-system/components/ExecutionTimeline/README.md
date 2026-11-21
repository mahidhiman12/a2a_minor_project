# ExecutionTimeline
A vertical list of the Orchestrator's steps joined by a 1px line, each with a small state dot.

**Consumer provides.** Steps derived from `/api/trail/{cid}`: title, one line of detail (methods as mono code), offset from the first event, and state (`done` green, `now` blue with a soft halo, `pending` hollow grey, `fail` red). Clicking a step opens the JSON-RPC inspector. A horizontal variant sits along the bottom of the workflow canvas; a compact one appears inline in the Concierge chat.

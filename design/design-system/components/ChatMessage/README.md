# ChatMessage
Messages-style bubbles: the citizen in `primary` on the right, the Concierge in `bg-subtle` on the left.

**Consumer provides.** `role`, `content` (light markdown; IDs become copyable mono chips), optional `meta` (NLU engine, detected issues, urgency) shown as an 11px caption, optional `quickReplies` for `input-required`, rendered as outlined pills that send their text. No avatars inside a thread.

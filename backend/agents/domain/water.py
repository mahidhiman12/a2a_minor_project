"""Water Board Agent  ->  uvicorn agents.domain.water:app --port 8101"""
from agents.domain.base import DomainSpec, IssueType, build_domain_app

SPEC = DomainSpec(
    key="water",
    name="Water Board Agent",
    organisation="Delhi Jal Board (simulated)",
    ticket_prefix="DJB",
    asset_type="Water main / sewer line",
    issues=[
        IssueType("water_pipe_burst", "Pipe burst / leakage",
                  "Broken, burst or leaking water supply pipeline", "HIGH", 12,
                  ["pipe", "leak", "burst"], ["Water pipe burst near the market"]),
        IssueType("water_no_supply", "No water supply",
                  "Area receiving no piped water supply", "HIGH", 24,
                  ["no water", "supply"], ["No water in our colony since morning"]),
        IssueType("water_contamination", "Contaminated water",
                  "Dirty, smelly or coloured water in the supply", "CRITICAL", 6,
                  ["dirty water", "contamination"], ["Tap water is brown and smells"]),
        IssueType("water_low_pressure", "Low water pressure",
                  "Very low pressure in the water supply", "MEDIUM", 48,
                  ["pressure"], ["Water pressure is too low to reach first floor"]),
        IssueType("sewer_overflow", "Sewer overflow / blockage",
                  "Overflowing or blocked sewer lines and manholes", "HIGH", 24,
                  ["sewer", "drain", "manhole"], ["Sewer is overflowing onto the street"]),
    ],
    rules=[
        "Contamination complaints are always CRITICAL with a 6 hour SLA.",
        "Urgency 'high' raises priority by one level; 'critical' sets it to CRITICAL.",
        "A matching open complaint in the same locality within 24h is linked as a duplicate.",
        "Tickets in a known locality are ASSIGNED to the zonal crew immediately.",
    ],
)

app = build_domain_app(SPEC)

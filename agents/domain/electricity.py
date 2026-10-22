"""Electricity Agent  ->  uvicorn agents.domain.electricity:app --port 8102"""
from agents.domain.base import DomainSpec, IssueType, build_domain_app

SPEC = DomainSpec(
    key="electricity",
    name="Electricity Agent",
    organisation="Electricity Distribution Company (simulated)",
    ticket_prefix="ELC",
    asset_type="11kV feeder / distribution transformer",
    issues=[
        IssueType("power_outage", "Power outage",
                  "No electricity / power cut in an area", "HIGH", 4,
                  ["power cut", "outage"], ["No electricity in our block for 3 hours"]),
        IssueType("electric_hazard", "Live wire / sparking hazard",
                  "Exposed live wires, sparking poles, electrocution risk", "CRITICAL", 2,
                  ["sparking", "live wire", "shock"], ["Wire is sparking on the pole"]),
        IssueType("cable_damage", "Underground cable damage",
                  "Damaged or cut underground/overhead electricity cable", "HIGH", 8,
                  ["cable", "feeder"], ["Digging work cut the electric cable"]),
        IssueType("transformer_fault", "Transformer fault",
                  "Transformer blast, fire, humming or oil leak", "CRITICAL", 6,
                  ["transformer"], ["Transformer exploded with a loud bang"]),
        IssueType("voltage_fluctuation", "Voltage fluctuation",
                  "Low voltage or frequent fluctuation damaging appliances", "MEDIUM", 24,
                  ["voltage"], ["Voltage keeps fluctuating, fans run slowly"]),
        IssueType("streetlight_fault", "Streetlight not working",
                  "Non-functional street lights", "LOW", 72,
                  ["streetlight"], ["Street lights on our lane are off"]),
    ],
    rules=[
        "Live-wire / sparking hazards are CRITICAL with a 2 hour SLA.",
        "Cable damage caused by third-party excavation is cross-referenced to the Roads ticket.",
        "A matching open complaint in the same locality within 24h is linked as a duplicate.",
    ],
)

app = build_domain_app(SPEC)

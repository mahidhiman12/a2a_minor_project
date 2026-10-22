"""Municipal Roads Agent  ->  uvicorn agents.domain.roads:app --port 8103"""
from agents.domain.base import DomainSpec, IssueType, build_domain_app

SPEC = DomainSpec(
    key="roads",
    name="Municipal Roads Agent",
    organisation="Municipal Corporation - Roads Dept (simulated)",
    ticket_prefix="MCD",
    asset_type="Road segment",
    issues=[
        IssueType("pothole", "Pothole / damaged road surface",
                  "Potholes, cracks or broken road surface", "MEDIUM", 72,
                  ["pothole", "road damage"], ["Huge pothole on the main road"]),
        IssueType("excavation_damage", "Unsafe / unrestored excavation",
                  "Road dug up for work and left open, unfilled or unsafe", "HIGH", 48,
                  ["digging", "excavation", "trench"], ["Road dug up and left open for a week"]),
        IssueType("waterlogging", "Waterlogging on road",
                  "Water accumulated on the road surface", "HIGH", 24,
                  ["waterlogging", "flooded"], ["Road flooded after rain"]),
        IssueType("road_obstruction", "Debris / road blocked",
                  "Construction debris, fallen tree or material blocking road", "MEDIUM", 24,
                  ["debris", "blocked"], ["Malba dumped in the middle of the road"]),
        IssueType("footpath_damage", "Broken footpath",
                  "Broken or encroached footpath / pavement", "LOW", 120,
                  ["footpath", "pavement"], ["Footpath tiles are broken"]),
    ],
    rules=[
        "Open excavations are HIGH priority with a 48 hour SLA (safety risk).",
        "Road restoration over a utility repair is scheduled after the utility ticket closes.",
        "A matching open complaint in the same locality within 24h is linked as a duplicate.",
    ],
)

app = build_domain_app(SPEC)

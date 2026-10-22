"""
EXTENSIBILITY DEMO - a 4th department added WITHOUT touching the orchestrator
or the concierge code (Synopsis 4.1 / Expected outcome 2).

    uvicorn agents.domain.sanitation:app --port 8104
    then in .env:  DOMAIN_AGENT_URLS=http://127.0.0.1:8101,http://127.0.0.1:8102,http://127.0.0.1:8103,http://127.0.0.1:8104
    and restart run_all.py   (or: python run_all.py --with-sanitation)

The orchestrator discovers it from its Agent Card; the rules NLU picks up its
skill tags automatically, and LLM modes see its skills in the prompt.
"""
import os

from agents.domain.base import DomainSpec, IssueType, build_domain_app
from common import config

config.PORTS.setdefault("sanitation", int(os.getenv("SANITATION_PORT", 8104)))

SPEC = DomainSpec(
    key="sanitation",
    name="Sanitation Agent",
    organisation="Municipal Sanitation Dept (simulated)",
    ticket_prefix="SAN",
    asset_type="Garbage collection point",
    issues=[
        IssueType("garbage_not_collected", "Garbage not collected",
                  "Household or street garbage not picked up", "MEDIUM", 24,
                  ["garbage", "kachra", "kooda", "trash", "waste"],
                  ["Garbage has not been collected for 3 days"]),
        IssueType("dead_animal", "Dead animal removal",
                  "Carcass lying on road or public place", "HIGH", 12,
                  ["dead dog", "dead cow", "dead animal", "carcass"],
                  ["A dead dog is lying near the park"]),
    ],
    rules=["Dead animal removal is HIGH priority with a 12 hour SLA."],
)

app = build_domain_app(SPEC)

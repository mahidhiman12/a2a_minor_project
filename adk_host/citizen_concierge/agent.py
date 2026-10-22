"""
Citizen Concierge built with Google Agent Development Kit (ADK) - optional.

This is the "host agent" exactly as named in the synopsis: an ADK LlmAgent whose
tools talk to the Orchestrator over A2A. It needs an LLM that supports tool
calling - both options below are FREE:

  * Gemini free tier  : set GOOGLE_API_KEY in .env  (get it at aistudio.google.com)
  * Ollama, local     : set NLU_MODE=ollama and OLLAMA_MODEL=qwen2.5:7b (or llama3.1:8b)
                        small models like llama3.2:3b are weak at tool calling.

Run (with the other agents already started by `python run_all.py`):
    cd adk_host
    adk web          # opens the ADK dev UI at http://127.0.0.1:8000 -> use --port 8080
    # or:  adk run citizen_concierge
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # project root

from google.adk.agents import Agent  # noqa: E402

from agents.concierge.core import call_orchestrator, render_status, skill_catalog  # noqa: E402
from common import config  # noqa: E402
from common.geocode import GeocoderUnavailable, geocode  # noqa: E402
from common.localities import normalise_locality  # noqa: E402


async def list_department_skills() -> dict:
    """Lists every issue type the municipal department agents can handle, discovered
    from their A2A Agent Cards. Call this first to know which issue_type ids exist.

    Returns:
        dict with 'skills': list of {issue_type, department, description}.
    """
    cat = await skill_catalog()
    return {"skills": [{"issue_type": s["id"], "department": s["_dept"],
                        "description": s["description"]} for s in cat]}


async def register_complaint(summary: str, location: str, issue_types: list[str],
                             urgency: str = "normal", landmark: str = "") -> dict:
    """Registers a citizen complaint with all responsible departments via the
    Orchestrator agent (A2A protocol).

    Args:
        summary: One-line English summary of the citizen's problem.
        location: Locality / area name, e.g. "Laxmi Nagar".
        issue_types: One or more issue_type ids from list_department_skills. Use
            several when the problem spans departments, e.g.
            ["excavation_damage", "water_pipe_burst"].
        urgency: "normal", "high" (lasting days / many affected) or "critical"
            (safety hazard: sparks, live wire, contamination, injury).
        landmark: Optional nearby landmark.

    Returns:
        dict with 'status_text' to relay to the citizen and the unified status.
    """
    cat = {s["id"]: s["_dept"] for s in await skill_catalog()}
    bad = [i for i in issue_types if i not in cat]
    if bad:
        return {"error": f"Unknown issue types {bad}. Call list_department_skills."}
    try:
        geo = await geocode(location)
    except GeocoderUnavailable:
        geo = None
    complaint = {
        "summary": summary, "location": geo["name"] if geo else normalise_locality(location) or location,
        "geo": geo,
        "landmark": landmark or None,
        "urgency": urgency if urgency in ("normal", "high", "critical") else "normal",
        "issues": [{"department": cat[i], "issue_type": i, "description": summary}
                   for i in dict.fromkeys(issue_types)],
        "nlu_mode": "adk-llm",
    }
    unified = await call_orchestrator(complaint)
    return {"status_text": render_status(unified), "unified_status": unified}


async def check_complaint_status(complaint_id: str) -> dict:
    """Gets the latest combined status of a complaint across all departments.

    Args:
        complaint_id: The id given at registration, e.g. "CMP-20261021-0001".

    Returns:
        dict with 'status_text' to relay to the citizen.
    """
    unified = await call_orchestrator({"action": "status", "complaint_id": complaint_id.upper()})
    return {"status_text": render_status(unified, new=False), "unified_status": unified}


def _model():
    if config.NLU_MODE == "ollama":
        from google.adk.models.lite_llm import LiteLlm
        return LiteLlm(model=f"ollama_chat/{config.OLLAMA_MODEL}",
                       api_base=config.OLLAMA_URL)
    return config.GEMINI_MODEL  # uses GOOGLE_API_KEY (free tier)


root_agent = Agent(
    name="citizen_concierge",
    model=_model(),
    description="Citizen-facing host agent for Delhi municipal grievances.",
    instruction="""You are Nagrik Sahayak, the Citizen Concierge for Delhi's municipal services.
Citizens describe water, electricity or road problems in English, Hindi or Hinglish.

1. Call list_department_skills once to learn the valid issue_type ids.
2. Work out ALL issue types involved. A single complaint often spans departments:
   "road digging broke the water pipe" = excavation_damage + water_pipe_burst.
3. If the locality is missing, ask the citizen for it before registering.
4. Call register_complaint, then relay its status_text to the citizen in simple,
   friendly language (reply in the citizen's language). Always give the complaint id
   and every ticket id.
5. For status questions call check_complaint_status with the complaint id.
Never invent ticket numbers - only report what the tools return.""",
    tools=[list_department_skills, register_complaint, check_complaint_status],
)

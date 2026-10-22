"""Central configuration. Every value can be overridden with an environment variable
(or a .env file in the project root)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_DIR = Path(os.getenv("DB_DIR", DATA_DIR / "db"))
DB_DIR.mkdir(parents=True, exist_ok=True)


def _load_dotenv():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()

HOST = os.getenv("HOST", "127.0.0.1")

PORTS = {
    "concierge": int(os.getenv("CONCIERGE_PORT", 8000)),
    "orchestrator": int(os.getenv("ORCHESTRATOR_PORT", 8001)),
    "water": int(os.getenv("WATER_PORT", 8101)),
    "electricity": int(os.getenv("ELECTRICITY_PORT", 8102)),
    "roads": int(os.getenv("ROADS_PORT", 8103)),
}


def url(name: str) -> str:
    return f"http://{HOST}:{PORTS[name]}"


ORCHESTRATOR_URL = os.getenv("ORCHESTRATOR_URL", url("orchestrator"))

# The orchestrator ONLY knows these base URLs. Everything else (names, skills,
# endpoints) is discovered from each agent's Agent Card. To add a new department,
# start its agent and append its URL here - no orchestrator code changes.
DOMAIN_AGENT_URLS = [u.strip() for u in os.getenv(
    "DOMAIN_AGENT_URLS",
    ",".join([url("water"), url("electricity"), url("roads")]),
).split(",") if u.strip()]

# ---- Language model for the Citizen Concierge ------------------------------
#   rules  : keyword/regex NLU. No API key, works offline.            (default)
#   ollama : free local LLM via Ollama (https://ollama.com)
#   gemini : Google Gemini free tier key from https://aistudio.google.com
NLU_MODE = os.getenv("NLU_MODE", "rules").lower()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Simulated processing delay of department back-ends (seconds), so the
# submitted -> working -> completed transitions are visible.
DEPT_DELAY = float(os.getenv("DEPT_DELAY", "0.6"))

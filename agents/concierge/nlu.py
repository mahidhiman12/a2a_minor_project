"""
Natural Language Understanding for the Citizen Concierge.

Turns a plain-language complaint into a structured complaint object:

    {"summary": "...", "location": "Laxmi Nagar", "landmark": "near metro station",
     "urgency": "normal|high|critical",
     "issues": [{"department": "roads", "issue_type": "excavation_damage", "description": "..."},
                {"department": "water", "issue_type": "water_pipe_burst",  "description": "..."}]}

Three interchangeable back-ends (choose with NLU_MODE in .env):
  rules  - weighted keyword / regex patterns (English + common Hinglish). FREE, offline.
  ollama - any local model served by Ollama (llama3.2, qwen2.5, mistral...). FREE, offline.
  gemini - Google Gemini via the free-tier AI Studio key. FREE (rate limited), online.
If an LLM call fails or returns invalid JSON we fall back to the rules engine,
so the system never stops working.
"""
from __future__ import annotations

import json
import logging
import re

import httpx

from common import config
from common.localities import LOCALITIES, normalise_locality

log = logging.getLogger("nlu")

# --------------------------------------------------------------------------
# Rules engine
# --------------------------------------------------------------------------
# issue_type -> (department, [regex patterns])
LEXICON: dict[str, tuple[str, list[str]]] = {
    # ---- water ----
    "water_pipe_burst": ("water", [
        r"pipe\w*\W+(?:\w+\W+){0,4}(burst|broke|broken|break|leak|damag|crack|ruptur|cut|toot)",
        r"(burst|broke|broken|break|leak\w*|damag\w*|crack\w*|ruptur\w*|cut|toot\w*)\W+(?:\w+\W+){0,4}(pipe\w*|water main|water line|main line)\b",
        r"water (is )?(gushing|flowing out|being wasted|wastage|spraying|fountain)", r"\bnal\w* (toot|phat)", r"paani (beh|bah)", r"water leak",
    ]),
    "water_no_supply": ("water", [
        r"no (piped |drinking )?water\b(?! ?log)", r"water (is )?not (coming|available)",
        r"water supply\W+(?:\w+\W+){0,3}(stop|cut|off|disrupt|not|no)",
        r"(stop|cut|off|disrupt|no)\w*\W+(?:\w+\W+){0,2}water supply", r"paani (nahi|nhi|nai) (aa|a )",
        r"dry tap", r"without water", r"taps? (are |is )?dry",
    ]),
    "water_contamination": ("water", [
        r"(dirty|muddy|brown|yellow|black|smelly|foul|contaminated|stinking|turbid|ganda|gandha) (tap |drinking |supply )?(water|paani)",
        r"water\W+(?:\w+\W+){0,4}(smell|stink|dirty|contaminat|muddy|brown|yellow|worms|sewage mixed)",
        r"sewage (is )?(mixed|mixing|getting mixed|in (the )?(drinking|tap) water)",
    ]),
    "water_low_pressure": ("water", [
        r"low (water )?pressure", r"pressure\W+(?:\w+\W+){0,3}(low|weak|very less)",
        r"water (comes|coming) (very )?(slow|thin|drop)",
    ]),
    "sewer_overflow": ("water", [
        r"sewer|sewage(?! mix)", r"manhole", r"(drain|naali|nali|gutter)\w*\W+(?:\w+\W+){0,3}(overflow|block|chok|clog|jam)",
        r"(overflow|block|chok|clog)\w*\W+(?:\w+\W+){0,3}(drain|naali|nali|gutter)",
    ]),
    # ---- electricity ----
    "power_outage": ("electricity", [
        r"no (electricity|power|current|bijli)\b", r"power (cut|outage|failure|gone|off|is out)",
        r"blackout", r"bijli\W+(?:\w+\W+){0,2}(nahi|nhi|gayi|gai|cut|chali)", r"light (nahi|nhi|gayi|chali)",
        r"electricity\W+(?:\w+\W+){0,3}(gone|cut|off|not|out|fail)", r"without (electricity|power)",
        r"(cut|lost|no)\W+(?:\w+\W+){0,2}power supply",
    ]),
    "electric_hazard": ("electricity", [
        r"spark", r"live wire", r"(naked|exposed|bare|loose|dangling) (electric |electricity )?(wire|cable)",
        r"electric(al)? shock", r"electrocut", r"current (lag|aa raha|maar)",
        r"(wire|taar)\w*\W+(?:\w+\W+){0,3}(hanging|fallen|fell|lying|touching)", r"pole\W+(?:\w+\W+){0,3}(current|shock)",
    ]),
    "cable_damage": ("electricity", [
        r"(electric|electricity|power|underground|feeder|hv|ht|bijli)\W+(?:\w+\W+){0,2}(cable|line|wire)\w*\W+(?:\w+\W+){0,4}(cut|damag|broke|snap|severed)",
        r"(cut|damag\w*|broke\w*|snap\w*|sever\w*)\W+(?:\w+\W+){0,4}(electric\w* |power |underground |feeder )?cable",
        r"cable\W+(?:\w+\W+){0,3}(cut|damag|broke|snap)",
        r"(cut|damag\w*|broke\w*|snap\w*|sever\w*)\W+(?:\w+\W+){0,3}(power|electric\w*|bijli|hv|ht) (line|cable|wire)",
    ]),
    "transformer_fault": ("electricity", [r"transformer"]),
    "voltage_fluctuation": ("electricity", [r"voltage", r"fluctuat"]),
    "streetlight_fault": ("electricity", [
        r"street ?lights?", r"street ?lamps?", r"lamp ?posts?",
    ]),
    # ---- roads ----
    "pothole": ("roads", [
        r"pot ?holes?", r"\bgaddh?a", r"crater", r"road\W+(?:\w+\W+){0,3}(broken|damaged|cracked|sunk|caved)",
        r"(broken|damaged|cracked) road", r"road (has )?caved",
    ]),
    "excavation_damage": ("roads", [
        r"\bdug\b", r"digging", r"excavat", r"trench", r"\bkhud", r"\bjcb\b",
        r"road (repair|work|construction|cutting)", r"(construction|metro|civic|repair) work",
        r"left (it )?(open|unfilled|uncovered)", r"open pit", r"(unfilled|uncovered) (pit|hole|trench)",
    ]),
    "waterlogging": ("roads", [
        r"water ?logg", r"water\W+(?:\w+\W+){0,3}(accumulat|stagnant|standing|collected)",
        r"(flooded|submerged) (road|street|lane|underpass)", r"(road|street|lane|underpass)\w*\W+(?:\w+\W+){0,4}(flood|submerg)",
        r"(road|street|lane)\w*\W+(?:\w+\W+){0,2}full of water",
        r"paani bhar",
    ]),
    "road_obstruction": ("roads", [
        r"debris", r"malba", r"(road|lane|street) (is )?blocked", r"block(ed|ing) the (road|lane|street)",
        r"(fallen|uprooted) tree", r"tree (fell|fallen|has fallen)",
        r"(construction )?material (dumped|lying)",
    ]),
    "footpath_damage": ("roads", [r"footpath", r"pavement", r"sidewalk", r"foot ?path"]),
}

CRITICAL_WORDS = [r"spark", r"shock", r"electrocut", r"fire", r"blast", r"explod", r"injur",
                  r"accident", r"fell into", r"(child|kid|baby|someone)\w* (fell|fall|hurt)",
                  r"contaminat", r"live wire", r"dangerous", r"danger\b", r"emergency"]
HIGH_WORDS = [r"urgent", r"since (\d+|two|three|four|five) days", r"for (\d+|two|three) days",
              r"\bdays\b", r"week", r"hospital", r"school", r"elderly", r"old (people|age)",
              r"since (yesterday|morning|last night)", r"whole (area|colony|street)", r"jaldi"]

LANDMARK_RX = re.compile(
    r"\b((?:near|opposite|opp\.?|behind|next to|in front of|outside)\s+(?:the\s+)?"
    r"[\w ]{2,40}?(?:metro station|metro|station|school|hospital|market|temple|mandir|"
    r"masjid|gurudwara|church|park|mall|chowk|bus stop|depot|gate|crossing|flyover|block|"
    r"sector \d+|pocket \w+))", re.I)
LOCATION_RX = re.compile(
    r"\b(?:in|at|near|of|from)\s+([A-Z][a-zA-Z]+(?:\s+(?:[A-Z][a-zA-Z]+|\d+))*"
    r"(?:\s+(?:Nagar|Vihar|Colony|Enclave|Extension|Bagh|Park|Puri|Pura))?)")


def _matches(text: str, patterns: list[str]) -> int:
    return sum(1 for p in patterns if re.search(p, text, re.I))


def extract_location(text: str) -> tuple[str | None, str | None]:
    loc = normalise_locality(text)
    lm = LANDMARK_RX.search(text)
    landmark = lm.group(1).strip() if lm else None
    if not loc:
        m = LOCATION_RX.search(text)
        if m and m.group(1).lower() not in {"the", "our", "my"}:
            loc = m.group(1).strip()
    return loc, landmark


def detect_urgency(text: str) -> str:
    if any(re.search(p, text, re.I) for p in CRITICAL_WORDS):
        return "critical"
    if any(re.search(p, text, re.I) for p in HIGH_WORDS):
        return "high"
    return "normal"


def rules_nlu(text: str, extra_skills: list[dict] | None = None) -> dict:
    t = " " + text.lower() + " "
    scores = {it: _matches(t, pats) for it, (_, pats) in LEXICON.items()}

    # --- disambiguation rules ---
    if scores["streetlight_fault"]:
        scores["power_outage"] = 0  # "street light not working" is not an area outage
    if scores["water_contamination"] and scores["sewer_overflow"] and not re.search(
            r"(overflow|block|manhole|chok|clog)", t):
        scores["sewer_overflow"] = 0  # "sewage mixed in water" is contamination
    if scores["water_contamination"] and scores["waterlogging"] and not re.search(
            r"tap|drink|supply|\bnal\b|coming|pipe", t):
        scores["water_contamination"] = 0  # dirty water standing on a road = waterlogging
    if scores["waterlogging"] and scores["water_pipe_burst"] == 0 and scores["water_no_supply"]:
        scores["water_no_supply"] = 0
    if scores["cable_damage"] and scores["electric_hazard"] and not re.search(r"spark|shock|live|expos|naked|danger", t):
        scores["electric_hazard"] = 0
    # excavation only counts as a roads issue if something was damaged or left open
    if scores["excavation_damage"] and not (
            any(scores[k] for k in ("water_pipe_burst", "cable_damage", "sewer_overflow",
                                    "power_outage", "water_no_supply", "pothole"))
            or re.search(r"left|open|unfilled|uncovered|pit|trench|dug|danger|week|days|month", t)):
        scores["excavation_damage"] = 0
    # a pothole caused by digging is reported as an unrestored excavation
    if scores["excavation_damage"] and scores["pothole"]:
        scores["pothole"] = 0

    issues = [{"department": LEXICON[it][0], "issue_type": it,
               "description": _describe(it, text)}
              for it, s in sorted(scores.items(), key=lambda kv: -kv[1]) if s > 0]

    # skills from newly discovered agents (not in the static lexicon): use card tags
    known = set(LEXICON)
    for sk in extra_skills or []:
        if sk["id"] in known:
            continue
        tags = [tg for tg in sk.get("tags", []) if tg != sk.get("_dept")]
        if any(re.search(rf"\b{re.escape(tg.lower())}", t) for tg in tags):
            issues.append({"department": sk.get("_dept"), "issue_type": sk["id"],
                           "description": _describe(sk["id"], text)})

    loc, landmark = extract_location(text)
    return {"summary": _summary(text), "location": loc, "landmark": landmark,
            "urgency": detect_urgency(t), "issues": issues, "nlu_mode": "rules"}


def _summary(text: str) -> str:
    s = re.sub(r"\s+", " ", text).strip()
    return s if len(s) <= 140 else s[:137] + "..."


def _describe(issue_type: str, text: str) -> str:
    return f"{issue_type.replace('_', ' ').capitalize()}: {_summary(text)}"


# --------------------------------------------------------------------------
# LLM engines (free: Ollama local, or Gemini free tier)
# --------------------------------------------------------------------------
def build_prompt(text: str, catalog: list[dict]) -> str:
    lines = "\n".join(f'- "{s["id"]}" (department: {s["_dept"]}): {s["description"]}'
                      for s in catalog)
    return f"""You are the intake officer of a Delhi municipal grievance system.
Extract a structured complaint from the citizen message below.

Allowed issue types (use ONLY these ids):
{lines}

Rules:
- A complaint may involve MORE THAN ONE department. Example: "road digging broke the
  water pipe" -> excavation_damage (roads) AND water_pipe_burst (water).
- If the damage was caused by digging/excavation/road work, ALSO include excavation_damage.
- urgency: "critical" for safety hazards (sparks, live wires, contamination, injuries, fire),
  "high" if it has lasted days or affects many people/schools/hospitals, else "normal".
- location: the locality / area name only (e.g. "Laxmi Nagar"), or null if not given.
- landmark: nearby landmark phrase if mentioned, else null.
- Known localities: {", ".join(LOCALITIES)}.
- The message may be in English, Hindi or Hinglish.

Return ONLY JSON of this form:
{{"summary": "one line summary in English",
  "location": "string or null", "landmark": "string or null",
  "urgency": "normal|high|critical",
  "issues": [{{"department": "water|electricity|roads|...", "issue_type": "<allowed id>",
              "description": "short description of this department's part"}}]}}

Citizen message: \"\"\"{text}\"\"\""""


def _validate(raw: dict, catalog: list[dict], text: str, mode: str) -> dict:
    valid = {s["id"]: s["_dept"] for s in catalog}
    issues, seen = [], set()
    for i in raw.get("issues") or []:
        it = i.get("issue_type")
        if it in valid and it not in seen:
            seen.add(it)
            issues.append({"department": valid[it], "issue_type": it,
                           "description": i.get("description") or _describe(it, text)})
    loc = raw.get("location")
    loc = normalise_locality(loc) or loc if loc and str(loc).lower() not in ("null", "none", "") else None
    if not loc:
        loc, _ = extract_location(text)
    urgency = raw.get("urgency") if raw.get("urgency") in ("normal", "high", "critical") else detect_urgency(text)
    return {"summary": raw.get("summary") or _summary(text), "location": loc,
            "landmark": raw.get("landmark") or None, "urgency": urgency,
            "issues": issues, "nlu_mode": mode}


def _parse_json(s: str) -> dict:
    s = s.strip()
    m = re.search(r"\{.*\}", s, re.S)
    return json.loads(m.group(0) if m else s)


async def ollama_nlu(text: str, catalog: list[dict]) -> dict:
    async with httpx.AsyncClient(timeout=120) as h:
        r = await h.post(f"{config.OLLAMA_URL}/api/chat", json={
            "model": config.OLLAMA_MODEL, "stream": False, "format": "json",
            "options": {"temperature": 0},
            "messages": [{"role": "user", "content": build_prompt(text, catalog)}]})
        r.raise_for_status()
        return _validate(_parse_json(r.json()["message"]["content"]), catalog, text,
                         f"ollama:{config.OLLAMA_MODEL}")


async def gemini_nlu(text: str, catalog: list[dict]) -> dict:
    if not config.GEMINI_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY not set")
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{config.GEMINI_MODEL}:generateContent")
    async with httpx.AsyncClient(timeout=60) as h:
        r = await h.post(url, params={"key": config.GEMINI_API_KEY}, json={
            "contents": [{"parts": [{"text": build_prompt(text, catalog)}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}})
        r.raise_for_status()
        out = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        return _validate(_parse_json(out), catalog, text, f"gemini:{config.GEMINI_MODEL}")


async def understand(text: str, catalog: list[dict], mode: str | None = None) -> dict:
    """catalog = skills discovered from department Agent Cards, each with '_dept'."""
    mode = (mode or config.NLU_MODE).lower()
    try:
        if mode == "ollama":
            res = await ollama_nlu(text, catalog)
        elif mode == "gemini":
            res = await gemini_nlu(text, catalog)
        else:
            return rules_nlu(text, catalog)
        if not res["issues"]:  # LLM found nothing: let rules have a go
            rb = rules_nlu(text, catalog)
            if rb["issues"]:
                res["issues"] = rb["issues"]
                res["nlu_mode"] += "+rules"
        return res
    except Exception as e:
        log.warning("LLM NLU (%s) failed, falling back to rules: %s", mode, e)
        res = rules_nlu(text, catalog)
        res["nlu_mode"] = f"rules (fallback: {mode} unavailable)"
        return res

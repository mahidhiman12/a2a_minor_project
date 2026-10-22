"""List the Gemini models your GOOGLE_API_KEY can use for text generation.

    python docs/list_gemini_models.py

Put one of the printed names in .env as GEMINI_MODEL=... (without the "models/" prefix).
The key is read from .env and sent in a header; it is never printed.
"""
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import config  # noqa: E402

if not config.GEMINI_API_KEY:
    sys.exit("GOOGLE_API_KEY is not set in .env")

r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
              headers={"x-goog-api-key": config.GEMINI_API_KEY}, params={"pageSize": 200}, timeout=20)
if r.status_code != 200:
    sys.exit(f"HTTP {r.status_code}: {r.text[:300]}")
for m in r.json().get("models", []):
    if "generateContent" in m.get("supportedGenerationMethods", []):
        print(f"{m['name'].removeprefix('models/'):<45} {m.get('displayName', '')}")

"""Simulated geography: Delhi localities mapped to districts (used for zone offices)."""
from __future__ import annotations

import difflib
import re

LOCALITIES = {
    "Shastri Park": "Shahdara", "Seelampur": "Shahdara", "Shahdara": "Shahdara",
    "Yamuna Vihar": "Shahdara", "Laxmi Nagar": "East", "Preet Vihar": "East",
    "Mayur Vihar": "East", "Karol Bagh": "Central", "Chandni Chowk": "Central",
    "Connaught Place": "New Delhi", "Lajpat Nagar": "South East", "Kalkaji": "South East",
    "Okhla": "South East", "Saket": "South", "Vasant Kunj": "South West",
    "Dwarka": "South West", "Janakpuri": "West", "Uttam Nagar": "West",
    "Rohini": "North West", "Pitampura": "North West",
}

ALIASES = {
    "cp": "Connaught Place", "connaught": "Connaught Place", "laxminagar": "Laxmi Nagar",
    "lakshmi nagar": "Laxmi Nagar", "mayur vihar phase 1": "Mayur Vihar",
    "chandni chowk market": "Chandni Chowk", "vasant kunj sector": "Vasant Kunj",
}

_LOWER = {k.lower(): k for k in LOCALITIES}


def normalise_locality(text: str | None) -> str | None:
    """Map free text ('near laxmi nagar metro') to a canonical locality name."""
    if not text:
        return None
    t = text.lower()
    for alias, canon in ALIASES.items():
        if re.search(rf"\b{re.escape(alias)}\b", t):
            return canon
    for low, canon in _LOWER.items():
        if low in t:
            return canon
    # fuzzy match each 1-3 word window (handles small typos like 'Laxmi Nagr')
    words = re.findall(r"[a-z]+", t)
    for n in (2, 3, 1):
        for i in range(len(words) - n + 1):
            cand = " ".join(words[i:i + n])
            m = difflib.get_close_matches(cand, _LOWER.keys(), n=1, cutoff=0.85)
            if m:
                return _LOWER[m[0]]
    return None

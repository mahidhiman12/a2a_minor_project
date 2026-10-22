"""Simulated geography: Delhi localities mapped to districts (used for zone offices)."""
from __future__ import annotations

import difflib
import math
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

# Approximate centre of each locality (lat, lng), used by the complaint heatmap.
LOCALITY_COORDS = {
    "Shastri Park": (28.6687, 77.2510), "Seelampur": (28.6667, 77.2700),
    "Shahdara": (28.6735, 77.2894), "Yamuna Vihar": (28.6970, 77.2780),
    "Laxmi Nagar": (28.6304, 77.2773), "Preet Vihar": (28.6415, 77.2950),
    "Mayur Vihar": (28.6040, 77.2940), "Karol Bagh": (28.6519, 77.1909),
    "Chandni Chowk": (28.6506, 77.2303), "Connaught Place": (28.6315, 77.2167),
    "Lajpat Nagar": (28.5677, 77.2433), "Kalkaji": (28.5494, 77.2588),
    "Okhla": (28.5355, 77.2710), "Saket": (28.5245, 77.2066),
    "Vasant Kunj": (28.5293, 77.1517), "Dwarka": (28.5921, 77.0460),
    "Janakpuri": (28.6219, 77.0878), "Uttam Nagar": (28.6217, 77.0550),
    "Rohini": (28.7495, 77.0565), "Pitampura": (28.7031, 77.1316),
}

ALIASES = {
    "cp": "Connaught Place", "connaught": "Connaught Place", "laxminagar": "Laxmi Nagar",
    "lakshmi nagar": "Laxmi Nagar", "mayur vihar phase 1": "Mayur Vihar",
    "chandni chowk market": "Chandni Chowk", "vasant kunj sector": "Vasant Kunj",
}

_LOWER = {k.lower(): k for k in LOCALITIES}


def nearest_locality(lat: float, lng: float) -> tuple[str, float]:
    """Closest built-in locality to a point, with the distance in km (haversine)."""
    def km(a, b):
        la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
        h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        return 6371 * 2 * math.asin(math.sqrt(h))
    return min(((loc, km((lat, lng), xy)) for loc, xy in LOCALITY_COORDS.items()), key=lambda t: t[1])


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

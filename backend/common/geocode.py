"""
Free geocoding with OpenStreetMap Nominatim (no API key).

Turns any place name the citizen types ("Rajouri Garden", "near Kamla Nagar market")
into coordinates inside Delhi. Nominatim's usage policy asks for at most 1 request
per second and an identifying User-Agent, so every answer is cached in SQLite and
calls are spaced out. https://operations.osmfoundation.org/policies/nominatim/

Known localities (common/localities.py) never hit the network.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import time

import httpx

from common import config
from common.localities import LOCALITY_COORDS, normalise_locality

DELHI_VIEWBOX = "76.84,28.88,77.35,28.40"   # lon/lat of the NW and SE corners
_DB = config.DB_DIR / "geocode.db"
_lock = asyncio.Lock()
_last_call = 0.0


class GeocoderUnavailable(Exception):
    """Geocoding is switched off or Nominatim could not be reached."""


def _db():
    c = sqlite3.connect(_DB)
    c.execute("CREATE TABLE IF NOT EXISTS geocache(query TEXT PRIMARY KEY, result TEXT, ts REAL)")
    return c


def _key(name: str) -> str:
    return " ".join(name.lower().split())


async def geocode(name: str | None) -> dict | None:
    """Returns {"name", "lat", "lng", "display", "source"} or None if the place was not
    found in Delhi. Raises GeocoderUnavailable when it cannot look the place up."""
    if not name or not name.strip():
        return None
    known = normalise_locality(name)
    if known in LOCALITY_COORDS:
        lat, lng = LOCALITY_COORDS[known]
        return {"name": known, "lat": lat, "lng": lng, "display": f"{known}, Delhi",
                "source": "builtin"}
    if config.GEOCODER != "nominatim":
        raise GeocoderUnavailable("geocoding disabled (GEOCODER=off)")

    key = _key(name)
    with _db() as c:
        row = c.execute("SELECT result FROM geocache WHERE query=?", (key,)).fetchone()
    if row:
        return json.loads(row[0])

    global _last_call
    async with _lock:  # one request at a time, at least 1 s apart
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        params = {"q": f"{name}, Delhi", "format": "jsonv2", "limit": 1, "countrycodes": "in",
                  "viewbox": DELHI_VIEWBOX, "bounded": 1}
        if config.NOMINATIM_EMAIL:
            params["email"] = config.NOMINATIM_EMAIL
        try:
            async with httpx.AsyncClient(timeout=8, headers={"User-Agent": config.GEOCODER_USER_AGENT}) as h:
                r = await h.get(f"{config.NOMINATIM_URL}/search", params=params)
                r.raise_for_status()
                hits = r.json()
        except Exception as e:
            raise GeocoderUnavailable(str(e)) from e
        finally:
            _last_call = time.monotonic()

    result = None
    if hits:
        hit = hits[0]
        # keep the citizen's wording as the name; OSM may return e.g. "Rajouri Garden (Blue Line)"
        result = {"name": " ".join(name.split()).title(), "lat": float(hit["lat"]),
                  "lng": float(hit["lon"]), "display": hit.get("display_name", ""),
                  "osm_name": hit.get("name"), "source": "nominatim"}
    with _db() as c:  # cache misses too, so a bad name is not looked up again
        c.execute("INSERT OR REPLACE INTO geocache VALUES(?,?,?)", (key, json.dumps(result), time.time()))
    return result

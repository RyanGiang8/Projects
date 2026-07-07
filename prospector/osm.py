"""Keyless lead discovery via OpenStreetMap — no API key, no billing.

Two free public services:
  1. Nominatim geocodes the area string to a bounding box (1 req/s fair use).
  2. Overpass API returns businesses inside that box matching the niche,
     found by curated OSM tags plus a name-keyword match.

Both require nothing but an honest User-Agent. Responses are cached in
cache/osm/ for 7 days, same as the Places cache.
"""

import hashlib
import json
import re
import time
from pathlib import Path

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "LeadProspector/1.0 (local web-services lead research)"
CACHE_TTL_SECONDS = 7 * 24 * 3600
MAX_ELEMENTS = 200

# Curated niche -> OSM tag mapping. The name-keyword clause below catches
# anything the mapping misses.
NICHE_TAGS: dict[str, list[tuple[str, str]]] = {
    "auto detailing": [("shop", "car_repair"), ("amenity", "car_wash")],
    "detailing": [("shop", "car_repair"), ("amenity", "car_wash")],
    "mechanic": [("shop", "car_repair")],
    "auto repair": [("shop", "car_repair")],
    "landscaping": [("craft", "gardener")],
    "lawn care": [("craft", "gardener")],
    "plumber": [("craft", "plumber")],
    "plumbing": [("craft", "plumber")],
    "electrician": [("craft", "electrician")],
    "roofing": [("craft", "roofer")],
    "roofer": [("craft", "roofer")],
    "hvac": [("craft", "hvac")],
    "painter": [("craft", "painter")],
    "painting": [("craft", "painter")],
    "carpenter": [("craft", "carpenter")],
    "barber": [("shop", "hairdresser")],
    "hair salon": [("shop", "hairdresser")],
    "salon": [("shop", "beauty"), ("shop", "hairdresser")],
    "nail salon": [("shop", "beauty")],
    "cleaning": [("shop", "laundry")],
    "dry cleaning": [("shop", "dry_cleaning")],
    "pet grooming": [("shop", "pet_grooming")],
    "bakery": [("shop", "bakery")],
    "butcher": [("shop", "butcher")],
    "florist": [("shop", "florist")],
    "tattoo": [("shop", "tattoo")],
    "massage": [("shop", "massage")],
    "moving": [("office", "moving_company")],
    "towing": [("service", "vehicle:towing")],
}


class OSMError(Exception):
    """Raised for geocoding/Overpass failures with an actionable message."""


def _cache_path(cache_dir: Path, kind: str, key: str) -> Path:
    digest = hashlib.sha256(key.encode()).hexdigest()[:16]
    return cache_dir / "osm" / f"{kind}_{digest}.json"


def _cached(path: Path) -> dict | None:
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if time.time() - data.get("fetched_at", 0) < CACHE_TTL_SECONDS:
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return None


def _store(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload["fetched_at"] = time.time()
    path.write_text(json.dumps(payload))


def geocode_area(area: str, cache_dir: Path, session: requests.Session | None = None) -> tuple[dict, int]:
    """Return ({south, west, north, east, display_name}, requests_made)."""
    cache_file = _cache_path(cache_dir, "geocode", area.lower())
    cached = _cached(cache_file)
    if cached:
        return cached["bbox"], 0

    sess = session or requests.Session()
    try:
        resp = sess.get(
            NOMINATIM_URL,
            params={"q": area, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise OSMError(f"Could not reach Nominatim geocoder: {exc}") from exc
    if resp.status_code != 200:
        raise OSMError(f"Nominatim returned HTTP {resp.status_code} for '{area}'.")
    results = resp.json()
    if not results:
        raise OSMError(
            f"Nominatim could not find '{area}'. Try a broader or more standard "
            f'spelling, e.g. "Kanata, Ottawa, Ontario".'
        )
    # Nominatim boundingbox order: [south, north, west, east]
    bb = results[0]["boundingbox"]
    bbox = {
        "south": float(bb[0]),
        "north": float(bb[1]),
        "west": float(bb[2]),
        "east": float(bb[3]),
        "display_name": results[0].get("display_name", area),
    }
    _store(cache_file, {"bbox": bbox})
    return bbox, 1


def _niche_clauses(niche: str, bbox_expr: str) -> list[str]:
    clauses = []
    key = niche.lower().strip()
    tags = NICHE_TAGS.get(key, [])
    if not tags:  # try substring match against the mapping ("mobile detailing" -> "detailing")
        for known, mapped in NICHE_TAGS.items():
            if known in key:
                tags = mapped
                break
    for tag_key, tag_value in tags:
        clauses.append(f'nwr["{tag_key}"="{tag_value}"]{bbox_expr};')
    # Always include a name-keyword match; escape regex metacharacters.
    keyword = re.escape(key.split()[0] if len(key.split()) == 1 else key)
    clauses.append(f'nwr["name"~"{keyword}",i]{bbox_expr};')
    return clauses


def build_query(niche: str, bbox: dict) -> str:
    bbox_expr = f"({bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']})"
    clauses = "\n  ".join(_niche_clauses(niche, bbox_expr))
    return (
        f"[out:json][timeout:60];\n(\n  {clauses}\n);\nout center tags {MAX_ELEMENTS};"
    )


def _assemble_address(tags: dict) -> str:
    parts = [
        " ".join(p for p in (tags.get("addr:housenumber"), tags.get("addr:street")) if p),
        tags.get("addr:city"),
        tags.get("addr:province") or tags.get("addr:state"),
        tags.get("addr:postcode"),
    ]
    return ", ".join(p for p in parts if p)


def normalize_element(element: dict) -> dict | None:
    """Map an Overpass element to the shared lead dict. None if unusable."""
    tags = element.get("tags", {})
    name = tags.get("name", "").strip()
    if not name:
        return None
    if any(k.startswith(("disused", "abandoned", "was:")) for k in tags):
        status = "CLOSED_PERMANENTLY"
    else:
        status = "OPERATIONAL"
    osm_type = element.get("type", "node")
    osm_id = element.get("id", 0)
    return {
        "place_id": f"osm_{osm_type}_{osm_id}",
        "name": name,
        "address": _assemble_address(tags),
        "phone": tags.get("phone") or tags.get("contact:phone") or "",
        "website": tags.get("website") or tags.get("contact:website") or "",
        "rating": None,          # OSM has no ratings
        "review_count": 0,
        "maps_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
        "business_status": status,
        "has_hours": bool(tags.get("opening_hours")),
    }


def fetch_places_osm(
    niche: str,
    area: str,
    cache_dir: Path,
    max_results: int = 60,
    refresh: bool = False,
    session: requests.Session | None = None,
) -> tuple[list[dict], int]:
    """Return (leads, http_requests_made). Fully keyless."""
    cache_file = _cache_path(cache_dir, "overpass", f"{niche.lower()}|{area.lower()}")
    if not refresh:
        cached = _cached(cache_file)
        if cached:
            leads = [l for l in map(normalize_element, cached["elements"]) if l]
            return leads[:max_results], 0

    sess = session or requests.Session()
    bbox, geo_requests = geocode_area(area, cache_dir, session=sess)
    if geo_requests:
        time.sleep(1)  # Nominatim fair-use: 1 request/second

    query = build_query(niche, bbox)
    try:
        resp = sess.post(
            OVERPASS_URL,
            data={"data": query},
            headers={"User-Agent": USER_AGENT},
            timeout=90,
        )
    except requests.RequestException as exc:
        raise OSMError(f"Could not reach the Overpass API: {exc}") from exc
    if resp.status_code == 429:
        raise OSMError(
            "Overpass API is rate-limiting (429). It's a shared free service - "
            "wait a minute and retry, or use the cached results."
        )
    if resp.status_code != 200:
        raise OSMError(f"Overpass API returned HTTP {resp.status_code}: {resp.text[:200]}")
    elements = resp.json().get("elements", [])

    # Dedupe: same business often appears as node + way, or across clauses.
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    unique_elements = []
    for el in elements:
        lead = normalize_element(el)
        if lead is None:
            continue
        name_key = re.sub(r"\W+", "", lead["name"].lower())
        if lead["place_id"] in seen_ids or name_key in seen_names:
            continue
        seen_ids.add(lead["place_id"])
        seen_names.add(name_key)
        unique_elements.append(el)

    _store(cache_file, {"query": query, "elements": unique_elements})
    leads = [l for l in map(normalize_element, unique_elements) if l]
    return leads[:max_results], geo_requests + 1


def estimate_requests(niche: str, area: str, cache_dir: Path) -> int:
    """HTTP requests this run would make (0 if both caches are fresh)."""
    n = 0
    if _cached(_cache_path(cache_dir, "overpass", f"{niche.lower()}|{area.lower()}")) is None:
        n += 1
        if _cached(_cache_path(cache_dir, "geocode", area.lower())) is None:
            n += 1
    return n

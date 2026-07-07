"""Google Places API (New) text search with local JSON caching.

Uses places:searchText with a field mask that returns contact + rating fields
directly, so no separate Place Details calls are needed. One run costs at most
ceil(max_results / 20) requests (3 for the default 60), and cached searches
cost zero.
"""

import hashlib
import json
import re
import time
from pathlib import Path

import requests

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.businessStatus",
        "nextPageToken",
    ]
)
PAGE_SIZE = 20
SEARCH_CACHE_TTL_SECONDS = 7 * 24 * 3600


class PlacesError(Exception):
    """Raised for auth/quota/request failures with a user-actionable message."""


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def search_cache_path(cache_dir: Path, niche: str, area: str) -> Path:
    key = hashlib.sha256(f"{niche}|{area}".encode()).hexdigest()[:12]
    return cache_dir / "searches" / f"{_slug(niche)}_{_slug(area)}_{key}.json"


def place_cache_path(cache_dir: Path, place_id: str) -> Path:
    return cache_dir / "places" / f"{place_id}.json"


def normalize_place(raw: dict) -> dict:
    """Flatten a Places API (New) place object into the lead dict we work with."""
    return {
        "place_id": raw.get("id", ""),
        "name": (raw.get("displayName") or {}).get("text", ""),
        "address": raw.get("formattedAddress", ""),
        "phone": raw.get("nationalPhoneNumber")
        or raw.get("internationalPhoneNumber")
        or "",
        "website": raw.get("websiteUri", "") or "",
        "rating": raw.get("rating"),
        "review_count": raw.get("userRatingCount", 0) or 0,
        "maps_url": raw.get("googleMapsUri", ""),
        "business_status": raw.get("businessStatus", ""),
    }


def estimate_search_requests(niche: str, area: str, cache_dir: Path, max_results: int) -> int:
    """Requests this run would make: 0 if the search is freshly cached."""
    path = search_cache_path(cache_dir, niche, area)
    if path.exists():
        try:
            cached = json.loads(path.read_text())
            if time.time() - cached.get("fetched_at", 0) < SEARCH_CACHE_TTL_SECONDS:
                return 0
        except (json.JSONDecodeError, OSError):
            pass
    return -(-max_results // PAGE_SIZE)  # ceil division


def _raise_for_api_error(resp: requests.Response) -> None:
    try:
        detail = resp.json().get("error", {}).get("message", resp.text[:300])
    except ValueError:
        detail = resp.text[:300]
    if resp.status_code in (401, 403):
        raise PlacesError(
            "Google Places API rejected the request (auth). Check that "
            "GOOGLE_PLACES_API_KEY in .env is correct and that 'Places API (New)' "
            f"is enabled for the key's project. Details: {detail}"
        )
    if resp.status_code == 429:
        raise PlacesError(
            "Google Places API quota exceeded (429). Wait for the quota window to "
            f"reset or check billing/quota in the Cloud Console. Details: {detail}"
        )
    raise PlacesError(f"Google Places API error {resp.status_code}: {detail}")


def fetch_places(
    niche: str,
    area: str,
    api_key: str,
    cache_dir: Path,
    max_results: int = 60,
    refresh: bool = False,
    session: requests.Session | None = None,
) -> tuple[list[dict], int]:
    """Return (leads, api_requests_made). Serves from cache when fresh."""
    cache_file = search_cache_path(cache_dir, niche, area)
    if not refresh and cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text())
            if time.time() - cached.get("fetched_at", 0) < SEARCH_CACHE_TTL_SECONDS:
                leads = []
                for pid in cached["place_ids"]:
                    ppath = place_cache_path(cache_dir, pid)
                    if ppath.exists():
                        leads.append(normalize_place(json.loads(ppath.read_text())))
                if leads:
                    return leads, 0
        except (json.JSONDecodeError, OSError, KeyError):
            pass  # corrupt cache: refetch

    sess = session or requests.Session()
    query = f"{niche} in {area}"
    raw_places: list[dict] = []
    page_token = None
    requests_made = 0

    while len(raw_places) < max_results:
        body = {"textQuery": query, "pageSize": PAGE_SIZE}
        if page_token:
            body["pageToken"] = page_token
        resp = sess.post(
            SEARCH_URL,
            json=body,
            headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELD_MASK},
            timeout=15,
        )
        requests_made += 1
        if resp.status_code != 200:
            _raise_for_api_error(resp)
        data = resp.json()
        raw_places.extend(data.get("places", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
        time.sleep(1)  # nextPageToken needs a moment to become valid

    # Dedupe by place id, cache raw responses per place.
    seen: set[str] = set()
    leads = []
    place_ids = []
    (cache_dir / "places").mkdir(parents=True, exist_ok=True)
    for raw in raw_places[:max_results]:
        pid = raw.get("id", "")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        place_cache_path(cache_dir, pid).write_text(json.dumps(raw, indent=2))
        place_ids.append(pid)
        leads.append(normalize_place(raw))

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps({"query": query, "fetched_at": time.time(), "place_ids": place_ids})
    )
    return leads, requests_made

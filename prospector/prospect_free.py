#!/usr/bin/env python3
"""Keyless lead prospector — no API keys, no billing, nothing to sign up for.

Same pipeline as prospect.py with two swaps:
  Step 1: OpenStreetMap (Nominatim + Overpass) instead of Google Places
  Step 4: deterministic template pitches instead of an Anthropic call

Usage:
    python prospect_free.py --niche "auto detailing" --area "Kanata, Ottawa"
    python prospect_free.py --niche "plumber" --area "Barrhaven, Ottawa" --dry-run
    python prospect_free.py --niche "auto detailing" --area "Kanata, Ottawa" --mock
"""

import argparse
import json
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent

from osm import OSMError, estimate_requests, fetch_places_osm, normalize_element
from webcheck import LiveFetcher, check_website
from scoring import describe_issues, score_lead_keyless
from pitch_templates import generate_pitches_offline
from output import print_summary, write_csv
from prospect import MockFetcher, load_exclusions

CRAWL_DELAY_SECONDS = 1.5


def load_mock_osm(mock_dir: Path) -> list[dict]:
    raw = json.loads((mock_dir / "osm_places.json").read_text())
    return [l for l in map(normalize_element, raw["elements"]) if l]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find local businesses that need a (better) website - no API keys required."
    )
    parser.add_argument("--niche", required=True, help='e.g. "auto detailing"')
    parser.add_argument("--area", required=True, help='e.g. "Kanata, Ottawa"')
    parser.add_argument("--max-results", type=int, default=60)
    parser.add_argument("--min-score", type=int, default=6, help="pitch threshold (default 6)")
    parser.add_argument("--dry-run", action="store_true", help="estimate requests and exit")
    parser.add_argument("--mock", action="store_true", help="run offline on mock_data/")
    parser.add_argument("--refresh", action="store_true", help="ignore the 7-day cache")
    parser.add_argument("--contacted", default="contacted.csv")
    args = parser.parse_args()

    cache_dir = PROJECT_DIR / "cache"
    exclusions = load_exclusions(PROJECT_DIR / args.contacted)

    if args.dry_run:
        n = estimate_requests(args.niche, args.area, cache_dir)
        print(f"Dry run for '{args.niche}' in '{args.area}' (keyless/OSM mode):")
        if n == 0:
            print("  0 requests - geocode and business search are cached and fresh.")
        else:
            print(f"  {n} free HTTP request(s): Nominatim geocode + Overpass business search.")
        print("  0 paid API calls. No keys, no quota, no billing - ever.")
        return 0

    # ---- Step 1: fetch leads from OpenStreetMap ---------------------------
    requests_made = 0
    if args.mock:
        print("MOCK MODE - using mock_data/, no network calls.")
        leads = load_mock_osm(PROJECT_DIR / "mock_data")
        sites = json.loads((PROJECT_DIR / "mock_data" / "sites.json").read_text())
        fetcher = MockFetcher(sites)
    else:
        try:
            leads, requests_made = fetch_places_osm(
                args.niche, args.area, cache_dir,
                max_results=args.max_results, refresh=args.refresh,
            )
        except OSMError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        fetcher = LiveFetcher()

    found = len(leads)
    print(f"Found {found} businesses for '{args.niche}' in '{args.area}' "
          f"via OpenStreetMap ({requests_made} request(s), rest from cache).")
    if found == 0:
        print("Tip: OSM coverage varies by area and niche. Try a broader area "
              "(e.g. just 'Ottawa'), a simpler niche keyword, or the Google-"
              "backed prospect.py for denser coverage.")
        return 0

    kept = [
        l for l in leads
        if l["name"].lower() not in exclusions and l["place_id"].lower() not in exclusions
    ]
    excluded = found - len(kept)

    # ---- Steps 2+3: website checks and scoring ----------------------------
    scored: list[dict] = []
    disqualified = 0
    with_sites = sum(1 for l in kept if l["website"])
    print(f"Checking {with_sites} websites (~{CRAWL_DELAY_SECONDS}s between requests)...")
    for i, lead in enumerate(kept):
        issues: list[str] = []
        if lead["website"]:
            result = check_website(lead["website"], fetcher)
            issues = result.issues
            if not args.mock and i < len(kept) - 1:
                time.sleep(CRAWL_DELAY_SECONDS)
        score = score_lead_keyless(lead, issues)
        if score is None:
            disqualified += 1
            continue
        lead["score"] = score
        lead["issues_found"] = describe_issues(lead, issues)
        lead["_issue_codes"] = issues
        scored.append(lead)

    # ---- Step 4: template pitch angles (no AI) -----------------------------
    qualifying = [l for l in scored if l["score"] >= args.min_score]
    pitches = generate_pitches_offline(qualifying, args.area)
    for lead in scored:
        lead["pitch_angle"] = pitches.get(lead["place_id"], "")

    # ---- Step 5: output ----------------------------------------------------
    csv_path = write_csv(scored, PROJECT_DIR, stem="leads_scored_free")
    print_summary(found, excluded, disqualified, scored, args.min_score, csv_path, requests_made)
    print("  (keyless mode: 'no website' means none listed on OpenStreetMap - "
        "spot-check top leads with a quick Google search before pitching)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

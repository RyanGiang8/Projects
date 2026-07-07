#!/usr/bin/env python3
"""Lead prospector for a local web-services business.

Usage:
    python prospect.py --niche "auto detailing" --area "Kanata, Ottawa"
    python prospect.py --niche "mechanics" --area "Barrhaven, Ottawa" --dry-run
    python prospect.py --niche "auto detailing" --area "Kanata, Ottawa" --mock
"""

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent

from places import PlacesError, estimate_search_requests, fetch_places, normalize_place
from webcheck import FetchResult, LiveFetcher, check_website
from scoring import describe_issues, score_lead
from pitch import generate_pitches
from output import print_summary, write_csv

CRAWL_DELAY_SECONDS = 1.5


def load_env(path: Path) -> None:
    """Minimal .env loader; python-dotenv is used if available."""
    try:
        from dotenv import load_dotenv

        load_dotenv(path)
        return
    except ImportError:
        pass
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def load_exclusions(path: Path) -> set[str]:
    """One business name or place_id per line; lines starting with # ignored."""
    if not path.exists():
        return set()
    entries = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        # tolerate CSV rows too: first cell wins
        cell = next(iter(csv.reader([line])), [""])
        value = (cell[0] if cell else "").strip()
        if value and not value.startswith("#"):
            entries.add(value.lower())
    return entries


class MockFetcher:
    """Serves canned responses from mock_data/sites.json — no network."""

    def __init__(self, sites: dict):
        self.sites = sites

    def fetch(self, url: str) -> FetchResult:
        entry = self.sites.get(url)
        if entry is None:
            return FetchResult(final_url=url, error="dns")
        return FetchResult(
            final_url=entry.get("final_url", url),
            status=entry.get("status", 200),
            content=entry.get("html", "").encode(),
            elapsed=entry.get("elapsed", 0.5),
            error=entry.get("error", ""),
        )


def load_mock_places(mock_dir: Path) -> list[dict]:
    raw = json.loads((mock_dir / "places.json").read_text())
    return [normalize_place(p) for p in raw["places"]]


def main() -> int:
    parser = argparse.ArgumentParser(description="Find local businesses that need a (better) website.")
    parser.add_argument("--niche", required=True, help='e.g. "auto detailing"')
    parser.add_argument("--area", required=True, help='e.g. "Kanata, Ottawa"')
    parser.add_argument("--max-results", type=int, default=60, help="max leads to fetch (default 60)")
    parser.add_argument("--min-score", type=int, default=6, help="pitch-angle threshold (default 6)")
    parser.add_argument("--dry-run", action="store_true", help="estimate API calls and exit — spends no quota")
    parser.add_argument("--mock", action="store_true", help="run the full pipeline on mock_data/ — no network, no keys")
    parser.add_argument("--refresh", action="store_true", help="ignore cached search results and refetch")
    parser.add_argument("--contacted", default="contacted.csv", help="exclusion file (default contacted.csv)")
    args = parser.parse_args()

    load_env(PROJECT_DIR / ".env")
    cache_dir = PROJECT_DIR / "cache"
    exclusions = load_exclusions(PROJECT_DIR / args.contacted)

    # ---- Dry run: report the cost, spend nothing -------------------------
    if args.dry_run:
        n = estimate_search_requests(args.niche, args.area, cache_dir, args.max_results)
        print(f"Dry run for '{args.niche}' in '{args.area}':")
        if n == 0:
            print("  0 Google Places API requests (search is cached and fresh).")
        else:
            print(f"  {n} Google Places API text-search request(s) "
                  f"(~{args.max_results} results at 20/page).")
            print("  0 Place Details requests (the New Places API returns contact "
                  "fields in the search response).")
        print("  1 Anthropic API request if any lead scores >= "
              f"{args.min_score} and ANTHROPIC_API_KEY is set.")
        return 0

    # ---- Step 1: fetch leads ---------------------------------------------
    api_requests = 0
    if args.mock:
        print("MOCK MODE - using mock_data/, no network calls.")
        leads = load_mock_places(PROJECT_DIR / "mock_data")
        sites = json.loads((PROJECT_DIR / "mock_data" / "sites.json").read_text())
        fetcher = MockFetcher(sites)
    else:
        api_key = os.environ.get("GOOGLE_PLACES_API_KEY")
        if not api_key:
            print("ERROR: GOOGLE_PLACES_API_KEY is not set. Create prospector/.env "
                  "(see .env.example) or run with --mock to test the pipeline.",
                  file=sys.stderr)
            return 1
        try:
            leads, api_requests = fetch_places(
                args.niche, args.area, api_key, cache_dir,
                max_results=args.max_results, refresh=args.refresh,
            )
        except PlacesError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        fetcher = LiveFetcher()

    found = len(leads)
    print(f"Found {found} businesses for '{args.niche}' in '{args.area}' "
          f"({api_requests} API request(s), rest from cache).")

    # ---- Exclusions -------------------------------------------------------
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
        score = score_lead(lead, issues)
        if score is None:
            disqualified += 1
            continue
        lead["score"] = score
        lead["issues_found"] = describe_issues(lead, issues)
        scored.append(lead)

    # ---- Step 4: pitch angles (single batched AI call) --------------------
    qualifying = [l for l in scored if l["score"] >= args.min_score]
    if qualifying:
        print(f"Generating pitch angles for {len(qualifying)} leads scoring >= {args.min_score}...")
        pitches = generate_pitches(
            qualifying, os.environ.get("ANTHROPIC_API_KEY"), args.niche, args.area
        )
    else:
        pitches = {}
    for lead in scored:
        lead["pitch_angle"] = pitches.get(lead["place_id"], "")

    # ---- Step 5: output ----------------------------------------------------
    csv_path = write_csv(scored, PROJECT_DIR)
    print_summary(found, excluded, disqualified, scored, args.min_score, csv_path, api_requests)
    return 0


if __name__ == "__main__":
    sys.exit(main())

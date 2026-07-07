"""End-to-end pipeline test against the bundled mock data — no network, no keys."""

import csv
import json
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))

from places import normalize_place


def test_normalize_place_maps_fields():
    raw = json.loads((PROJECT / "mock_data" / "places.json").read_text())["places"][1]
    lead = normalize_place(raw)
    assert lead["place_id"] == "mock_dated_site_2"
    assert lead["name"] == "Bill's Mobile Detailing"
    assert lead["website"] == "http://billsmobiledetailing.example.com"
    assert lead["review_count"] == 67


def test_mock_run_end_to_end(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = subprocess.run(
        [sys.executable, "prospect.py", "--niche", "auto detailing",
         "--area", "Kanata, Ottawa", "--mock"],
        cwd=PROJECT, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr

    csv_files = sorted(PROJECT.glob("leads_scored_2*.csv"))  # excludes leads_scored_free_*
    assert csv_files, "no output CSV written"
    rows = list(csv.DictReader(csv_files[-1].open()))
    by_id = {r["place_id"]: r for r in rows}

    # Closed business disqualified, everything else present
    assert "mock_closed_6" not in by_id
    assert len(rows) == 6

    # No website + strong reviews: 4 + 2
    assert int(by_id["mock_no_website_1"]["score"]) == 6
    # Facebook redirect + strong reviews: 4 + 2
    assert int(by_id["mock_facebook_only_3"]["score"]) == 6
    # Dated GoDaddy site: no https 2 + no viewport 3 + dated (footer+platform) 2 + revenue 2
    assert int(by_id["mock_dated_site_2"]["score"]) == 9
    # Unreachable, weak reviews: 4
    assert int(by_id["mock_unreachable_5"]["score"]) == 4
    # Healthy modern site, revenue bonus only
    assert int(by_id["mock_good_site_4"]["score"]) == 2

    # Sorted by score descending
    scores = [int(r["score"]) for r in rows]
    assert scores == sorted(scores, reverse=True)

    # Pitch column exists but is blank (no API key in test env)
    assert all("pitch_angle" in r for r in rows)

    # Summary output present
    assert "7 businesses found" in result.stdout
    assert "scored >= 6" in result.stdout


def test_dry_run_makes_no_requests():
    result = subprocess.run(
        [sys.executable, "prospect.py", "--niche", "plumbers",
         "--area", "Orleans, Ottawa", "--dry-run"],
        cwd=PROJECT, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "3 Google Places API text-search request(s)" in result.stdout


def test_contacted_exclusion(tmp_path):
    contacted = tmp_path / "contacted.csv"
    contacted.write_text("# names or place_ids\nAlready Contacted Detailing\nmock_unreachable_5\n")
    result = subprocess.run(
        [sys.executable, "prospect.py", "--niche", "auto detailing",
         "--area", "Kanata, Ottawa", "--mock", "--contacted", str(contacted)],
        cwd=PROJECT, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "2 excluded" in result.stdout

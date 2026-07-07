"""Tests for the keyless (OSM + template-pitch) version."""

import csv
import json
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))

from osm import build_query, normalize_element
from pitch_templates import build_pitch
from scoring import score_lead_keyless


# ---- osm.py -----------------------------------------------------------------

def test_normalize_element_maps_fields():
    el = json.loads((PROJECT / "mock_data" / "osm_places.json").read_text())["elements"][1]
    lead = normalize_element(el)
    assert lead["place_id"] == "osm_way_2002"
    assert lead["name"] == "Bill's Mobile Detailing"
    assert lead["website"] == "http://billsmobiledetailing.example.com"
    assert lead["phone"] == "+1 613 555 0102"
    assert "March Road" in lead["address"]
    assert lead["rating"] is None


def test_normalize_element_without_name_is_dropped():
    assert normalize_element({"type": "node", "id": 1, "tags": {"shop": "car_repair"}}) is None


def test_disused_tag_marks_closed():
    el = {"type": "node", "id": 2, "tags": {"name": "Old Shop", "disused:shop": "car_repair"}}
    assert normalize_element(el)["business_status"] == "CLOSED_PERMANENTLY"


def test_build_query_uses_curated_tags_and_name_match():
    bbox = {"south": 45.0, "west": -76.0, "north": 45.5, "east": -75.5}
    q = build_query("auto detailing", bbox)
    assert '"shop"="car_repair"' in q
    assert '"amenity"="car_wash"' in q
    assert '"name"~' in q
    assert "(45.0,-76.0,45.5,-75.5)" in q


def test_build_query_unknown_niche_falls_back_to_name_match():
    bbox = {"south": 1, "west": 2, "north": 3, "east": 4}
    q = build_query("axe throwing", bbox)
    assert '"name"~"axe\\ throwing",i' in q or '"name"~"axe throwing",i' in q


# ---- keyless scoring ----------------------------------------------------------

def osm_lead(**overrides):
    base = {
        "place_id": "osm_node_1",
        "name": "Test Biz",
        "website": "",
        "phone": "+1 613 555 0000",
        "has_hours": True,
        "rating": None,
        "review_count": 0,
        "business_status": "OPERATIONAL",
    }
    base.update(overrides)
    return base


def test_keyless_established_bonus():
    # no website (4) + phone & hours bonus (2)
    assert score_lead_keyless(osm_lead(), []) == 6


def test_keyless_no_bonus_without_hours():
    assert score_lead_keyless(osm_lead(has_hours=False), []) == 4


def test_keyless_disqualifies_closed():
    assert score_lead_keyless(osm_lead(business_status="CLOSED_PERMANENTLY"), []) is None


def test_keyless_caps_at_ten():
    lead = osm_lead(website="http://x.example.com")
    issues = ["unreachable", "no_https", "no_viewport", "slow_heavy", "dated_footer"]
    assert score_lead_keyless(lead, issues) == 10


# ---- pitch templates ----------------------------------------------------------

def test_pitch_no_website_mentions_evidence():
    pitch = build_pitch(osm_lead(), [], "Kanata")
    assert "Test Biz" in pitch
    assert "no website" in pitch.lower()
    assert "phone and posted hours" in pitch


def test_pitch_priority_prefers_biggest_problem():
    lead = osm_lead(website="http://x.example.com")
    pitch = build_pitch(lead, ["no_https", "unreachable"], "Kanata")
    assert "dead" in pitch  # unreachable outranks no_https


def test_pitch_uses_reviews_when_available():
    lead = osm_lead(rating=4.8, review_count=127, website="http://x.example.com")
    pitch = build_pitch(lead, ["no_viewport"], "Kanata")
    assert "127 reviews at 4.8 stars" in pitch


# ---- end to end ----------------------------------------------------------------

def test_free_mock_run_end_to_end():
    result = subprocess.run(
        [sys.executable, "prospect_free.py", "--niche", "auto detailing",
         "--area", "Kanata, Ottawa", "--mock"],
        cwd=PROJECT, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr

    csv_files = sorted(PROJECT.glob("leads_scored_free_*.csv"))
    assert csv_files, "no output CSV written"
    rows = list(csv.DictReader(csv_files[-1].open()))
    by_id = {r["place_id"]: r for r in rows}

    # nameless element dropped, disused shop disqualified -> 5 rows
    assert len(rows) == 5
    assert "osm_node_6006" not in by_id

    # no website (4) + phone & hours (2)
    assert int(by_id["osm_node_1001"]["score"]) == 6
    # dated site: no_https 2 + no_viewport 3 + dated 2, phone but no hours -> 7
    assert int(by_id["osm_way_2002"]["score"]) == 7
    # facebook redirect 4 + phone & hours 2
    assert int(by_id["osm_node_3003"]["score"]) == 6
    # healthy site, phone & hours only
    assert int(by_id["osm_node_4004"]["score"]) == 2
    # unreachable 4, no phone
    assert int(by_id["osm_node_5005"]["score"]) == 4

    # every qualifying lead has a deterministic pitch, no keys involved
    for pid in ("osm_node_1001", "osm_way_2002", "osm_node_3003"):
        assert by_id[pid]["pitch_angle"].strip(), f"missing pitch for {pid}"
    scores = [int(r["score"]) for r in rows]
    assert scores == sorted(scores, reverse=True)


def test_free_dry_run_reports_keyless():
    result = subprocess.run(
        [sys.executable, "prospect_free.py", "--niche", "bakery",
         "--area", "Orleans, Ottawa", "--dry-run"],
        cwd=PROJECT, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "No keys, no quota, no billing" in result.stdout

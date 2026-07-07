import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scoring import describe_issues, score_lead


def lead(**overrides):
    base = {
        "place_id": "x",
        "name": "Test Biz",
        "website": "https://example.com",
        "rating": 3.5,
        "review_count": 5,
        "business_status": "OPERATIONAL",
    }
    base.update(overrides)
    return base


def test_no_website_scores_four():
    assert score_lead(lead(website=""), []) == 4


def test_no_website_with_proven_revenue():
    assert score_lead(lead(website="", rating=4.9, review_count=143), []) == 6


def test_unreachable_site():
    assert score_lead(lead(), ["unreachable"]) == 4


def test_facebook_only_counts_like_unreachable():
    assert score_lead(lead(), ["social_only"]) == 4


def test_individual_issue_weights():
    assert score_lead(lead(), ["no_https"]) == 2
    assert score_lead(lead(), ["no_viewport"]) == 3
    assert score_lead(lead(), ["slow_heavy"]) == 2
    assert score_lead(lead(), ["dated_footer"]) == 2
    assert score_lead(lead(), ["dated_platform"]) == 2


def test_dated_footer_and_platform_count_once():
    assert score_lead(lead(), ["dated_footer", "dated_platform"]) == 2


def test_score_caps_at_ten():
    issues = ["unreachable", "no_https", "no_viewport", "slow_heavy", "dated_footer"]
    assert score_lead(lead(rating=4.8, review_count=100), issues) == 10


def test_non_operational_disqualified():
    assert score_lead(lead(business_status="CLOSED_PERMANENTLY"), []) is None
    assert score_lead(lead(business_status="CLOSED_TEMPORARILY"), []) is None


def test_healthy_site_scores_low():
    assert score_lead(lead(rating=4.7, review_count=210), []) == 2  # revenue bonus only


def test_describe_issues_includes_no_website():
    text = describe_issues(lead(website=""), [])
    assert "no website" in text

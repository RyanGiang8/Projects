"""Tests for Agent 7 — healthcheck logic and report generation (no network)."""

import subprocess
import sys
from pathlib import Path

MAINT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MAINT))

from healthcheck import build_attention, content_similarity, visible_text
from report_gen import build_contexts, generate_fallback, render, suggestion_theme


# ---- healthcheck ------------------------------------------------------------

def ok_row(**overrides):
    row = {"http_status": 200, "response_ms": 300, "ssl_days_left": 200,
           "form_ok": True, "content_similarity": 0.99, "lighthouse_mobile": 92}
    row.update(overrides)
    return row


def test_healthy_row_has_no_flags():
    assert build_attention(ok_row()) == ""


def test_site_down_flagged():
    assert "SITE DOWN" in build_attention(ok_row(http_status=503))
    assert "SITE DOWN" in build_attention(ok_row(http_status=None))


def test_ssl_expiry_warning():
    assert "SSL expires in 12 days" in build_attention(ok_row(ssl_days_left=12))
    assert "SSL" not in build_attention(ok_row(ssl_days_left=45))


def test_form_failure_flagged():
    assert "contact form" in build_attention(ok_row(form_ok=False))
    assert "contact form" not in build_attention(ok_row(form_ok=None))  # no endpoint configured


def test_unexpected_content_change_flagged():
    assert "content change" in build_attention(ok_row(content_similarity=0.42))
    assert "content change" not in build_attention(ok_row(content_similarity=0.97))


def test_slow_response_and_low_lighthouse():
    flags = build_attention(ok_row(response_ms=6000, lighthouse_mobile=38))
    assert "slow response" in flags and "Lighthouse mobile 38/100" in flags


def test_visible_text_strips_scripts_and_tags():
    html = "<html><head><script>evil()</script><style>x{}</style></head><body><h1>Hi</h1> <p>there</p></body></html>"
    assert visible_text(html) == "Hi there"


def test_content_similarity_first_run_none_then_compares(tmp_path):
    assert content_similarity("x.ca", "<p>hello world</p>", tmp_path) is None
    sim_same = content_similarity("x.ca", "<p>hello world</p>", tmp_path)
    assert sim_same == 1.0
    sim_diff = content_similarity("x.ca", "<p>totally different content now</p>", tmp_path)
    assert sim_diff < 0.9


# ---- report generation --------------------------------------------------------

CLIENTS = [{"name": "Bill's Mobile Detailing", "domain": "bills.ca", "plan": "managed"}]
HEALTH = [{"client": "Bill's Mobile Detailing", "attention": "", "lighthouse_mobile": "92"}]
ANALYTICS = [{"client": "Bill's Mobile Detailing", "visits": "412",
              "top_pages": "/, /services", "countries": "Canada",
              "work_done": "Updated spring pricing"}]


def test_suggestion_rotation_is_deterministic_and_varied():
    a = suggestion_theme("2026-07", 0)
    assert a == suggestion_theme("2026-07", 0)
    themes = {suggestion_theme("2026-07", i)[0] for i in range(4)}
    assert len(themes) == 4  # four clients get four different themes


def test_fallback_sections_use_the_data():
    ctx = build_contexts(CLIENTS, HEALTH, ANALYTICS, "2026-07")[0]
    sections = generate_fallback(ctx)
    assert "412" in sections["traffic_summary"]
    assert "All checks passed" in sections["health_summary"]
    assert "Updated spring pricing" in sections["work_done"]
    assert sections["suggestion"]


def test_fallback_mentions_caught_issue():
    health = [{"client": "Bill's Mobile Detailing", "attention": "SSL expires in 10 days", "lighthouse_mobile": ""}]
    ctx = build_contexts(CLIENTS, health, ANALYTICS, "2026-07")[0]
    sections = generate_fallback(ctx)
    assert "SSL expires in 10 days" in sections["health_summary"]


def test_render_fills_every_placeholder():
    template = (MAINT / "report_template.html").read_text()
    ctx = build_contexts(CLIENTS, HEALTH, ANALYTICS, "2026-07")[0]
    html = render(template, ctx, generate_fallback(ctx), "2026-07",
                  "Ryan Web Services", "ryan@example.com")
    assert "{{" not in html, "unfilled placeholder left in report"
    assert "July 2026" in html and "Bill's Mobile Detailing" in html
    assert "All systems green" in html


def test_report_gen_end_to_end_no_key(tmp_path):
    clients = tmp_path / "clients.csv"
    clients.write_text("name,domain,plan,monthly_fee,launch_date\nTest Co,test.ca,managed,100,2026-01-01\n")
    result = subprocess.run(
        [sys.executable, str(MAINT / "report_gen.py"), "--clients", str(clients),
         "--month", "2026-07", "--no-ai", "--brand", "Test Brand"],
        capture_output=True, text=True, timeout=30, cwd=MAINT,
    )
    assert result.returncode == 0, result.stderr
    report = MAINT / "reports" / "test-co_2026-07.html"
    assert report.exists()
    assert "Test Brand" in report.read_text()
    report.unlink()

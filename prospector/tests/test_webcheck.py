import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webcheck import FetchResult, check_website


class StubFetcher:
    def __init__(self, result: FetchResult):
        self.result = result

    def fetch(self, url):
        return self.result


def ok(html, url="https://example.com", elapsed=0.5, **kw):
    return FetchResult(final_url=url, status=200, content=html.encode(), elapsed=elapsed, **kw)


def test_dns_failure_is_unreachable():
    r = check_website("http://nope.example.com", StubFetcher(FetchResult(error="dns")))
    assert "unreachable" in r.issues


def test_ssl_error_flags_no_https():
    r = check_website("https://bad-cert.example.com", StubFetcher(FetchResult(error="ssl")))
    assert "no_https" in r.issues


def test_facebook_redirect_is_social_only():
    fetched = ok("<html></html>", url="https://www.facebook.com/somebiz")
    r = check_website("https://biz.example.com", StubFetcher(fetched))
    assert r.issues == ["social_only"]


def test_http_final_url_flags_no_https():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"></head><body>&copy; 2026</body></html>'
    r = check_website("http://biz.example.com", StubFetcher(ok(html, url="http://biz.example.com")))
    assert "no_https" in r.issues


def test_missing_viewport_detected():
    html = "<html><head><title>Great Biz - Services</title></head><body>&copy; 2026</body></html>"
    r = check_website("https://biz.example.com", StubFetcher(ok(html)))
    assert "no_viewport" in r.issues


def test_slow_page_flagged():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"></head><body>&copy; 2026</body></html>'
    r = check_website("https://biz.example.com", StubFetcher(ok(html, elapsed=9.5)))
    assert "slow_heavy" in r.issues


def test_dated_copyright_year():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"></head><body><footer>© 2004-2019 Great Biz</footer></body></html>'
    r = check_website("https://biz.example.com", StubFetcher(ok(html)))
    assert "dated_footer" in r.issues


def test_recent_copyright_year_not_flagged():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"></head><body><footer>© 2026 Great Biz</footer></body></html>'
    r = check_website("https://biz.example.com", StubFetcher(ok(html)))
    assert "dated_footer" not in r.issues


def test_godaddy_generator_is_dated_platform():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"><meta name="generator" content="GoDaddy Website Builder"></head><body>&copy; 2026</body></html>'
    r = check_website("https://biz.example.com", StubFetcher(ok(html)))
    assert "dated_platform" in r.issues


def test_wix_free_subdomain_is_dated_platform():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"></head><body>&copy; 2026</body></html>'
    r = check_website(
        "https://somebiz.wixsite.com/home",
        StubFetcher(ok(html, url="https://somebiz.wixsite.com/home")),
    )
    assert "dated_platform" in r.issues


def test_old_wordpress_theme_is_dated_platform():
    html = '<html><head><title>Great Biz - Services</title><meta name="viewport" content="w"><link href="/wp-content/themes/twelveten/style.css"><link href="/wp-content/themes/twentyten/style.css"></head><body>&copy; 2026</body></html>'
    r = check_website("https://biz.example.com", StubFetcher(ok(html)))
    assert "dated_platform" in r.issues


def test_title_equal_to_domain_is_bad_title():
    html = '<html><head><title>biz</title><meta name="viewport" content="w"></head><body>&copy; 2026</body></html>'
    r = check_website("https://biz.example.com", StubFetcher(ok(html, url="https://www.biz.example.com")))
    # domain words for biz.example.com -> "biz.example"; exact host also checked
    html2 = '<html><head></head><body>&copy; 2026</body></html>'
    r2 = check_website("https://biz.example.com", StubFetcher(ok(html2)))
    assert "bad_title" in r2.issues


def test_healthy_site_has_no_issues():
    html = '<html><head><title>Crystal Clear Auto Spa - Detailing in Kanata</title><meta name="viewport" content="width=device-width"></head><body><footer>&copy; 2026</footer></body></html>'
    r = check_website("https://crystalclear.example.com", StubFetcher(ok(html, url="https://crystalclear.example.com")))
    assert r.issues == []


def test_robots_blocked_yields_no_issues():
    r = check_website("https://biz.example.com", StubFetcher(FetchResult(robots_blocked=True)))
    assert r.issues == []
    assert any("robots" in n for n in r.notes)

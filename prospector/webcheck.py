"""Deterministic website health checks — no AI.

Every check emits a short issue code that feeds scoring.py:
  unreachable, social_only, no_https, no_viewport, slow_heavy,
  dated_footer, dated_platform, bad_title
"""

import re
import time
import urllib.robotparser
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

USER_AGENT = "LeadProspector/1.0 (local web-services lead research; respects robots.txt)"
TIMEOUT = 10
MAX_BYTES = 6 * 1024 * 1024  # read cap; the 5 MB threshold sits below it
WEIGHT_LIMIT = 5 * 1024 * 1024
SLOW_SECONDS = 8.0
DATED_YEAR_MAX = 2021

SOCIAL_HOSTS = (
    "facebook.com",
    "instagram.com",
    "linktr.ee",
    "linktree.com",
    "m.facebook.com",
)
DATED_URL_PATTERNS = (
    ".wixsite.com",       # Wix free tier
    ".godaddysites.com",  # GoDaddy builder
    ".weebly.com",
    ".blogspot.",
    ".tripod.com",
    ".angelfire.com",
)
DATED_GENERATORS = ("godaddy", "homestead", "web.com", "frontpage", "publisher")
OLD_WP_THEMES = re.compile(
    r"/wp-content/themes/(twenty(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen))/",
    re.I,
)
OLD_WP_GENERATOR = re.compile(r"wordpress\s*[1-4]\.", re.I)
COPYRIGHT_RE = re.compile(
    r"(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-–—]\s*)?((?:19|20)\d{2})", re.I
)


@dataclass
class FetchResult:
    final_url: str = ""
    status: int = 0
    content: bytes = b""
    elapsed: float = 0.0
    error: str = ""  # "dns", "timeout", "ssl", "connection", or ""
    robots_blocked: bool = False


@dataclass
class WebCheckResult:
    issues: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class LiveFetcher:
    """requests-based fetcher: honest UA, robots.txt, size-capped streaming read."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def _robots_allows(self, url: str) -> bool:
        origin = "{0.scheme}://{0.netloc}".format(urlparse(url))
        if origin not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                resp = self.session.get(f"{origin}/robots.txt", timeout=5)
                if resp.status_code == 200:
                    rp.parse(resp.text.splitlines())
                    self._robots[origin] = rp
                else:
                    self._robots[origin] = None  # no robots.txt: allowed
            except requests.RequestException:
                self._robots[origin] = None
        rp = self._robots[origin]
        return rp is None or rp.can_fetch(USER_AGENT, url)

    def fetch(self, url: str) -> FetchResult:
        if not self._robots_allows(url):
            return FetchResult(final_url=url, robots_blocked=True)
        start = time.monotonic()
        try:
            resp = self.session.get(url, timeout=TIMEOUT, stream=True)
        except requests.exceptions.SSLError:
            return FetchResult(final_url=url, error="ssl", elapsed=time.monotonic() - start)
        except requests.exceptions.ConnectTimeout:
            return FetchResult(final_url=url, error="timeout", elapsed=time.monotonic() - start)
        except requests.exceptions.ConnectionError as exc:
            kind = "dns" if "Name or service not known" in str(exc) or "getaddrinfo" in str(exc) else "connection"
            return FetchResult(final_url=url, error=kind, elapsed=time.monotonic() - start)
        except requests.RequestException:
            return FetchResult(final_url=url, error="connection", elapsed=time.monotonic() - start)
        try:
            chunks, total = [], 0
            for chunk in resp.iter_content(chunk_size=65536):
                chunks.append(chunk)
                total += len(chunk)
                if total >= MAX_BYTES or time.monotonic() - start > TIMEOUT:
                    break
            return FetchResult(
                final_url=resp.url,
                status=resp.status_code,
                content=b"".join(chunks),
                elapsed=time.monotonic() - start,
            )
        except requests.RequestException:
            return FetchResult(final_url=resp.url, error="timeout", elapsed=time.monotonic() - start)
        finally:
            resp.close()


def _domain_words(url: str) -> str:
    host = urlparse(url).netloc.lower().removeprefix("www.")
    return host.rsplit(".", 1)[0] if "." in host else host


def check_website(url: str, fetcher) -> WebCheckResult:
    result = WebCheckResult()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url

    fetched = fetcher.fetch(url)

    if fetched.robots_blocked:
        result.notes.append("robots.txt disallows checking; site not inspected")
        return result

    if fetched.error == "ssl":
        result.issues.append("no_https")
        result.notes.append("invalid TLS certificate")
        return result
    if fetched.error or fetched.status >= 400 or not fetched.content:
        result.issues.append("unreachable")
        result.notes.append(f"fetch failed ({fetched.error or f'HTTP {fetched.status}'})")
        return result

    final = urlparse(fetched.final_url)
    if any(final.netloc.lower().endswith(h) or final.netloc.lower() == h for h in SOCIAL_HOSTS):
        result.issues.append("social_only")
        result.notes.append(f"redirects to {final.netloc}")
        return result

    if final.scheme != "https":
        result.issues.append("no_https")

    if fetched.elapsed > SLOW_SECONDS or len(fetched.content) > WEIGHT_LIMIT:
        result.issues.append("slow_heavy")
        result.notes.append(
            f"{len(fetched.content) / 1e6:.1f} MB in {fetched.elapsed:.1f}s"
        )

    html = fetched.content.decode("utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")

    if not soup.find("meta", attrs={"name": re.compile("^viewport$", re.I)}):
        result.issues.append("no_viewport")

    title = (soup.title.get_text(strip=True) if soup.title else "").lower()
    if not title or title == _domain_words(fetched.final_url) or title == final.netloc.lower().removeprefix("www."):
        result.issues.append("bad_title")

    years = [int(y) for y in COPYRIGHT_RE.findall(html)]
    if years and max(years) <= DATED_YEAR_MAX:
        result.issues.append("dated_footer")
        result.notes.append(f"copyright year {max(years)}")

    if _dated_platform(fetched.final_url, html, soup):
        result.issues.append("dated_platform")

    return result


def _dated_platform(url: str, html: str, soup: BeautifulSoup) -> bool:
    host = urlparse(url).netloc.lower()
    if any(pat in host for pat in DATED_URL_PATTERNS):
        return True
    gen = soup.find("meta", attrs={"name": re.compile("^generator$", re.I)})
    gen_content = (gen.get("content") or "").lower() if gen else ""
    if any(g in gen_content for g in DATED_GENERATORS):
        return True
    if OLD_WP_GENERATOR.search(gen_content) or OLD_WP_THEMES.search(html):
        return True
    if re.search(r"\.swf[\"']", html, re.I):  # Flash remnants
        return True
    return False

"""Public Suffix List lookup: "which part of a hostname is the site?"

The same algorithm and the same data file as extension/lib/psl.js, so the browser and the
backend agree on what a site is (bbc.co.uk and news.bbc.co.uk are one site; example.co.uk and
other.co.uk are not). Both are tested against the same cases in docs/psl-test-cases.json.
List format and algorithm: https://publicsuffix.org/list/
"""
import logging
import re
from functools import lru_cache

from . import config

log = logging.getLogger("itv")
_IPV4 = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def _to_ascii(rule: str) -> str | None:
    try:
        rule.encode("ascii")
        return rule
    except UnicodeEncodeError:
        pass
    try:
        return rule.encode("idna").decode("ascii")  # punycode (xn--...)
    except UnicodeError:
        return None


class PublicSuffixList:
    def __init__(self, text: str):
        self.rules: set[str] = set()       # "co.uk"
        self.wildcards: set[str] = set()   # "*.ck"  is stored as "ck"
        self.exceptions: set[str] = set()  # "!www.ck" is stored as "www.ck"

        for raw in text.split("\n"):
            parts = raw.strip().split()
            line = parts[0] if parts else ""
            if not line or line.startswith("//"):
                continue
            if line.startswith("!"):
                rule = _to_ascii(line[1:].lower())
                if rule:
                    self.exceptions.add(rule)
            elif line.startswith("*."):
                rule = _to_ascii(line[2:].lower())
                if rule:
                    self.wildcards.add(rule)
            else:
                rule = _to_ascii(line.lower())
                if rule:
                    self.rules.add(rule)

    def registrable_domain(self, host: str) -> str:
        """The site of a lowercase hostname, e.g. "news.bbc.co.uk" -> "bbc.co.uk".

        IP addresses, single labels and hostnames that are themselves a public suffix are
        returned unchanged."""
        if not host or _IPV4.match(host) or ":" in host:
            return host
        labels = host.split(".")
        if len(labels) < 2:
            return host

        # From the longest candidate suffix to the shortest: the first rule that matches wins.
        for i in range(len(labels)):
            candidate = ".".join(labels[i:])
            parent = ".".join(labels[i + 1:])
            if candidate in self.exceptions:
                return candidate  # an exception rule makes this name itself registrable
            if candidate in self.rules or (parent and parent in self.wildcards):
                # `candidate` is a public suffix; the site is one label further left.
                return host if i == 0 else ".".join(labels[i - 1:])
        return ".".join(labels[-2:])  # default rule: the last label is the public suffix


@lru_cache(maxsize=1)
def default_psl() -> PublicSuffixList:
    try:
        return PublicSuffixList(config.PSL_PATH.read_text(encoding="utf-8"))
    except OSError:
        log.warning("Public Suffix List not found at %s; sites fall back to the last two labels.", config.PSL_PATH)
        return PublicSuffixList("")


def site_of(domain: str) -> str:
    """The registrable domain of a hostname the extension sent (already lowercase)."""
    return default_psl().registrable_domain(domain)

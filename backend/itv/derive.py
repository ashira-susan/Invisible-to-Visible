"""Turns the raw `signals` JSON of a scan into the derived columns and tracker rows.

The raw JSON stays in the database as the source of truth, so a new column can always be
re-derived without re-collecting anything. Used for new scans and for backfilling old ones, so
both paths give the same answer. Tolerant on purpose: a stored row of any age must never make
the migration or a request fail.
"""
from .psl import site_of

MAX_TRACKERS = 200  # the contract's limit


def _count(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _section(signals: dict, key: str) -> dict:
    value = signals.get(key)
    return value if isinstance(value, dict) else {}


def tracker_rows(signals) -> list[dict]:
    signals = signals if isinstance(signals, dict) else {}
    listed = signals.get("trackers")
    rows = []
    for item in (listed if isinstance(listed, list) else [])[:MAX_TRACKERS]:
        if not isinstance(item, dict) or not isinstance(item.get("domain"), str) or not item["domain"]:
            continue
        category = item.get("category")
        company = item.get("company")
        rows.append({
            "domain": item["domain"][:253],
            "category": category[:20] if isinstance(category, str) and category else "other",
            "company": company[:100] if isinstance(company, str) and company else None,
            "known_fingerprinter": item.get("known_fingerprinter") is True,
        })
    return rows


def derived_columns(domain: str, signals) -> dict:
    """Values for the derived columns of the `scans` table."""
    signals = signals if isinstance(signals, dict) else {}
    cookies = _section(signals, "cookies")
    fingerprinting = _section(signals, "fingerprinting")
    return {
        "site": site_of(domain),
        "trackers_checked": signals.get("trackers_checked") is True,
        "inpage_checked": signals.get("inpage_checked") is True,
        "third_party_requests": _count(signals.get("third_party_requests")),
        "tracker_count": len(tracker_rows(signals)),
        "cookies_first_party": _count(cookies.get("first_party")),
        "cookies_third_party": _count(cookies.get("third_party")),
        "cookies_by_trackers": _count(cookies.get("by_trackers")),
        "fp_canvas": _count(fingerprinting.get("canvas")),
        "fp_webgl": _count(fingerprinting.get("webgl")),
        "fp_audio": _count(fingerprinting.get("audio")),
        "fp_font": _count(fingerprinting.get("font")),
        "geolocation_calls": _count(signals.get("geolocation_calls")),
    }

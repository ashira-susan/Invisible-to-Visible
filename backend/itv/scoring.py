"""The Privacy Score: how much tracking was observed during one visit.

Higher is better (100 = little tracking observed). It is computed when read from the stored
columns and tracker rows, using the weights in knowledge/privacy_score.json, so changing a
weight never leaves stale stored scores. Rules that are never broken:

  * Unknown is never clean. If the tracker check was off for a visit there is NO score
    (null), not 100. If the page scripts did not report (`inpage_checked` false) the
    page-script factors are left out and said to be "not checked", never counted as zero.
  * Every point is explained: each factor says what was observed, how many points it cost,
    its cap, and how reliable the evidence is ("confirmed" = live-detected by the extension;
    "best_effort" = page-script counts, which a page can inflate, hide or evade).
  * HTTPS is not part of this score (it belongs to the Trust Score).
  * A tracker that is not on the known-tracker list is not counted, so a high score is not
    proof that nothing was tracked.
"""
import json
import math
import statistics
from functools import lru_cache

from . import config

CATEGORY_ORDER = ("advertising", "fingerprinting", "social", "analytics", "other", "content")
PAGE_SCRIPT_COLUMNS = (
    ("canvas", "fp_canvas", "canvas read-back", "canvas read-backs"),
    ("webgl", "fp_webgl", "WebGL graphics-card query or pixel read", "WebGL graphics-card queries or pixel reads"),
    ("audio", "fp_audio", "offline audio render", "offline audio renders"),
    ("font", "fp_font", "burst of font measuring", "bursts of font measuring"),
    ("geolocation", "geolocation_calls", "location request", "location requests"),
)

NOTE_HTTPS = "HTTPS is not part of this score."
NOTE_LIST = "Only trackers on the known-tracker list are counted, so a high score is not proof that nothing was tracked."
NOTE_PARTIAL = "Page-script calls were not checked for this visit, so those factors are left out; the score could be lower if they had been included."


class WeightsError(ValueError):
    pass


def _check_rule(name: str, rule, keys=("points_each", "cap")) -> None:
    if not isinstance(rule, dict) or not isinstance(rule.get("label"), str):
        raise WeightsError(f"privacy_score.json: {name} needs a label")
    for key in keys:
        value = rule.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise WeightsError(f"privacy_score.json: {name}.{key} must be a number above 0")


def _validate(data: dict) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("version"), str):
        raise WeightsError("privacy_score.json: missing version")
    bands = data.get("bands")
    if not isinstance(bands, list) or not bands or bands[-1].get("max") != 100:
        raise WeightsError("privacy_score.json: bands must end at 100")
    previous = 0
    for band in bands:
        if not isinstance(band.get("max"), int) or band["max"] <= previous or not band.get("key") or not band.get("label"):
            raise WeightsError("privacy_score.json: bands must be increasing, with key and label")
        previous = band["max"]
    categories = data.get("tracker_categories")
    if not isinstance(categories, dict) or set(categories) != set(CATEGORY_ORDER):
        raise WeightsError(f"privacy_score.json: tracker_categories must be exactly {CATEGORY_ORDER}")
    for name, rule in categories.items():
        _check_rule(f"tracker_categories.{name}", rule)
    for name in ("known_fingerprinters", "cookies_third_party", "cookies_by_trackers"):
        _check_rule(name, data.get(name))
    _check_rule("third_party_requests", data.get("third_party_requests"), keys=("cap", "scale"))
    scripts = data.get("page_scripts")
    if not isinstance(scripts, dict) or set(scripts) != {k for k, *_ in PAGE_SCRIPT_COLUMNS}:
        raise WeightsError("privacy_score.json: page_scripts must cover canvas, webgl, audio, font, geolocation")
    for name, rule in scripts.items():
        _check_rule(f"page_scripts.{name}", rule)
    return data


@lru_cache(maxsize=1)
def load_weights() -> dict:
    return _validate(json.loads((config.KNOWLEDGE_DIR / "privacy_score.json").read_text(encoding="utf-8")))


def _penalty(n: float, each: float, cap: float) -> float:
    """Grows with n, never decreases, never exceeds cap."""
    return cap * (1.0 - math.exp(-n * each / cap)) if n > 0 else 0.0


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def band_for(score: int | None, weights: dict | None = None) -> dict | None:
    if score is None:
        return None
    for band in (weights or load_weights())["bands"]:
        if score <= band["max"]:
            return band
    return (weights or load_weights())["bands"][-1]


def score_visit(visit: dict, trackers: list[dict], weights: dict | None = None) -> dict:
    """`visit` has the derived column values of a scan; `trackers` are its tracker rows."""
    w = weights or load_weights()
    trackers_checked = visit.get("trackers_checked") is True
    inpage_checked = visit.get("inpage_checked") is True
    coverage = {
        "trackers": "checked" if trackers_checked else "not_checked",
        "page_scripts": "checked" if inpage_checked else "not_checked",
    }
    result = {
        "version": w["version"], "score": None, "band": None, "label": "Not enough evidence",
        "status": "not_enough_evidence", "total_points": None, "coverage": coverage,
        "factors": [], "not_checked": [], "notes": [NOTE_HTTPS],
    }

    if not trackers_checked:
        result["not_checked"].append({"id": "trackers", "reason": "Request monitoring was off for this visit (only the site name was allowed), so tracking could not be observed. That is not the same as no tracking."})
        if not inpage_checked:
            result["not_checked"].append({"id": "page_scripts", "reason": "Page-script calls were not checked for this visit."})
        return result

    factors = []

    def add(factor_id, label, evidence, observed, points, cap, explanation):
        factors.append({"id": factor_id, "label": label, "evidence": evidence, "observed": observed,
                        "points": round(points, 1), "max_points": cap, "explanation": explanation, "_raw": points})

    counts = {c: 0 for c in CATEGORY_ORDER}
    known_fp = 0
    for t in trackers:
        category = t.get("category") if t.get("category") in counts else "other"
        counts[category] += 1
        known_fp += 1 if t.get("known_fingerprinter") else 0

    for category in CATEGORY_ORDER:
        n, rule = counts[category], w["tracker_categories"][category]
        if n:
            add(f"trackers.{category}", f"{rule['label']} trackers", "confirmed", n,
                _penalty(n, rule["points_each"], rule["cap"]), rule["cap"],
                f"{_plural(n, 'known ' + category + ' tracker was', 'known ' + category + ' trackers were')} contacted.")
    if known_fp:
        rule = w["known_fingerprinters"]
        add("trackers.known_fingerprinters", rule["label"], "confirmed", known_fp,
            _penalty(known_fp, rule["points_each"], rule["cap"]), rule["cap"],
            f"{_plural(known_fp, 'contacted tracker is', 'contacted trackers are')} on a list of known fingerprinting services. Being on the list is not proof that it fingerprinted you.")

    # Cookies set by known trackers are a subset of the third-party cookies. Every third-party
    # cookie counts a little, and the ones set by known trackers count again with extra weight,
    # so one more cookie of either kind can never lower the penalty.
    by_trackers = max(0, int(visit.get("cookies_by_trackers", 0)))
    third_party = max(by_trackers, int(visit.get("cookies_third_party", 0)))
    if third_party:
        rule = w["cookies_third_party"]
        add("cookies.third_party", rule["label"], "confirmed", third_party,
            _penalty(third_party, rule["points_each"], rule["cap"]), rule["cap"],
            f"{_plural(third_party, 'cookie was', 'cookies were')} set by sites other than the one you visited.")
    if by_trackers:
        rule = w["cookies_by_trackers"]
        add("cookies.by_trackers", rule["label"], "confirmed", by_trackers,
            _penalty(by_trackers, rule["points_each"], rule["cap"]), rule["cap"],
            f"{_plural(by_trackers, 'of those cookies was', 'of those cookies were')} set by known trackers.")

    requests = max(0, int(visit.get("third_party_requests", 0)))
    if requests:
        rule = w["third_party_requests"]
        add("requests.third_party", rule["label"], "confirmed", requests,
            rule["cap"] * (1.0 - math.exp(-requests / rule["scale"])), rule["cap"],
            f"{_plural(requests, 'request was', 'requests were')} made to other sites. Many are ordinary (images, fonts, scripts), so this counts for little.")

    if inpage_checked:
        for key, column, one, many in PAGE_SCRIPT_COLUMNS:
            n = max(0, int(visit.get(column, 0)))
            if n:
                rule = w["page_scripts"][key]
                add(f"page_scripts.{key}", rule["label"], "best_effort", n,
                    _penalty(n, rule["points_each"], rule["cap"]), rule["cap"],
                    f"{_plural(n, one + ' was', many + ' were')} observed. Many sites use these for ordinary features, and a page can hide or inflate these counts.")
    else:
        result["not_checked"].append({"id": "page_scripts", "reason": "The page scripts did not report for this visit (the page was already open when they became active, or they did not run), so canvas, WebGL, audio, font and location calls are not part of this score."})
        result["notes"].append(NOTE_PARTIAL)
    result["notes"].append(NOTE_LIST)

    total = sum(f.pop("_raw") for f in factors)
    score = max(0, min(100, round(100 - total)))
    band = band_for(score, w)
    result.update(score=score, band=band["key"], label=band["label"], status="scored",
                  total_points=round(total, 1), factors=factors)
    return result


def median_and_range(scores: list[int]) -> tuple[int | None, int | None, int | None]:
    """Median (rounded half up), lowest and highest of a list of scores; all None if empty."""
    if not scores:
        return None, None, None
    return math.floor(statistics.median(scores) + 0.5), min(scores), max(scores)

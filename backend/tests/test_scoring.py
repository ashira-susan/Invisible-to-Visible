"""The Privacy Score: honest about unknowns, explained, monotonic, capped."""
import copy
import json
import random

import pytest

from itv import config, scoring
from itv.scoring import CATEGORY_ORDER, WeightsError, band_for, load_weights, median_and_range, score_visit

CLEAN = dict(trackers_checked=True, inpage_checked=True)


def trackers(n, category="advertising", known_fp=0):
    return [{"domain": f"{category}{i}.test", "category": category, "company": None, "known_fingerprinter": i < known_fp} for i in range(n)]


def visit(**kw):
    return {**CLEAN, **kw}


# ---- unknown is never clean ---------------------------------------------------------------

def test_a_visit_nobody_could_check_has_no_score_not_100():
    r = score_visit({"trackers_checked": False, "inpage_checked": False}, [])
    assert r["score"] is None and r["band"] is None and r["status"] == "not_enough_evidence"
    assert r["label"] == "Not enough evidence" and r["factors"] == [] and r["total_points"] is None
    assert [n["id"] for n in r["not_checked"]] == ["trackers", "page_scripts"]
    assert r["coverage"] == {"trackers": "not_checked", "page_scripts": "not_checked"}


def test_unchecked_trackers_stay_unscored_whatever_else_is_stored():
    r = score_visit({"trackers_checked": False, "inpage_checked": True, "third_party_requests": 500, "cookies_by_trackers": 9}, trackers(20))
    assert r["score"] is None


def test_only_an_explicit_true_means_checked():
    for value in (1, "true", None, "yes"):
        assert score_visit({"trackers_checked": value}, [])["score"] is None


def test_page_scripts_not_checked_are_left_out_and_said_so_not_counted_as_zero():
    unchecked = score_visit(visit(inpage_checked=False, fp_canvas=9, fp_webgl=9, fp_audio=9, fp_font=9, geolocation_calls=9), trackers(3))
    clean = score_visit(visit(), trackers(3))
    assert unchecked["score"] == clean["score"]                       # stored page-script counts are ignored without a check
    assert not [f for f in unchecked["factors"] if f["id"].startswith("page_scripts")]
    assert unchecked["not_checked"][0]["id"] == "page_scripts"
    assert unchecked["coverage"]["page_scripts"] == "not_checked"
    assert any("could be lower" in n for n in unchecked["notes"])
    assert clean["not_checked"] == [] and clean["coverage"]["page_scripts"] == "checked"


def test_page_script_calls_count_only_when_checked_and_are_marked_best_effort():
    r = score_visit(visit(fp_canvas=3, fp_webgl=3, fp_audio=1, fp_font=2, geolocation_calls=2), [])
    ids = {f["id"]: f for f in r["factors"]}
    assert set(ids) == {"page_scripts.canvas", "page_scripts.webgl", "page_scripts.audio", "page_scripts.font", "page_scripts.geolocation"}
    assert all(f["evidence"] == "best_effort" for f in ids.values())
    assert r["score"] < 100


def test_https_is_not_part_of_the_score():
    r = score_visit(visit(https=False), [])
    assert r["score"] == 100 and not any("https" in f["id"] for f in r["factors"])
    assert "HTTPS is not part of this score." in r["notes"]


# ---- explanations ---------------------------------------------------------------------------

def test_every_point_is_explained():
    r = score_visit(visit(third_party_requests=197, cookies_third_party=9, cookies_by_trackers=7), trackers(11, "advertising", 3) + trackers(5, "analytics", 1))
    assert r["status"] == "scored" and r["version"] == load_weights()["version"]
    for f in r["factors"]:
        assert set(f) == {"id", "label", "evidence", "observed", "points", "max_points", "explanation"}
        assert f["points"] <= f["max_points"] and f["observed"] > 0 and f["explanation"]
    assert abs(sum(f["points"] for f in r["factors"]) - r["total_points"]) <= 0.05 * len(r["factors"]) + 1e-9
    assert r["score"] == max(0, min(100, round(100 - r["total_points"]))) or abs(r["score"] - (100 - r["total_points"])) <= 1
    by_id = {f["id"]: f for f in r["factors"]}
    assert by_id["trackers.advertising"]["evidence"] == "confirmed" and by_id["trackers.advertising"]["observed"] == 11
    assert by_id["trackers.known_fingerprinters"]["observed"] == 4
    assert by_id["cookies.by_trackers"]["observed"] == 7 and by_id["cookies.third_party"]["observed"] == 9


def test_wording_handles_one_and_many():
    one = score_visit(visit(), trackers(1, "social"))["factors"][0]["explanation"]
    many = score_visit(visit(), trackers(2, "social"))["factors"][0]["explanation"]
    assert one.startswith("1 known social tracker was") and many.startswith("2 known social trackers were")


def test_the_known_list_limit_is_stated():
    assert any("known-tracker list" in n for n in score_visit(visit(), [])["notes"])


# ---- shape: caps, diminishing returns, monotonic -----------------------------------------------

def test_every_factor_stays_within_its_cap_and_the_score_within_0_to_100():
    r = score_visit(visit(third_party_requests=10**6, cookies_third_party=10**5, cookies_by_trackers=10**5, fp_canvas=10**5, fp_webgl=10**5, fp_audio=10**5, fp_font=10**5, geolocation_calls=10**5),
                    sum((trackers(5000, c, 5000) for c in CATEGORY_ORDER), []))
    assert all(f["points"] <= f["max_points"] + 1e-9 for f in r["factors"])
    assert r["score"] == 0 and 0 <= r["total_points"]
    # nothing in the worst case is "free": every capped factor is (almost) at its cap
    assert all(f["points"] >= f["max_points"] - 0.1 for f in r["factors"])


def test_each_extra_tracker_costs_less_than_the_one_before_but_always_something():
    rule = load_weights()["tracker_categories"]["advertising"]
    costs = [scoring._penalty(n, rule["points_each"], rule["cap"]) for n in range(0, 60)]
    marginals = [b - a for a, b in zip(costs, costs[1:])]
    assert all(m > 0 for m in marginals)                                  # always something
    assert all(later <= earlier + 1e-12 for earlier, later in zip(marginals, marginals[1:]))   # never more than the one before
    assert marginals[0] <= rule["points_each"] + 1e-12 and costs[-1] < rule["cap"]


def test_adding_anything_never_raises_the_score():
    rng = random.Random(7)
    fields = ["third_party_requests", "cookies_third_party", "cookies_by_trackers", "fp_canvas", "fp_webgl", "fp_audio", "fp_font", "geolocation_calls"]
    for _ in range(300):
        v = visit(**{f: rng.randint(0, 40) for f in fields})
        t = [{"category": rng.choice(CATEGORY_ORDER + ("unheard-of",)), "known_fingerprinter": rng.random() < 0.3} for _ in range(rng.randint(0, 30))]
        base = score_visit(v, t)
        # one more of each counted thing, separately
        for field in fields:
            more = score_visit({**v, field: v[field] + 1}, t)
            assert more["total_points"] >= base["total_points"] - 1e-9 and more["score"] <= base["score"]
        for extra in ({"category": c, "known_fingerprinter": fp} for c in CATEGORY_ORDER for fp in (False, True)):
            more = score_visit(v, t + [extra])
            assert more["total_points"] >= base["total_points"] - 1e-9 and more["score"] <= base["score"]


def test_an_unknown_category_counts_as_other_and_inconsistent_cookie_counts_never_go_negative():
    assert score_visit(visit(), [{"category": "mystery"}])["factors"][0]["id"] == "trackers.other"
    r = score_visit(visit(cookies_third_party=2, cookies_by_trackers=5), [])
    assert all(f["points"] >= 0 for f in r["factors"])
    assert {f["id"]: f["observed"] for f in r["factors"]} == {"cookies.third_party": 5, "cookies.by_trackers": 5}   # a tracker's cookies are third-party cookies


# ---- calibration on visits taken from real pages (see docs/data-contract.md) ---------------------------

def test_real_world_ordering_and_bands():
    wikipedia = score_visit(visit(), [])
    one_ad = score_visit(visit(third_party_requests=3), trackers(1))
    bbc22 = score_visit(visit(third_party_requests=197, cookies_third_party=7, cookies_by_trackers=7),
                        trackers(11, "advertising", 3) + trackers(5, "analytics", 1) + trackers(5, "content") + trackers(1, "other"))
    bbc31 = score_visit(visit(third_party_requests=370, cookies_third_party=15, cookies_by_trackers=15, fp_webgl=1),
                        trackers(17, "advertising", 4) + trackers(6, "analytics", 1) + trackers(7, "content") + trackers(1, "other"))
    assert wikipedia["score"] == 100 and wikipedia["band"] == "little_tracking"
    assert one_ad["band"] == "little_tracking" and 90 <= one_ad["score"] < 100
    assert bbc22["band"] == "some_tracking" and 40 < bbc22["score"] < 60
    assert bbc31["score"] <= bbc22["score"] < one_ad["score"] < wikipedia["score"]
    assert 15 <= bbc31["score"] <= 45


# ---- bands, medians, weights file ------------------------------------------------------------------

@pytest.mark.parametrize("score,key", [(0, "heavy_tracking"), (40, "heavy_tracking"), (41, "some_tracking"), (70, "some_tracking"), (71, "little_tracking"), (100, "little_tracking")])
def test_band_edges_match_the_verdict_bands(score, key):
    assert band_for(score)["key"] == key


def test_no_score_has_no_band():
    assert band_for(None) is None


def test_median_rounds_half_up_and_handles_nothing():
    assert median_and_range([]) == (None, None, None)
    assert median_and_range([50]) == (50, 50, 50)
    assert median_and_range([10, 20]) == (15, 10, 20)
    assert median_and_range([10, 21]) == (16, 10, 21)
    assert median_and_range([100, 20, 60]) == (60, 20, 100)


def mutated(path, value):
    data = json.loads((config.KNOWLEDGE_DIR / "privacy_score.json").read_text(encoding="utf-8"))
    target = data
    for key in path[:-1]:
        target = target[key]
    if value is KeyError:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return data


@pytest.mark.parametrize("path,value", [
    (("version",), KeyError), (("bands",), []), (("bands", 2, "max"), 90), (("bands", 1, "max"), 30),
    (("tracker_categories", "social"), KeyError), (("tracker_categories", "advertising", "cap"), 0),
    (("tracker_categories", "advertising", "points_each"), -1), (("known_fingerprinters", "cap"), "12"),
    (("cookies_by_trackers", "label"), 5), (("third_party_requests", "scale"), 0), (("page_scripts", "audio"), KeyError),
    (("page_scripts", "canvas", "cap"), True),
])
def test_a_bad_weights_file_is_refused(path, value):
    with pytest.raises(WeightsError):
        scoring._validate(mutated(path, value))


def test_the_shipped_weights_file_is_valid():
    scoring.load_weights.cache_clear()
    assert scoring.load_weights()["version"] == "1"

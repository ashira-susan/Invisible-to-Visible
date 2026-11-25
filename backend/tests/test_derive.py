from itv.derive import MAX_TRACKERS, derived_columns, tracker_rows

FULL = {
    "trackers_checked": True,
    "inpage_checked": True,
    "third_party_requests": 12,
    "trackers": [
        {"domain": "doubleclick.net", "category": "advertising", "company": "Google", "known_fingerprinter": True},
        {"domain": "chartbeat.net", "category": "analytics", "company": None},
    ],
    "cookies": {"first_party": 3, "third_party": 2, "by_trackers": 1},
    "fingerprinting": {"canvas": 4, "webgl": 3, "audio": 1, "font": 2},
    "geolocation_calls": 2,
}


def test_every_column_comes_from_the_matching_signal():
    assert derived_columns("www.bbc.co.uk", FULL) == {
        "site": "bbc.co.uk", "trackers_checked": True, "inpage_checked": True,
        "third_party_requests": 12, "tracker_count": 2,
        "cookies_first_party": 3, "cookies_third_party": 2, "cookies_by_trackers": 1,
        "fp_canvas": 4, "fp_webgl": 3, "fp_audio": 1, "fp_font": 2, "geolocation_calls": 2,
    }


def test_missing_signals_mean_zero_and_unchecked_never_clean():
    cols = derived_columns("example.com", {})
    assert cols["trackers_checked"] is False and cols["inpage_checked"] is False
    assert cols["tracker_count"] == 0 and cols["third_party_requests"] == 0


def test_only_an_explicit_true_counts_as_checked():
    for value in (1, "true", "yes", None, [], {}):
        cols = derived_columns("example.com", {"trackers_checked": value, "inpage_checked": value})
        assert cols["trackers_checked"] is False and cols["inpage_checked"] is False


def test_junk_never_raises():
    for junk in (None, [], "text", 5, {"cookies": "x", "fingerprinting": [], "trackers": "nope", "third_party_requests": -3},
                 {"third_party_requests": True, "geolocation_calls": 1.5, "cookies": {"first_party": "7"}}):
        cols = derived_columns("example.com", junk)
        assert all(cols[k] == 0 for k in ("third_party_requests", "geolocation_calls", "cookies_first_party", "tracker_count"))


def test_tracker_rows_fill_defaults_and_skip_bad_entries():
    rows = tracker_rows({"trackers": [
        {"domain": "a.test"},                                   # category defaults to "other"
        {"domain": "b.test", "category": "social", "company": "X", "known_fingerprinter": True},
        {"category": "advertising"}, {"domain": ""}, {"domain": 5}, "text", None,
    ]})
    assert rows == [
        {"domain": "a.test", "category": "other", "company": None, "known_fingerprinter": False},
        {"domain": "b.test", "category": "social", "company": "X", "known_fingerprinter": True},
    ]


def test_tracker_rows_are_capped_at_the_contract_limit():
    many = {"trackers": [{"domain": f"t{i}.test"} for i in range(MAX_TRACKERS + 50)]}
    assert len(tracker_rows(many)) == MAX_TRACKERS
    assert derived_columns("example.com", many)["tracker_count"] == MAX_TRACKERS

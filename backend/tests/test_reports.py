"""Sites day by day, one site, trackers, trends and the export. Dates are fixed and in the past."""
from datetime import datetime, timezone

import pytest

from itv import config
from itv.main import app
from itv.reports import current_time
from tests.conftest import INSTALL_A, INSTALL_B, headers, scan_body

NOW = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def fixed_clock(client, monkeypatch):
    monkeypatch.setattr(config, "RETENTION_DAYS", 0)      # keep everything: these dates are fixed, "now" is not
    app.dependency_overrides[current_time] = lambda: NOW
    yield


def post(client, domain, observed_at, *, install=INSTALL_A, checked=True, inpage=True, trackers=(), requests=0,
         cookies=(0, 0, 0), canvas=0, https=True):
    body = scan_body(domain=domain, observed_at=observed_at, https=https)
    signals = {"trackers_checked": checked, "inpage_checked": inpage, "third_party_requests": requests}
    if checked:
        signals["trackers"] = [{"domain": d, "category": c, "company": co, "known_fingerprinter": fp} for d, c, co, fp in trackers]
        signals["cookies"] = {"first_party": cookies[0], "third_party": cookies[1], "by_trackers": cookies[2]}
        signals["fingerprinting"] = {"canvas": canvas, "webgl": 0, "audio": 0, "font": 0}
    body["signals"] = signals
    response = client.post("/api/v1/scans", json=body, headers=headers(install))
    assert response.status_code == 201, response.text
    return response.json()["id"]


ADS = [("ads.test", "advertising", "AdCo", False), ("px.test", "advertising", "AdCo", True), ("stats.test", "analytics", "StatCo", False)]


# ---- sites, day by day ------------------------------------------------------------------------

def test_sites_are_grouped_by_the_users_local_day(client):
    post(client, "www.bbc.co.uk", "2026-11-12T20:00:00Z", trackers=ADS)    # 01:30 on the 13th in India, still the 12th in UTC
    post(client, "wikipedia.org", "2026-11-13T09:00:00Z")
    utc = client.get("/api/v1/sites?days=2&offset_minutes=0", headers=headers()).json()
    ist = client.get("/api/v1/sites?days=2&offset_minutes=330", headers=headers()).json()
    assert [(d["day"], [s["site"] for s in d["sites"]]) for d in utc["days"]] == [("2026-11-13", ["wikipedia.org"]), ("2026-11-12", ["bbc.co.uk"])]
    assert [(d["day"], sorted(s["site"] for s in d["sites"])) for d in ist["days"]] == [("2026-11-13", ["bbc.co.uk", "wikipedia.org"])]


def test_the_window_starts_at_local_midnight(client):
    post(client, "old.example", "2026-11-11T23:59:00Z")
    post(client, "new.example", "2026-11-12T00:00:00Z")
    sites = lambda off: [s["site"] for d in client.get(f"/api/v1/sites?days=2&offset_minutes={off}", headers=headers()).json()["days"] for s in d["sites"]]
    assert sites(0) == ["new.example"]
    assert sorted(sites(330)) == ["new.example", "old.example"]      # in India the 11th 23:59Z is already the 12th, 05:29


def test_a_site_row_has_the_median_score_and_never_counts_unchecked_visits_as_clean(client):
    post(client, "www.bbc.co.uk", "2026-11-13T08:00:00Z", trackers=ADS, requests=100, cookies=(1, 3, 2))
    post(client, "news.bbc.co.uk", "2026-11-13T09:00:00Z")                  # clean and checked: scores 100
    post(client, "www.bbc.co.uk", "2026-11-13T10:00:00Z", checked=False)    # nobody looked
    day = client.get("/api/v1/sites?days=1", headers=headers()).json()["days"][0]
    assert (day["visits"], day["checked_visits"]) == (3, 2)
    bbc = day["sites"][0]
    assert bbc["site"] == "bbc.co.uk" and bbc["visits"] == 3 and bbc["checked_visits"] == 2
    assert bbc["score_min"] < 100 == bbc["score_max"] and bbc["score_min"] <= bbc["score"] <= 100
    assert bbc["distinct_trackers"] == 3 and bbc["third_party_requests"] == 100
    assert bbc["last_visit"] == "2026-11-13T10:00:00Z"


def test_a_site_with_only_unchecked_visits_has_no_score(client):
    post(client, "unknown.example", "2026-11-13T08:00:00Z", checked=False)
    site = client.get("/api/v1/sites?days=1", headers=headers()).json()["days"][0]["sites"][0]
    assert site["visits"] == 1 and site["checked_visits"] == 0
    assert site["score"] is None and site["band"] is None and site["distinct_trackers"] == 0


def test_sites_are_private_to_each_install(client):
    post(client, "mine.example", "2026-11-13T08:00:00Z")
    post(client, "theirs.example", "2026-11-13T08:00:00Z", install=INSTALL_B)
    names = [s["site"] for d in client.get("/api/v1/sites", headers=headers()).json()["days"] for s in d["sites"]]
    assert names == ["mine.example"]


# ---- one site -------------------------------------------------------------------------------------

def test_the_site_score_is_the_median_of_its_latest_ten_scored_visits(client):
    for i in range(12):                                         # visit i has i advertising trackers: scores fall, then it ends
        post(client, "shop.example", f"2026-11-{1 + i:02d}T10:00:00Z", trackers=[(f"t{j}.test", "advertising", None, False) for j in range(i)])
    post(client, "shop.example", "2026-11-13T09:00:00Z", checked=False)    # newest, but unchecked: never part of the score
    detail = client.get("/api/v1/sites/shop.example", headers=headers()).json()
    assert detail["visits"] == 13 and detail["checked_visits"] == 12 and detail["scored_visits"] == 10
    from itv.scoring import median_and_range, score_visit
    expected = [score_visit({"trackers_checked": True, "inpage_checked": True}, [{"category": "advertising"}] * i)["score"] for i in range(2, 12)]
    assert (detail["score"], detail["score_min"], detail["score_max"]) == median_and_range(expected)   # visits 2 to 11: the oldest two are not used
    assert detail["score_min"] < detail["score_max"]
    assert detail["recent"][0]["score"] is None and detail["recent"][0]["trackers_checked"] is False
    assert len(detail["recent"]) == 10 and detail["first_visit"] == "2026-11-01T10:00:00Z" and detail["last_visit"] == "2026-11-13T09:00:00Z"


def test_partial_visits_are_counted_and_the_site_trackers_have_denominators(client):
    post(client, "shop.example", "2026-11-10T10:00:00Z", trackers=ADS, inpage=False)
    post(client, "shop.example", "2026-11-11T10:00:00Z", trackers=ADS[:1])
    detail = client.get("/api/v1/sites/Shop.Example", headers=headers()).json()           # case-insensitive
    assert detail["site"] == "shop.example" and detail["scored_visits"] == 2 and detail["partial_visits"] == 1
    seen = {t["domain"]: t["visits_seen"] for t in detail["trackers"]}
    assert seen == {"ads.test": 2, "px.test": 1, "stats.test": 1} and detail["checked_visits"] == 2
    assert detail["trackers"][0]["domain"] == "ads.test"                                   # most often seen first
    assert next(t for t in detail["trackers"] if t["domain"] == "px.test")["known_fingerprinter"] is True


def test_a_site_with_no_checked_visit_says_not_enough_evidence(client):
    post(client, "blind.example", "2026-11-10T10:00:00Z", checked=False)
    detail = client.get("/api/v1/sites/blind.example", headers=headers()).json()
    assert detail["score"] is None and detail["band"] is None and detail["label"] == "Not enough evidence"
    assert detail["scored_visits"] == 0 and detail["trackers"] == []


def test_an_unknown_site_or_another_installs_site_is_a_404(client):
    post(client, "theirs.example", "2026-11-10T10:00:00Z", install=INSTALL_B)
    assert client.get("/api/v1/sites/nothing.example", headers=headers()).status_code == 404
    assert client.get("/api/v1/sites/theirs.example", headers=headers()).status_code == 404
    assert client.get("/api/v1/sites/theirs.example", headers=headers(INSTALL_B)).status_code == 200


# ---- trackers --------------------------------------------------------------------------------------

def test_trackers_report_who_how_often_and_the_denominator(client):
    post(client, "a.example", "2026-11-12T10:00:00Z", trackers=ADS)
    post(client, "b.example", "2026-11-13T10:00:00Z", trackers=ADS[:2])
    post(client, "c.example", "2026-11-13T11:00:00Z", checked=False)
    post(client, "old.example", "2026-09-01T10:00:00Z", trackers=ADS)       # outside the 30-day window
    body = client.get("/api/v1/trackers?days=30", headers=headers()).json()
    assert (body["checked_visits"], body["unchecked_visits"]) == (2, 1)
    by = {t["domain"]: t for t in body["trackers"]}
    assert by["ads.test"]["visits_seen"] == 2 and by["ads.test"]["sites_seen"] == 2
    assert by["stats.test"]["visits_seen"] == 1 and by["stats.test"]["sites_seen"] == 1
    assert by["ads.test"]["first_seen"] == "2026-11-12T10:00:00Z" and by["ads.test"]["last_seen"] == "2026-11-13T10:00:00Z"
    assert [t["domain"] for t in body["trackers"]][:2] == ["ads.test", "px.test"]
    companies = {c["company"]: c for c in body["companies"]}
    assert companies["AdCo"] == {"company": "AdCo", "trackers": 2, "visits_seen": 2, "sites_seen": 2}
    assert companies["StatCo"]["visits_seen"] == 1


def test_trackers_with_no_company_are_listed_but_not_rolled_up(client):
    post(client, "a.example", "2026-11-13T10:00:00Z", trackers=[("x.test", "other", None, False)])
    body = client.get("/api/v1/trackers", headers=headers()).json()
    assert [t["domain"] for t in body["trackers"]] == ["x.test"] and body["companies"] == []


# ---- trends -----------------------------------------------------------------------------------------

def test_trends_cover_every_day_oldest_first_with_gaps_as_zero(client):
    post(client, "a.example", "2026-11-11T10:00:00Z", trackers=ADS)
    post(client, "b.example", "2026-11-13T10:00:00Z")
    post(client, "c.example", "2026-11-13T11:00:00Z", checked=False)
    body = client.get("/api/v1/trends?days=4", headers=headers()).json()
    assert [d["day"] for d in body["days"]] == ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]
    d10, d11, d12, d13 = body["days"]
    assert (d10["visits"], d10["median_score"]) == (0, None)
    assert d11["visits"] == 1 and d11["median_score"] < 100 and d11["distinct_trackers"] == 3
    assert (d12["visits"], d12["median_score"]) == (0, None)
    assert (d13["visits"], d13["checked_visits"], d13["unchecked_visits"], d13["median_score"]) == (2, 1, 1, 100)
    assert body["scoring_version"] == "1"


# ---- export ------------------------------------------------------------------------------------------

def test_export_has_everything_stored_for_this_install_and_nothing_else(client):
    post(client, "a.example", "2026-11-12T10:00:00Z", trackers=ADS, requests=9, cookies=(1, 2, 2), canvas=3)
    post(client, "theirs.example", "2026-11-12T11:00:00Z", install=INSTALL_B, trackers=ADS)
    response = client.get("/api/v1/export", headers=headers())
    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="invisible-to-visible-export.json"'
    doc = response.json()
    assert doc["export_version"] == "1" and doc["scoring_version"] == "1" and doc["exported_at"] == "2026-11-13T12:00:00Z"
    assert doc["install"]["install_id"] == INSTALL_A and len(doc["scans"]) == 1
    scan = doc["scans"][0]
    assert scan["domain"] == "a.example" and scan["site"] == "a.example" and scan["observed_at"] == "2026-11-12T10:00:00Z"
    assert scan["signals"]["fingerprinting"]["canvas"] == 3 and scan["signals"]["trackers_checked"] is True    # the raw JSON as received
    assert scan["derived"]["tracker_count"] == 3 and scan["derived"]["fp_canvas"] == 3 and scan["derived"]["cookies_by_trackers"] == 2
    assert [t["domain"] for t in scan["trackers"]] == ["ads.test", "px.test", "stats.test"]
    assert scan["privacy"]["status"] == "scored" and scan["privacy"]["factors"]
    assert "theirs.example" not in response.text and INSTALL_B not in response.text


def test_export_of_an_empty_install_is_valid(client):
    doc = client.get("/api/v1/export", headers=headers()).json()
    assert doc["scans"] == [] and doc["install"] is None


def test_export_is_oldest_first(client):
    post(client, "b.example", "2026-11-12T10:00:00Z")
    post(client, "a.example", "2026-11-10T10:00:00Z")
    assert [s["domain"] for s in client.get("/api/v1/export", headers=headers()).json()["scans"]] == ["a.example", "b.example"]


# ---- detail and list carry the score ---------------------------------------------------------------------

def test_scan_detail_explains_the_score_and_the_list_carries_it(client):
    scored = post(client, "a.example", "2026-11-12T10:00:00Z", trackers=ADS, requests=50, cookies=(0, 2, 2))
    blind = post(client, "b.example", "2026-11-12T11:00:00Z", checked=False)
    detail = client.get(f"/api/v1/scans/{scored}", headers=headers()).json()
    assert detail["privacy"]["score"] == detail["privacy_score"] and detail["privacy"]["status"] == "scored"
    assert detail["privacy"]["coverage"] == {"trackers": "checked", "page_scripts": "checked"}
    ids = [f["id"] for f in detail["privacy"]["factors"]]
    assert "trackers.advertising" in ids and "trackers.known_fingerprinters" in ids and "cookies.by_trackers" in ids
    unknown = client.get(f"/api/v1/scans/{blind}", headers=headers()).json()
    assert unknown["privacy_score"] is None and unknown["privacy"]["score"] is None and unknown["privacy"]["status"] == "not_enough_evidence"
    listed = {s["id"]: s["privacy_score"] for s in client.get("/api/v1/scans", headers=headers()).json()["scans"]}
    assert listed == {scored: detail["privacy_score"], blind: None}


# ---- inputs ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "/api/v1/sites?days=0", "/api/v1/sites?days=400", "/api/v1/sites?offset_minutes=900", "/api/v1/sites?offset_minutes=-900",
    "/api/v1/trackers?days=0", "/api/v1/trends?days=x", "/api/v1/trends?offset_minutes=1.5",
])
def test_bad_parameters_are_rejected(client, url):
    assert client.get(url, headers=headers()).status_code == 422


@pytest.mark.parametrize("url", ["/api/v1/sites", "/api/v1/sites/a.example", "/api/v1/trackers", "/api/v1/trends", "/api/v1/export"])
def test_every_report_needs_a_valid_install_id(client, url):
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"X-Install-ID": "nope"}).status_code == 400


def test_the_api_description_builds(client):
    schema = client.get("/openapi.json").json()
    assert {"/api/v1/sites", "/api/v1/sites/{site}", "/api/v1/trackers", "/api/v1/trends", "/api/v1/export"} <= set(schema["paths"])

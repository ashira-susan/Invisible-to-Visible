"""The contract tests: what the backend must accept and must refuse."""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from itv.schemas import ScanSummary

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "examples"
SCHEMA_FILE = Path(__file__).resolve().parents[2] / "docs" / "schemas" / "scan-summary.v1.schema.json"

VALID = sorted((EXAMPLES / "valid").glob("*.json"))
INVALID = sorted((EXAMPLES / "invalid").glob("*.json"))


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_example_files_exist():
    assert VALID, "no valid examples found"
    assert INVALID, "no invalid examples found"


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_valid_examples_are_accepted(path):
    ScanSummary.model_validate(load(path))


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_examples_are_rejected(path):
    with pytest.raises(ValidationError):
        ScanSummary.model_validate(load(path))


def test_inpage_checked_defaults_to_false_and_rejects_non_booleans():
    summary = ScanSummary.model_validate(load(EXAMPLES / "valid" / "m2c-inpage.json"))  # written before the field existed
    assert summary.signals.inpage_checked is False  # an older sender: page-script counts are unknown, not clean
    body = load(EXAMPLES / "valid" / "m2c-inpage.json")
    body["signals"]["inpage_checked"] = True
    assert ScanSummary.model_validate(body).signals.inpage_checked is True
    for bad in ("maybe", [], {}, 7):
        body["signals"]["inpage_checked"] = bad
        with pytest.raises(ValidationError):
            ScanSummary.model_validate(body)


def test_signals_default_to_zero_when_omitted():
    summary = ScanSummary.model_validate(load(EXAMPLES / "valid" / "minimal.json"))
    assert summary.signals.third_party_requests == 0
    assert summary.signals.trackers_checked is False  # missing = nobody was looking
    assert summary.signals.trackers == []
    assert summary.signals.cookies.third_party == 0
    assert summary.signals.fingerprinting.canvas == 0


def test_tracker_company_and_fingerprinter_flag_are_accepted():
    body = load(EXAMPLES / "valid" / "full.json")
    summary = ScanSummary.model_validate(body)
    first = summary.signals.trackers[0]
    assert first.company == "Google"
    assert first.known_fingerprinter is True
    assert summary.signals.trackers[2].company is None
    assert summary.signals.trackers[2].known_fingerprinter is False


def test_cookie_counts_include_the_tracker_subset():
    summary = ScanSummary.model_validate(load(EXAMPLES / "valid" / "m2b-cookies-and-referrer.json"))
    assert summary.signals.cookies.first_party == 3
    assert summary.signals.cookies.third_party == 8
    assert summary.signals.cookies.by_trackers == 6
    assert summary.site.referrer_origin == "https://www.google.com"


def test_overlong_company_name_is_rejected():
    body = load(EXAMPLES / "valid" / "minimal.json")
    body["signals"] = {"trackers": [{"domain": "t.example.com", "company": "x" * 101}]}
    with pytest.raises(ValidationError):
        ScanSummary.model_validate(body)


def test_too_many_trackers_are_rejected():
    body = load(EXAMPLES / "valid" / "minimal.json")
    body["signals"] = {"trackers": [{"domain": "t.example.com"}] * 201}
    with pytest.raises(ValidationError):
        ScanSummary.model_validate(body)


@pytest.mark.parametrize(
    "domain",
    ["localhost", "192.168.1.5", "xn--bcher-kva.example", "a-b.example.co.uk"],
)
def test_ordinary_hostnames_are_accepted(domain):
    body = load(EXAMPLES / "valid" / "minimal.json")
    body["site"]["domain"] = domain
    ScanSummary.model_validate(body)


@pytest.mark.parametrize(
    "domain",
    ["", "example.com.", "-bad.example.com", "exa mple.com", "example.com/path", "[::1]", "user@example.com", "example.com:8080"],
)
def test_malformed_hostnames_are_rejected(domain):
    body = load(EXAMPLES / "valid" / "minimal.json")
    body["site"]["domain"] = domain
    with pytest.raises(ValidationError):
        ScanSummary.model_validate(body)


def test_published_json_schema_matches_the_contract():
    """If this fails, run: python tools/export_schema.py  and commit the result."""
    published = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    generated = ScanSummary.model_json_schema()
    assert set(published["properties"]) == set(generated["properties"])
    assert set(published["required"]) == set(generated["required"])
    assert published["additionalProperties"] is False

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


def test_signals_default_to_zero_when_omitted():
    summary = ScanSummary.model_validate(load(EXAMPLES / "valid" / "minimal.json"))
    assert summary.signals.third_party_requests == 0
    assert summary.signals.trackers == []
    assert summary.signals.cookies.third_party == 0
    assert summary.signals.fingerprinting.canvas == 0


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

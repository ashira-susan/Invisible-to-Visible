"""The Python Public Suffix List must give the same answers as the JavaScript one.
Both are run against the same cases (docs/psl-test-cases.json, from Mozilla's official tests)."""
import json
from pathlib import Path

import pytest

from itv.psl import PublicSuffixList, default_psl, site_of

REPO = Path(__file__).resolve().parents[2]
CASES = json.loads((REPO / "docs" / "psl-test-cases.json").read_text(encoding="utf-8"))
psl = default_psl()


@pytest.mark.parametrize("host,expected", CASES["registrable"])
def test_official_registrable_cases(host, expected):
    assert psl.registrable_domain(host) == expected


@pytest.mark.parametrize("host,expected", CASES["unchanged"])
def test_public_suffixes_and_single_labels_are_returned_unchanged(host, expected):
    assert psl.registrable_domain(host) == expected


def test_the_shared_fixture_is_not_empty():
    assert len(CASES["registrable"]) > 30 and len(CASES["unchanged"]) > 5


def test_the_data_file_is_the_one_the_extension_uses():
    assert (REPO / "extension" / "data" / "public_suffix_list.dat").is_file()
    assert "co.uk" in psl.rules and "ck" in psl.wildcards and "www.ck" in psl.exceptions


@pytest.mark.parametrize("host,expected", [
    ("news.bbc.co.uk", "bbc.co.uk"), ("foo.github.io", "foo.github.io"), ("a.foo.github.io", "foo.github.io"),
    ("ad.doubleclick.net", "doubleclick.net"), ("www.wikipedia.org", "wikipedia.org"),
    ("localhost", "localhost"), ("127.0.0.1", "127.0.0.1"), ("[::1]", "[::1]"), ("co.uk", "co.uk"),
])
def test_site_of_matches_the_extension_examples(host, expected):
    assert site_of(host) == expected


def test_wildcard_and_exception_rules():
    assert psl.registrable_domain("foo.ck") == "foo.ck"
    assert psl.registrable_domain("bar.foo.ck") == "bar.foo.ck"
    assert psl.registrable_domain("www.ck") == "www.ck"
    assert psl.registrable_domain("sub.www.ck") == "www.ck"


def test_unicode_rules_are_stored_as_punycode_and_junk_is_skipped():
    custom = PublicSuffixList("// comment\n\nbücher.example\n*.ünï.test\n!ok.ünï.test\n")
    assert "xn--bcher-kva.example" in custom.rules
    assert "xn--n-nga1b.test" in custom.wildcards and "ok.xn--n-nga1b.test" in custom.exceptions
    assert custom.registrable_domain("a.xn--bcher-kva.example") == "a.xn--bcher-kva.example"


def test_a_missing_list_falls_back_to_the_last_two_labels(monkeypatch, tmp_path):
    from itv import config, psl as psl_module
    monkeypatch.setattr(config, "PSL_PATH", tmp_path / "missing.dat")
    psl_module.default_psl.cache_clear()
    try:
        assert psl_module.site_of("a.b.example.com") == "example.com"
    finally:
        psl_module.default_psl.cache_clear()

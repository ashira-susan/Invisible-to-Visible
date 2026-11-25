import json

import pytest

from itv import config, knowledge
from itv.knowledge import KnowledgeError, load_products, product_for_host


@pytest.fixture(autouse=True)
def fresh_cache():
    knowledge.load_products.cache_clear()
    yield
    knowledge.load_products.cache_clear()


def test_the_ported_products_load():
    names = [p["name"] for p in load_products()]
    assert names == ["Google Analytics", "Google Tag Manager", "Meta Pixel", "Amazon Ads"]


def test_risk_ratings_and_non_tracker_entries_were_not_ported():
    text = (config.KNOWLEDGE_DIR / "tracker_products.json").read_text(encoding="utf-8").lower()
    assert '"risk"' not in text and "cloudfront" not in [h for p in load_products() for h in p["hosts"]]


def test_a_host_matches_the_product_or_a_subdomain_of_it():
    assert product_for_host("google-analytics.com")["name"] == "Google Analytics"
    assert product_for_host("WWW.Google-Analytics.com.")["name"] == "Google Analytics"
    assert product_for_host("connect.facebook.net")["company"] == "Meta"
    assert product_for_host("notgoogle-analytics.com") is None     # not a subdomain, just a similar name
    assert product_for_host("example.com") is None
    assert product_for_host("") is None


@pytest.mark.parametrize("bad", [
    {"schema": 2, "products": []},
    {"schema": 1},
    {"schema": 1, "products": [{"name": "X"}]},
    {"schema": 1, "products": [{"name": "X", "company": "C", "purpose": "P", "hosts": ["Upper.com"], "typical_data": []}]},
    {"schema": 1, "products": [{"name": "X", "company": "C", "purpose": "P", "hosts": ["a.com/path"], "typical_data": []}]},
    {"schema": 1, "products": [{"name": "X", "company": "C", "purpose": "P", "hosts": "a.com", "typical_data": []}]},
    {"schema": 1, "products": [{"name": "X", "company": "C", "purpose": "P", "hosts": [], "typical_data": []}] * 2},
])
def test_a_malformed_data_file_is_refused(bad, tmp_path, monkeypatch):
    (tmp_path / "tracker_products.json").write_text(json.dumps(bad), encoding="utf-8")
    monkeypatch.setattr(config, "KNOWLEDGE_DIR", tmp_path)
    with pytest.raises(KnowledgeError):
        load_products()

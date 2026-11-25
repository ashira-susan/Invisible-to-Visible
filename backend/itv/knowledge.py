"""Tracker knowledge kept in data files (itv/knowledge/*.json), not in code.

tracker_products.json holds what the legacy prototype knew about a few well-known products:
company, purpose, the hostnames that identify it, and the kind of data it typically handles.
It is editorial and unverified, which is why it is shown only as context, never as a finding,
and why the prototype's risk ratings were not carried over.
"""
import json
from functools import lru_cache

from . import config

REQUIRED = ("name", "company", "purpose", "hosts", "typical_data")


class KnowledgeError(ValueError):
    pass


def _validate(data: dict) -> dict:
    if not isinstance(data, dict) or data.get("schema") != 1 or not isinstance(data.get("products"), list):
        raise KnowledgeError("tracker_products.json: expected {schema: 1, products: [...]}")
    seen = set()
    for p in data["products"]:
        if not isinstance(p, dict) or any(k not in p for k in REQUIRED):
            raise KnowledgeError(f"tracker_products.json: a product needs {REQUIRED}: {p!r}")
        if not all(isinstance(p[k], str) and p[k] for k in ("name", "company", "purpose")):
            raise KnowledgeError(f"tracker_products.json: bad text fields in {p.get('name')!r}")
        for key in ("hosts", "typical_data"):
            if not isinstance(p[key], list) or not all(isinstance(x, str) and x for x in p[key]):
                raise KnowledgeError(f"tracker_products.json: {p['name']!r}.{key} must be a list of text")
        if any(h != h.lower() or "/" in h or " " in h for h in p["hosts"]):
            raise KnowledgeError(f"tracker_products.json: hosts must be lowercase hostnames ({p['name']!r})")
        if p["name"] in seen:
            raise KnowledgeError(f"tracker_products.json: duplicate product {p['name']!r}")
        seen.add(p["name"])
    return data


@lru_cache(maxsize=1)
def load_products() -> tuple[dict, ...]:
    path = config.KNOWLEDGE_DIR / "tracker_products.json"
    return tuple(_validate(json.loads(path.read_text(encoding="utf-8")))["products"])


def product_for_host(host: str) -> dict | None:
    """The known product whose hostname is `host` or a parent of it, if any."""
    host = (host or "").lower().rstrip(".")
    for product in load_products():
        for known in product["hosts"]:
            if host == known or host.endswith("." + known):
                return product
    return None

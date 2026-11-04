"""Build the on-device data files used by the extension.

  extension/data/trackers.json           tracker domain -> category and company
  extension/data/public_suffix_list.dat  copy of the Public Suffix List

Sources (see docs/THIRD_PARTY_NOTICES.md for licences):
  Disconnect  services.json + entities.json   CC BY-NC-SA 4.0
  Public Suffix List                          MPL-2.0

Usage (from the repository root):
  python tools/build_extension_data.py                  # download and build
  python tools/build_extension_data.py --from-dir DIR   # use already-downloaded files
"""
import argparse
import datetime
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "extension" / "data"

URLS = {
    "services.json": "https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json",
    "entities.json": "https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/entities.json",
    "public_suffix_list.dat": "https://publicsuffix.org/list/public_suffix_list.dat",
}

# Disconnect category -> our contract category (docs/data-contract.md)
CATEGORY_MAP = {
    "Advertising": "advertising",
    "Analytics": "analytics",
    "Social": "social",
    "Content": "content",
    "FingerprintingInvasive": "fingerprinting",
    "FingerprintingGeneral": "fingerprinting",
    "Anti-fraud": "other",
    "Cryptomining": "other",
    "Email": "other",
    "EmailAggressive": "other",
    "ConsentManagers": "other",
}
# When a domain is in several categories, the first one in this list wins. The main
# purpose (advertising, analytics, ...) beats "fingerprinting": Disconnect lists many
# big ad and analytics companies as fingerprinters too, and that is kept as a separate
# flag (third value in each entry) instead of replacing the category.
PRIORITY = ["advertising", "analytics", "social", "content", "fingerprinting", "other"]
FINGERPRINT_LISTS = {"FingerprintingInvasive", "FingerprintingGeneral"}

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
HOSTNAME_RE = re.compile("^" + _LABEL + r"(?:\." + _LABEL + ")*$")


def fetch(name: str, from_dir: Path | None) -> bytes:
    if from_dir:
        return (from_dir / name).read_bytes()
    print(f"downloading {name} ...")
    with urllib.request.urlopen(URLS[name], timeout=60) as resp:
        return resp.read()


def parent_domains(domain: str):
    labels = domain.split(".")
    for i in range(len(labels) - 1):
        yield ".".join(labels[i:])


def build(services: dict, entities: dict) -> dict:
    # domain -> (category, company)
    found: dict[str, tuple[str, str]] = {}
    fingerprinters: set[str] = set()
    unknown_categories = set()
    for category, items in services["categories"].items():
        mapped = CATEGORY_MAP.get(category)
        if mapped is None:
            unknown_categories.add(category)
            mapped = "other"
        for item in items:
            for company, homepages in item.items():
                for _homepage, domains in homepages.items():
                    for raw in domains:
                        domain = raw.strip().lower()
                        if category in FINGERPRINT_LISTS:
                            fingerprinters.add(domain)
                        previous = found.get(domain)
                        if previous is None or PRIORITY.index(mapped) < PRIORITY.index(previous[0]):
                            found[domain] = (mapped, company)

    owner: dict[str, str] = {}
    for entity, info in entities["entities"].items():
        for domain in info.get("properties", []) + info.get("resources", []):
            owner.setdefault(domain.strip().lower(), entity)

    domains_out: dict[str, list] = {}
    skipped = 0
    for domain in sorted(found):
        category, company = found[domain]
        if not HOSTNAME_RE.match(domain) or len(domain) > 253:
            skipped += 1
            continue
        for candidate in parent_domains(domain):
            if candidate in owner:
                company = owner[candidate]
                break
        domains_out[domain] = [category, company[:100], 1 if domain in fingerprinters else 0]

    counts: dict[str, int] = {}
    for category, _company, _fp in domains_out.values():
        counts[category] = counts.get(category, 0) + 1
    counts["_known_fingerprinters"] = sum(fp for _c, _co, fp in domains_out.values())

    if unknown_categories:
        print("note: unmapped Disconnect categories treated as 'other':", sorted(unknown_categories))
    print(f"{len(domains_out)} tracker domains ({skipped} skipped as malformed): {counts}")

    return {
        "source": "Disconnect services.json and entities.json",
        "license": "CC BY-NC-SA 4.0 (Disconnect, Inc.). See docs/THIRD_PARTY_NOTICES.md",
        "generated": datetime.date.today().isoformat(),
        "counts": counts,
        "domains": domains_out,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-dir", type=Path, help="folder that already holds the three source files")
    args = parser.parse_args()

    services = json.loads(fetch("services.json", args.from_dir))
    entities = json.loads(fetch("entities.json", args.from_dir))
    psl = fetch("public_suffix_list.dat", args.from_dir)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = build(services, entities)
    (OUT_DIR / "trackers.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "public_suffix_list.dat").write_bytes(psl)
    print(f"wrote {OUT_DIR / 'trackers.json'} and {OUT_DIR / 'public_suffix_list.dat'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

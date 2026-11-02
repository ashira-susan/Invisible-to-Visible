"""Regenerate docs/schemas/scan-summary.v1.schema.json from the Pydantic contract.

Run from the backend/ folder:   python tools/export_schema.py
"""
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from itv.schemas import ScanSummary  # noqa: E402

OUT = BACKEND.parent / "docs" / "schemas" / "scan-summary.v1.schema.json"


def main() -> None:
    schema = ScanSummary.model_json_schema()
    schema["title"] = "Invisible to Visible scan summary v1"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

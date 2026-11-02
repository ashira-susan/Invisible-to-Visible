"""Paths and settings. Everything can be overridden with environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
REPO_ROOT = BASE_DIR.parent
DASHBOARD_DIR = REPO_ROOT / "dashboard"

DATA_DIR = Path(os.environ.get("ITV_DATA_DIR", BASE_DIR / "data")).resolve()
DATABASE_URL = os.environ.get(
    "ITV_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'itv.db').as_posix()}"
)

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


def _retention_days() -> int:
    """How many days of visits to keep (D-3). 0 keeps everything. Anything unusable means 90."""
    raw = os.environ.get("ITV_RETENTION_DAYS", "90")
    try:
        days = int(raw)
    except ValueError:
        return 90
    return days if days >= 0 else 90


RETENTION_DAYS = _retention_days()

# One safety copy of the database is made before a migration; it holds browsing history, so
# "delete all my data" removes it too.
BACKUP_PREFIX = "itv.db.bak-"

# The same Public Suffix List the extension uses, so both sides agree on what a site is.
PSL_PATH = Path(
    os.environ.get("ITV_PSL_PATH", REPO_ROOT / "extension" / "data" / "public_suffix_list.dat")
)

KNOWLEDGE_DIR = BASE_DIR / "itv" / "knowledge"

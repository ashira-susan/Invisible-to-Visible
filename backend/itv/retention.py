"""Retention (D-3): visits older than ITV_RETENTION_DAYS (default 90) are deleted.

Runs at startup and at most once an hour after a new visit arrives, never on every request.
Age is measured from `observed_at`, the time of the visit. 0 days keeps everything.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import config
from .models import Scan
from .store import delete_scans_where

log = logging.getLogger("itv")

MIN_INTERVAL = timedelta(hours=1)
_last_run: datetime | None = None


def purge_expired(db: Session, *, now: datetime | None = None, days: int | None = None) -> int:
    """Delete expired visits (and their tracker rows). Returns how many visits were deleted."""
    days = config.RETENTION_DAYS if days is None else days
    if days <= 0:
        return 0
    now = now or datetime.now(timezone.utc)
    deleted = delete_scans_where(db, Scan.observed_at < now - timedelta(days=days))
    db.commit()
    if deleted:
        log.info("Retention: deleted %s visits older than %s days.", deleted, days)
    return deleted


def maybe_purge(db: Session, *, now: datetime | None = None) -> int | None:
    """purge_expired, but at most once per MIN_INTERVAL. Returns None when it was skipped.
    Never raises: a failed purge must not fail the request that triggered it."""
    global _last_run
    now = now or datetime.now(timezone.utc)
    if _last_run is not None and now - _last_run < MIN_INTERVAL:
        return None
    _last_run = now
    try:
        return purge_expired(db, now=now)
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("Retention purge failed; it will be tried again later.")
        return None


def reset_throttle() -> None:
    global _last_run
    _last_run = None

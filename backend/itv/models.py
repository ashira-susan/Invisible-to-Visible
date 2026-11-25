"""Database tables. One row per page visit, plus one row per tracker seen on it.

`signals` keeps the raw JSON the extension sent (the source of truth); the other columns and
`scan_trackers` are derived from it (see derive.py) so they can be queried and re-derived.
Changing a table means a numbered migration in migrations.py.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from .db import Base


class UTCDateTime(TypeDecorator):
    """Stores UTC without a timezone column, always returns timezone-aware UTC."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetimes are not allowed")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        return None if value is None else value.replace(tzinfo=timezone.utc)


def _flag() -> Mapped[bool]:
    return mapped_column(Boolean, nullable=False, default=False, server_default=text("0"))


def _count() -> Mapped[int]:
    return mapped_column(Integer, nullable=False, default=0, server_default=text("0"))


class Install(Base):
    __tablename__ = "installs"

    install_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(UTCDateTime)
    last_seen: Mapped[datetime] = mapped_column(UTCDateTime)


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    install_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("installs.install_id"), index=True
    )
    domain: Mapped[str] = mapped_column(String(253), index=True)
    https: Mapped[bool] = mapped_column(Boolean)
    referrer_origin: Mapped[str | None] = mapped_column(String(300), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime)
    signals: Mapped[dict] = mapped_column(JSON)  # the raw summary the extension sent

    # ---- derived from `signals` (added in schema version 1, appended in this order) ----
    site: Mapped[str | None] = mapped_column(String(253), nullable=True, index=True)  # registrable domain
    trackers_checked: Mapped[bool] = _flag()  # False = tracker counts are unknown, not clean
    inpage_checked: Mapped[bool] = _flag()    # False = page-script counts are unknown, not clean
    third_party_requests: Mapped[int] = _count()
    tracker_count: Mapped[int] = _count()
    cookies_first_party: Mapped[int] = _count()
    cookies_third_party: Mapped[int] = _count()
    cookies_by_trackers: Mapped[int] = _count()
    fp_canvas: Mapped[int] = _count()
    fp_webgl: Mapped[int] = _count()
    fp_audio: Mapped[int] = _count()
    fp_font: Mapped[int] = _count()
    geolocation_calls: Mapped[int] = _count()


class ScanTracker(Base):
    """A known tracker seen on a visit. Derived from `scans.signals`; removed with its scan."""

    __tablename__ = "scan_trackers"

    id: Mapped[int] = mapped_column(primary_key=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), index=True)
    domain: Mapped[str] = mapped_column(String(253), index=True)
    category: Mapped[str] = mapped_column(String(20))
    company: Mapped[str | None] = mapped_column(String(100), nullable=True)
    known_fingerprinter: Mapped[bool] = _flag()

"""Database tables. M1 stores one row per page visit (site name only)."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String
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
    # Kept as JSON in M1; becomes proper columns/tables in M3.
    signals: Mapped[dict] = mapped_column(JSON)

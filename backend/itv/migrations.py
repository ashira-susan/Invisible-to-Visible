"""Schema versions, kept in SQLite's own `PRAGMA user_version`.

    0  M1 to M3a: `installs` and `scans` (everything about a visit in one JSON column)
    1  M3b: derived columns on `scans` and the `scan_trackers` table

Upgrading an existing database makes a safety copy first, then does the whole change in ONE
transaction (SQLite can roll back schema changes too), so it either completes or leaves the
database exactly as it was. Running it again does nothing. A database written by a newer
version of the app is refused, never "downgraded".
"""
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.dialects import sqlite
from sqlalchemy.schema import CreateIndex, CreateTable

from . import config
from .db import Base
from .derive import derived_columns, tracker_rows
from .models import Scan, ScanTracker

log = logging.getLogger("itv")

SCHEMA_VERSION = 1


class DatabaseTooNew(RuntimeError):
    """The database was written by a newer version of the app."""


class MigrationError(RuntimeError):
    pass


# Columns added to `scans` by version 1, in the order they appear on the model.
_V1_COLUMNS = [
    ("site", "VARCHAR(253)"),
    ("trackers_checked", "BOOLEAN DEFAULT 0 NOT NULL"),
    ("inpage_checked", "BOOLEAN DEFAULT 0 NOT NULL"),
    ("third_party_requests", "INTEGER DEFAULT 0 NOT NULL"),
    ("tracker_count", "INTEGER DEFAULT 0 NOT NULL"),
    ("cookies_first_party", "INTEGER DEFAULT 0 NOT NULL"),
    ("cookies_third_party", "INTEGER DEFAULT 0 NOT NULL"),
    ("cookies_by_trackers", "INTEGER DEFAULT 0 NOT NULL"),
    ("fp_canvas", "INTEGER DEFAULT 0 NOT NULL"),
    ("fp_webgl", "INTEGER DEFAULT 0 NOT NULL"),
    ("fp_audio", "INTEGER DEFAULT 0 NOT NULL"),
    ("fp_font", "INTEGER DEFAULT 0 NOT NULL"),
    ("geolocation_calls", "INTEGER DEFAULT 0 NOT NULL"),
]


def upgrade(engine, *, backup_dir: Path | None = None, now: datetime | None = None) -> dict:
    """Bring the database to SCHEMA_VERSION. Returns {"action", "backup", "scans"}."""
    now = now or datetime.now(timezone.utc)
    version, has_scans = _inspect(engine)

    if version > SCHEMA_VERSION:
        raise DatabaseTooNew(
            f"This database is at schema version {version}, but this app only knows up to "
            f"{SCHEMA_VERSION}. Update the app instead of opening it with an older one."
        )
    if not has_scans:
        # A new database (or one with no visit table): create everything at the current version.
        Base.metadata.create_all(engine)
        _set_version(engine, SCHEMA_VERSION)
        return {"action": "created", "backup": None, "scans": 0}
    if version == SCHEMA_VERSION:
        return {"action": "current", "backup": None, "scans": 0}

    backup = _backup(engine, backup_dir, now)
    scans = _apply_v1(engine)
    log.info("Database upgraded to schema version %s (%s visits re-derived). Safety copy: %s", SCHEMA_VERSION, scans, backup)
    return {"action": "migrated", "backup": str(backup) if backup else None, "scans": scans}


def _inspect(engine) -> tuple[int, bool]:
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        version = cur.execute("PRAGMA user_version").fetchone()[0]
        has_scans = cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scans'").fetchone() is not None
        cur.close()
        return version, has_scans
    finally:
        raw.close()


def _set_version(engine, version: int) -> None:
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(f"PRAGMA user_version = {int(version)}")
        raw.commit()
        cur.close()
    finally:
        raw.close()


def _backup(engine, backup_dir: Path | None, now: datetime) -> Path | None:
    """A consistent copy of the database file, checked before anything is changed."""
    path = engine.url.database
    if backup_dir is None or not path or path == ":memory:":
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"{config.BACKUP_PREFIX}v0-{now:%Y%m%dT%H%M%SZ}"
    source = sqlite3.connect(path)
    copy = sqlite3.connect(target)
    try:
        source.backup(copy)
        ok = copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        same = copy.execute("SELECT COUNT(*) FROM scans").fetchone()[0] == source.execute("SELECT COUNT(*) FROM scans").fetchone()[0]
    finally:
        copy.close()
        source.close()
    if not (ok and same):
        target.unlink(missing_ok=True)
        raise MigrationError("The safety copy of the database could not be verified; nothing was changed.")
    return target


def _apply_v1(engine) -> int:
    """All of version 1 in one transaction. Returns how many visits were re-derived."""
    raw = engine.raw_connection()
    dbapi = raw.driver_connection
    previous = dbapi.isolation_level
    dbapi.isolation_level = None  # we send BEGIN / COMMIT ourselves, so DDL is inside the transaction
    cur = dbapi.cursor()
    try:
        cur.execute("BEGIN IMMEDIATE")
        try:
            _alter(cur)
            scans = _backfill(cur)
            cur.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            cur.execute("COMMIT")
        except BaseException:
            cur.execute("ROLLBACK")
            raise
        return scans
    finally:
        cur.close()
        dbapi.isolation_level = previous
        raw.close()


def _alter(cur) -> None:
    existing = {row[1] for row in cur.execute("PRAGMA table_info(scans)").fetchall()}
    for name, ddl in _V1_COLUMNS:
        if name not in existing:  # makes a re-run after a partial manual change harmless
            cur.execute(f"ALTER TABLE scans ADD COLUMN {name} {ddl}")

    dialect = sqlite.dialect()
    cur.execute(str(CreateTable(ScanTracker.__table__, if_not_exists=True).compile(dialect=dialect)))
    for table in (Scan.__table__, ScanTracker.__table__):
        for index in table.indexes:
            cur.execute(str(CreateIndex(index, if_not_exists=True).compile(dialect=dialect)))


def _backfill(cur) -> int:
    rows = cur.execute("SELECT id, domain, signals FROM scans").fetchall()
    for scan_id, domain, raw_signals in rows:
        try:
            signals = json.loads(raw_signals) if isinstance(raw_signals, (str, bytes)) else raw_signals
        except ValueError:
            signals = {}
        values = derived_columns(domain or "", signals)
        names = list(values)
        cur.execute(
            f"UPDATE scans SET {', '.join(f'{n} = ?' for n in names)} WHERE id = ?",
            [int(v) if isinstance(v, bool) else v for v in values.values()] + [scan_id],
        )
        cur.execute("DELETE FROM scan_trackers WHERE scan_id = ?", (scan_id,))
        for t in tracker_rows(signals):
            cur.execute(
                "INSERT INTO scan_trackers (scan_id, domain, category, company, known_fingerprinter) VALUES (?, ?, ?, ?, ?)",
                (scan_id, t["domain"], t["category"], t["company"], int(t["known_fingerprinter"])),
            )
    return len(rows)

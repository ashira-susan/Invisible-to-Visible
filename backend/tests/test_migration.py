"""Schema version 1 (M3b): upgrading a database written by M1 to M3a, safely."""
import json
import sqlite3

import pytest
from sqlalchemy import create_engine

from itv import config, migrations
from itv.db import Base, enable_sqlite_foreign_keys
from itv import models  # noqa: F401
from itv.migrations import SCHEMA_VERSION, DatabaseTooNew, upgrade

# The tables exactly as M1 to M3a created them (generated from those models).
OLD_SCHEMA = """
CREATE TABLE installs (install_id VARCHAR(36) NOT NULL, first_seen DATETIME NOT NULL, last_seen DATETIME NOT NULL, PRIMARY KEY (install_id));
CREATE TABLE scans (id INTEGER NOT NULL, install_id VARCHAR(36) NOT NULL, domain VARCHAR(253) NOT NULL, https BOOLEAN NOT NULL, referrer_origin VARCHAR(300), observed_at DATETIME NOT NULL, received_at DATETIME NOT NULL, signals JSON NOT NULL, PRIMARY KEY (id), FOREIGN KEY(install_id) REFERENCES installs (install_id));
CREATE INDEX ix_scans_observed_at ON scans (observed_at);
CREATE INDEX ix_scans_install_id ON scans (install_id);
CREATE INDEX ix_scans_domain ON scans (domain);
"""
INSTALL = "5f1d3c52-8a0e-4d0b-9c1a-7d2e4b6f8a10"

SIGNALS_RICH = {
    "trackers_checked": True, "inpage_checked": True, "third_party_requests": 9,
    "trackers": [
        {"domain": "googlesyndication.com", "category": "advertising", "company": "Google", "known_fingerprinter": True},
        {"domain": "dotmetrics.net", "category": "advertising", "company": "DotMetrics", "known_fingerprinter": False},
    ],
    "cookies": {"first_party": 1, "third_party": 2, "by_trackers": 2},
    "fingerprinting": {"canvas": 3, "webgl": 3, "audio": 1, "font": 2}, "geolocation_calls": 2,
}
SIGNALS_M1 = {}                                            # an M1 visit: site name only
SIGNALS_M2 = {"trackers_checked": True, "third_party_requests": 0, "trackers": [], "cookies": {"first_party": 0, "third_party": 0, "by_trackers": 0}}

ROWS = [  # (domain, https, signals as stored text)
    ("www.wikipedia.org", 1, json.dumps(SIGNALS_RICH)),
    ("news.bbc.co.uk", 1, json.dumps(SIGNALS_M1)),
    ("localhost", 0, json.dumps(SIGNALS_M2)),
    ("odd.example", 1, "this is not json"),                  # damaged text must not stop the migration
    ("null.example", 1, "null"),
]


def make_old_db(path, rows=ROWS):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_SCHEMA)
    conn.execute("INSERT INTO installs VALUES (?, '2026-10-01 09:00:00', '2026-10-01 09:00:00')", (INSTALL,))
    for i, (domain, https, signals) in enumerate(rows):
        conn.execute(
            "INSERT INTO scans (install_id, domain, https, referrer_origin, observed_at, received_at, signals) VALUES (?, ?, ?, NULL, ?, ?, ?)",
            (INSTALL, domain, https, f"2026-10-01 09:{i:02d}:00", f"2026-10-01 09:{i:02d}:05", signals),
        )
    conn.commit()
    conn.close()


def engine_for(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}", connect_args={"check_same_thread": False})
    enable_sqlite_foreign_keys(engine)
    return engine


def version_of(path):
    conn = sqlite3.connect(path)
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


def schema_of(path):
    """Everything about the tables that two databases must share, independent of column order."""
    conn = sqlite3.connect(path)
    try:
        out = {}
        for table in ("installs", "scans", "scan_trackers"):
            cols = sorted((r[1], r[2], r[3], r[4], r[5]) for r in conn.execute(f"PRAGMA table_info({table})"))
            indexes = sorted(
                (r[1], r[2], tuple(c[2] for c in conn.execute(f"PRAGMA index_info({r[1]})")))
                for r in conn.execute(f"PRAGMA index_list({table})") if not r[1].startswith("sqlite_autoindex")
            )
            fks = sorted((r[2], r[3], r[4], r[6]) for r in conn.execute(f"PRAGMA foreign_key_list({table})"))
            out[table] = {"columns": cols, "indexes": indexes, "foreign_keys": fks}
        return out
    finally:
        conn.close()


@pytest.fixture()
def old_db(tmp_path):
    path = tmp_path / "itv.db"
    make_old_db(path)
    return path


def test_upgrade_adds_the_columns_derives_them_and_keeps_the_raw_data(old_db, tmp_path):
    before = sqlite3.connect(old_db).execute("SELECT id, signals FROM scans ORDER BY id").fetchall()
    result = upgrade(engine_for(old_db), backup_dir=tmp_path)
    assert result["action"] == "migrated" and result["scans"] == len(ROWS)
    assert version_of(old_db) == SCHEMA_VERSION == 1

    conn = sqlite3.connect(old_db)
    conn.row_factory = sqlite3.Row
    rows = {r["domain"]: r for r in conn.execute("SELECT * FROM scans")}
    rich = rows["www.wikipedia.org"]
    assert (rich["site"], rich["trackers_checked"], rich["inpage_checked"], rich["third_party_requests"], rich["tracker_count"]) == ("wikipedia.org", 1, 1, 9, 2)
    assert (rich["cookies_first_party"], rich["cookies_third_party"], rich["cookies_by_trackers"]) == (1, 2, 2)
    assert (rich["fp_canvas"], rich["fp_webgl"], rich["fp_audio"], rich["fp_font"], rich["geolocation_calls"]) == (3, 3, 1, 2, 2)
    assert rows["news.bbc.co.uk"]["site"] == "bbc.co.uk"
    assert rows["news.bbc.co.uk"]["trackers_checked"] == 0 and rows["news.bbc.co.uk"]["inpage_checked"] == 0   # M1: unknown, not clean
    assert rows["localhost"]["trackers_checked"] == 1 and rows["localhost"]["inpage_checked"] == 0              # M2: page scripts did not exist yet
    assert rows["odd.example"]["tracker_count"] == 0 and rows["odd.example"]["trackers_checked"] == 0
    assert rows["null.example"]["site"] == "null.example"

    trackers = conn.execute("SELECT t.domain, t.category, t.company, t.known_fingerprinter FROM scan_trackers t JOIN scans s ON s.id = t.scan_id WHERE s.domain = 'www.wikipedia.org' ORDER BY t.domain").fetchall()
    assert [tuple(t) for t in trackers] == [("dotmetrics.net", "advertising", "DotMetrics", 0), ("googlesyndication.com", "advertising", "Google", 1)]

    after = conn.execute("SELECT id, signals FROM scans ORDER BY id").fetchall()
    assert [tuple(r) for r in after] == before    # the raw JSON is untouched: the source of truth
    conn.close()


def test_a_safety_copy_with_the_old_schema_is_made_and_verified(old_db, tmp_path):
    result = upgrade(engine_for(old_db), backup_dir=tmp_path)
    backup = tmp_path / result["backup"].split("\\")[-1].split("/")[-1]
    assert backup.name.startswith(config.BACKUP_PREFIX + "v0-")
    conn = sqlite3.connect(backup)
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert conn.execute("SELECT COUNT(*) FROM scans").fetchone()[0] == len(ROWS)
    assert "site" not in [r[1] for r in conn.execute("PRAGMA table_info(scans)")]   # the copy is the old layout
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    conn.close()


def test_running_the_upgrade_again_changes_nothing(old_db, tmp_path):
    upgrade(engine_for(old_db), backup_dir=tmp_path)
    snapshot = sqlite3.connect(old_db).execute("SELECT COUNT(*), (SELECT COUNT(*) FROM scan_trackers) FROM scans").fetchone()
    again = upgrade(engine_for(old_db), backup_dir=tmp_path)
    assert again == {"action": "current", "backup": None, "scans": 0}
    assert sqlite3.connect(old_db).execute("SELECT COUNT(*), (SELECT COUNT(*) FROM scan_trackers) FROM scans").fetchone() == snapshot
    assert len(list(tmp_path.glob(config.BACKUP_PREFIX + "*"))) == 1          # no second safety copy


def test_a_migrated_database_has_exactly_the_schema_of_a_fresh_one(old_db, tmp_path):
    fresh = tmp_path / "fresh.db"
    assert upgrade(engine_for(fresh), backup_dir=tmp_path)["action"] == "created"
    upgrade(engine_for(old_db), backup_dir=tmp_path)
    assert schema_of(old_db) == schema_of(fresh)
    assert version_of(fresh) == version_of(old_db) == SCHEMA_VERSION


def test_a_failure_part_way_leaves_the_database_exactly_as_it_was(old_db, tmp_path, monkeypatch):
    original_schema = schema_of(old_db)
    original_rows = sqlite3.connect(old_db).execute("SELECT * FROM scans ORDER BY id").fetchall()

    def boom(cur):
        cur.execute("UPDATE scans SET site = 'half-way'")   # some work has already happened
        raise RuntimeError("disk full, say")

    monkeypatch.setattr(migrations, "_backfill", boom)
    with pytest.raises(RuntimeError):
        upgrade(engine_for(old_db), backup_dir=tmp_path)
    monkeypatch.undo()

    assert version_of(old_db) == 0
    assert "scan_trackers" not in [r[0] for r in sqlite3.connect(old_db).execute("SELECT name FROM sqlite_master WHERE type='table'")]
    assert sqlite3.connect(old_db).execute("SELECT * FROM scans ORDER BY id").fetchall() == original_rows
    assert schema_of(old_db)["scans"] == original_schema["scans"]

    assert upgrade(engine_for(old_db), backup_dir=tmp_path)["action"] == "migrated"   # and it can still be done properly
    assert version_of(old_db) == SCHEMA_VERSION


def test_a_database_from_a_newer_app_is_refused_and_untouched(tmp_path):
    path = tmp_path / "itv.db"
    make_old_db(path)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA user_version = 99")
    conn.commit()
    conn.close()
    with pytest.raises(DatabaseTooNew):
        upgrade(engine_for(path), backup_dir=tmp_path)
    assert version_of(path) == 99
    assert "site" not in [r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(scans)")]
    assert not list(tmp_path.glob(config.BACKUP_PREFIX + "*"))


def test_a_new_or_empty_database_is_created_at_the_current_version(tmp_path):
    for name in ("new.db", "empty.db"):
        path = tmp_path / name
        if name == "empty.db":
            sqlite3.connect(path).close()
        result = upgrade(engine_for(path), backup_dir=tmp_path)
        assert result == {"action": "created", "backup": None, "scans": 0}
        assert version_of(path) == SCHEMA_VERSION
    assert not list(tmp_path.glob(config.BACKUP_PREFIX + "*"))   # nothing to protect, so no copy


def test_an_in_memory_database_upgrades_without_a_backup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    from sqlalchemy.pool import StaticPool
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    raw = engine.raw_connection()
    raw.driver_connection.executescript(OLD_SCHEMA)
    raw.driver_connection.execute("INSERT INTO installs VALUES (?, '2026-10-01 09:00:00', '2026-10-01 09:00:00')", (INSTALL,))
    raw.driver_connection.execute("INSERT INTO scans (install_id, domain, https, observed_at, received_at, signals) VALUES (?, 'a.b.example.com', 1, '2026-10-01 09:00:00', '2026-10-01 09:00:00', '{}')", (INSTALL,))
    raw.driver_connection.commit()
    raw.close()
    result = upgrade(engine)
    assert result["action"] == "migrated" and result["backup"] is None
    from sqlalchemy.orm import Session
    with Session(engine) as db:
        assert db.query(models.Scan).one().site == "example.com"


def test_a_migrated_database_works_with_the_models(old_db, tmp_path):
    from sqlalchemy.orm import Session
    upgrade(engine_for(old_db), backup_dir=tmp_path)
    with Session(engine_for(old_db)) as db:
        # (the deliberately damaged row cannot be read as JSON by the ORM, so it is left out here)
        scans = {s.domain: s for s in db.query(models.Scan).filter(models.Scan.domain != "odd.example")}
        assert scans["www.wikipedia.org"].tracker_count == 2 and scans["www.wikipedia.org"].inpage_checked is True
        assert scans["news.bbc.co.uk"].trackers_checked is False
        assert db.query(models.ScanTracker).count() == 2

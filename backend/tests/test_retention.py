"""Retention (D-3): old visits are deleted, with everything derived from them, at most hourly."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from itv import config, retention
from itv.models import Install, Scan, ScanTracker
from itv.retention import maybe_purge, purge_expired
from tests.conftest import INSTALL_A, INSTALL_B, headers, scan_body

NOW = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)
SIGNALS = {"trackers_checked": True, "trackers": [{"domain": "ads.test", "category": "advertising"}, {"domain": "stats.test", "category": "analytics"}]}


@pytest.fixture()
def db(client):
    session = client.session_factory()
    yield session
    session.close()


def add_scan(db, install_id, observed_at, domain="example.com"):
    if db.get(Install, install_id) is None:
        db.add(Install(install_id=install_id, first_seen=NOW, last_seen=NOW))
    scan = Scan(install_id=install_id, domain=domain, https=True, observed_at=observed_at, received_at=NOW, signals=SIGNALS)
    db.add(scan)
    db.flush()
    from itv.store import add_scan_derived
    add_scan_derived(db, scan)
    db.commit()
    return scan.id


def counts(db):
    return db.scalar(select(func.count()).select_from(Scan)), db.scalar(select(func.count()).select_from(ScanTracker))


def test_visits_older_than_the_period_are_deleted_with_their_tracker_rows(db):
    old = add_scan(db, INSTALL_A, NOW - timedelta(days=91))
    edge_in = add_scan(db, INSTALL_A, NOW - timedelta(days=90) + timedelta(seconds=1))
    recent = add_scan(db, INSTALL_B, NOW - timedelta(days=1))
    assert counts(db) == (3, 6)
    assert purge_expired(db, now=NOW, days=90) == 1
    assert sorted(db.scalars(select(Scan.id))) == sorted([edge_in, recent])
    assert counts(db) == (2, 4)
    assert not db.scalars(select(ScanTracker).where(ScanTracker.scan_id == old)).all()


def test_nothing_is_deleted_when_nothing_is_old(db):
    add_scan(db, INSTALL_A, NOW - timedelta(days=5))
    assert purge_expired(db, now=NOW, days=90) == 0
    assert counts(db) == (1, 2)


def test_zero_days_keeps_everything(db):
    add_scan(db, INSTALL_A, NOW - timedelta(days=4000))
    assert purge_expired(db, now=NOW, days=0) == 0
    assert counts(db)[0] == 1


def test_the_period_comes_from_the_environment_and_unusable_values_mean_90(monkeypatch):
    for raw, expected in [("30", 30), ("0", 0), ("365", 365), ("abc", 90), ("-5", 90), ("", 90), ("1.5", 90)]:
        monkeypatch.setenv("ITV_RETENTION_DAYS", raw)
        assert config._retention_days() == expected, raw
    monkeypatch.delenv("ITV_RETENTION_DAYS")
    assert config._retention_days() == 90


def test_the_configured_period_is_used_when_none_is_passed(db, monkeypatch):
    add_scan(db, INSTALL_A, NOW - timedelta(days=40))
    monkeypatch.setattr(config, "RETENTION_DAYS", 30)
    assert purge_expired(db, now=NOW) == 1
    assert counts(db) == (0, 0)


def test_the_purge_runs_at_most_once_an_hour(db):
    retention.reset_throttle()
    add_scan(db, INSTALL_A, NOW - timedelta(days=200))
    assert maybe_purge(db, now=NOW) == 1                                   # first call: runs
    add_scan(db, INSTALL_A, NOW - timedelta(days=200))
    assert maybe_purge(db, now=NOW + timedelta(minutes=59)) is None        # within the hour: skipped
    assert counts(db)[0] == 1
    assert maybe_purge(db, now=NOW + timedelta(hours=1)) == 1              # an hour later: runs again
    assert counts(db) == (0, 0)


def test_a_failing_purge_never_raises_and_is_retried_later(db, monkeypatch):
    retention.reset_throttle()
    add_scan(db, INSTALL_A, NOW - timedelta(days=200))

    def boom(*args, **kwargs):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(retention, "purge_expired", boom)
    assert maybe_purge(db, now=NOW) is None
    monkeypatch.undo()
    assert maybe_purge(db, now=NOW + timedelta(hours=2)) == 1


def test_posting_a_visit_triggers_the_purge_at_most_hourly(client):
    # A visit dated years ago is accepted, then removed by the purge that follows it.
    first = client.post("/api/v1/scans", json=scan_body(observed_at="2020-01-01T00:00:00Z"), headers=headers())
    assert first.status_code == 201
    assert client.get("/api/v1/scans", headers=headers()).json()["scans"] == []
    # A second old visit within the hour is kept: the purge is throttled, not run on every request.
    client.post("/api/v1/scans", json=scan_body(domain="two.example", observed_at="2020-01-02T00:00:00Z"), headers=headers())
    assert [s["domain"] for s in client.get("/api/v1/scans", headers=headers()).json()["scans"]] == ["two.example"]


def test_a_recent_visit_posted_normally_is_kept(client):
    body = scan_body(observed_at=(datetime.now(timezone.utc) - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ"))
    client.post("/api/v1/scans", json=body, headers=headers())
    assert len(client.get("/api/v1/scans", headers=headers()).json()["scans"]) == 1

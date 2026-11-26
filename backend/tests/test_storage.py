"""Deleting must remove everything derived from a visit, not only the visit row."""
from datetime import datetime, timezone

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from itv import config
from itv.db import Base
from itv.models import Install, Scan, ScanTracker
from itv.store import delete_install_data, remove_migration_backups
from tests.conftest import INSTALL_A, INSTALL_B, headers, scan_body

NOW = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)


def with_trackers(domain="example.com", trackers=("ads.test", "stats.test")):
    body = scan_body(domain=domain)
    body["signals"] = {
        "trackers_checked": True, "inpage_checked": True, "third_party_requests": 5,
        "trackers": [{"domain": t, "category": "advertising", "company": "Co"} for t in trackers],
        "cookies": {"first_party": 1, "third_party": 2, "by_trackers": 1},
        "fingerprinting": {"canvas": 2, "webgl": 0, "audio": 0, "font": 1}, "geolocation_calls": 1,
    }
    return body


def rows(client, model):
    with client.session_factory() as db:
        return db.scalar(select(func.count()).select_from(model))


def test_a_posted_visit_gets_its_derived_columns_and_tracker_rows(client):
    client.post("/api/v1/scans", json=with_trackers("www.bbc.co.uk"), headers=headers())
    with client.session_factory() as db:
        scan = db.scalars(select(Scan)).one()
        assert (scan.site, scan.tracker_count, scan.third_party_requests, scan.cookies_third_party) == ("bbc.co.uk", 2, 5, 2)
        assert (scan.fp_canvas, scan.fp_font, scan.geolocation_calls, scan.trackers_checked, scan.inpage_checked) == (2, 1, 1, True, True)
        trackers = db.scalars(select(ScanTracker).order_by(ScanTracker.domain)).all()
        assert [(t.scan_id, t.domain, t.category, t.company) for t in trackers] == [(scan.id, "ads.test", "advertising", "Co"), (scan.id, "stats.test", "advertising", "Co")]
        assert scan.signals["trackers"][0]["domain"] == "ads.test"          # the raw JSON is kept as sent


def test_the_list_and_detail_answers_are_unchanged(client):
    created = client.post("/api/v1/scans", json=with_trackers(), headers=headers()).json()
    listed = client.get("/api/v1/scans", headers=headers()).json()["scans"][0]
    assert isinstance(listed.pop("privacy_score"), int)       # added in M3c; everything else is as before
    assert listed == {"id": created["id"], "domain": "example.com", "https": True, "observed_at": "2026-10-01T09:15:00Z",
                      "third_party_requests": 5, "tracker_count": 2, "third_party_cookies": 2, "trackers_checked": True}
    detail = client.get(f"/api/v1/scans/{created['id']}", headers=headers()).json()
    assert detail["signals"]["inpage_checked"] is True and detail["signals"]["fingerprinting"]["canvas"] == 2


def test_delete_my_data_removes_visits_tracker_rows_and_the_install(client):
    client.post("/api/v1/scans", json=with_trackers(), headers=headers(INSTALL_A))
    client.post("/api/v1/scans", json=with_trackers("other.example", ("x.test",)), headers=headers(INSTALL_B))
    assert (rows(client, Scan), rows(client, ScanTracker), rows(client, Install)) == (2, 3, 2)
    assert client.delete("/api/v1/me", headers=headers(INSTALL_A)).json() == {"deleted_scans": 1}
    assert (rows(client, Scan), rows(client, ScanTracker), rows(client, Install)) == (1, 1, 1)   # only B's data is left
    with client.session_factory() as db:
        assert db.scalars(select(ScanTracker.domain)).all() == ["x.test"]


def test_deleting_works_even_with_sqlite_foreign_keys_off():
    """Deletion must not depend on a connection setting: the code deletes the tracker rows itself."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)  # no FK listener
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 0
        db.add(Install(install_id=INSTALL_A, first_seen=NOW, last_seen=NOW))
        scan = Scan(install_id=INSTALL_A, domain="example.com", https=True, observed_at=NOW, received_at=NOW, signals={"trackers": [{"domain": "ads.test"}]})
        db.add(scan)
        db.flush()
        from itv.store import add_scan_derived
        add_scan_derived(db, scan)
        db.commit()
        assert db.scalar(select(func.count()).select_from(ScanTracker)) == 1
        assert delete_install_data(db, INSTALL_A) == 1
        db.commit()
        assert db.scalar(select(func.count()).select_from(ScanTracker)) == 0
        assert db.scalar(select(func.count()).select_from(Scan)) == 0


def test_with_foreign_keys_on_the_database_also_cascades(client):
    client.post("/api/v1/scans", json=with_trackers(), headers=headers())
    with client.session_factory() as db:
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
        db.execute(text("DELETE FROM scans"))     # a plain delete that knows nothing about tracker rows
        db.commit()
        assert db.scalar(select(func.count()).select_from(ScanTracker)) == 0


def test_delete_my_data_also_removes_migration_backups(client, private_data_dir):
    private_data_dir.mkdir(parents=True)
    backup = private_data_dir / f"{config.BACKUP_PREFIX}v0-20261113T120000Z"
    other = private_data_dir / "notes.txt"
    backup.write_bytes(b"old copy of the database")
    other.write_text("not a backup")
    client.post("/api/v1/scans", json=with_trackers(), headers=headers())
    client.delete("/api/v1/me", headers=headers())
    assert not backup.exists() and other.exists()


def test_removing_backups_with_no_data_folder_is_harmless(tmp_path):
    assert remove_migration_backups(tmp_path / "does-not-exist") == 0

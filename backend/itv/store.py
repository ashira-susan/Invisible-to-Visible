"""Writing and deleting visits, so everything derived from a visit goes with it."""
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import config
from .derive import derived_columns, tracker_rows
from .models import Install, Scan, ScanTracker


def add_scan_derived(db: Session, scan: Scan) -> None:
    """Fill the derived columns and add the tracker rows for a scan that has a domain and signals.
    The scan must already have an id (flush first)."""
    for name, value in derived_columns(scan.domain, scan.signals).items():
        setattr(scan, name, value)
    for t in tracker_rows(scan.signals):
        db.add(ScanTracker(scan_id=scan.id, **t))


def delete_scans_where(db: Session, condition) -> int:
    """Delete scans matching `condition` and, explicitly, their tracker rows. (The foreign key
    would cascade too, but deletion must not depend on a SQLite setting.)"""
    ids = select(Scan.id).where(condition)
    db.execute(delete(ScanTracker).where(ScanTracker.scan_id.in_(ids)))
    return db.execute(delete(Scan).where(condition)).rowcount or 0


def delete_install_data(db: Session, install_id: str) -> int:
    """Everything stored for one install: its visits, their tracker rows and the install record."""
    deleted = delete_scans_where(db, Scan.install_id == install_id)
    db.execute(delete(Install).where(Install.install_id == install_id))
    return deleted


def remove_migration_backups(directory: Path | None = None) -> int:
    """Delete the safety copies made before migrations. They hold browsing history."""
    directory = directory or config.DATA_DIR
    removed = 0
    if directory.is_dir():
        for path in directory.glob(f"{config.BACKUP_PREFIX}*"):
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
    return removed

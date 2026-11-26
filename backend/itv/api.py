"""HTTP routes. Identity is the X-Install-ID header (a random UUIDv4 made by the extension)."""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import __version__
from .db import get_db
from .models import Install, Scan
from .retention import maybe_purge
from .store import add_scan_derived, delete_install_data, remove_migration_backups
from .schemas import Deleted, ScanCreated, ScanDetail, ScanList, ScanOut, ScanSummary, Signals
from . import visits as visit_loader

router = APIRouter(prefix="/api/v1")


def install_id_header(
    x_install_id: Annotated[str | None, Header()] = None,
) -> str:
    if not x_install_id:
        raise HTTPException(status_code=401, detail="Missing X-Install-ID header.")
    try:
        parsed = uuid.UUID(x_install_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Install-ID must be a UUID.")
    if parsed.version != 4:
        raise HTTPException(
            status_code=400, detail="X-Install-ID must be a version 4 UUID."
        )
    return str(parsed)


def _to_out(row: Scan, privacy_score: int | None = None) -> ScanOut:
    return ScanOut(
        id=row.id,
        domain=row.domain,
        https=row.https,
        observed_at=row.observed_at,
        third_party_requests=row.third_party_requests,
        tracker_count=row.tracker_count,
        third_party_cookies=row.cookies_third_party,
        trackers_checked=row.trackers_checked,
        privacy_score=privacy_score,
    )


@router.get("/health")
def health():
    return {"status": "ok", "version": __version__}


@router.post("/scans", response_model=ScanCreated, status_code=201)
def create_scan(
    summary: ScanSummary,
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    install = db.get(Install, install_id)
    if install is None:
        db.add(Install(install_id=install_id, first_seen=now, last_seen=now))
    else:
        install.last_seen = now

    scan = Scan(
        install_id=install_id,
        domain=summary.site.domain,
        https=summary.site.https,
        referrer_origin=summary.site.referrer_origin,
        observed_at=summary.observed_at,
        received_at=now,
        signals=summary.signals.model_dump(mode="json"),
    )
    db.add(scan)
    db.flush()  # gives the scan its id
    add_scan_derived(db, scan)
    db.commit()
    maybe_purge(db)  # at most once an hour; never fails the request
    return ScanCreated(id=scan.id, domain=scan.domain)


@router.get("/scans", response_model=ScanList)
def list_scans(
    limit: int = Query(100, ge=1, le=500),
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    loaded = visit_loader.load(db, install_id, limit=limit)
    return ScanList(scans=[_to_out(v.scan, v.score) for v in loaded])


@router.get("/scans/{scan_id}", response_model=ScanDetail)
def get_scan(
    scan_id: int,
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    row = db.get(Scan, scan_id)
    # Someone else's scan looks exactly like a missing one.
    if row is None or row.install_id != install_id:
        raise HTTPException(status_code=404, detail="Scan not found.")
    visit = visit_loader.load(db, install_id, ids=[scan_id])[0]
    return ScanDetail(
        **_to_out(row, visit.score).model_dump(),
        referrer_origin=row.referrer_origin,
        signals=Signals.model_validate(row.signals or {}),
        privacy=visit.privacy,
    )


@router.delete("/me", response_model=Deleted)
def delete_my_data(
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    deleted = delete_install_data(db, install_id)  # visits, their tracker rows and the install record
    db.commit()
    remove_migration_backups()  # a safety copy made before a migration holds the same history
    return Deleted(deleted_scans=deleted)

"""HTTP routes. Identity is the X-Install-ID header (a random UUIDv4 made by the extension)."""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import __version__
from .db import get_db
from .models import Install, Scan
from .schemas import Deleted, ScanCreated, ScanDetail, ScanList, ScanOut, ScanSummary, Signals

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


def _to_out(row: Scan) -> ScanOut:
    signals = row.signals or {}
    return ScanOut(
        id=row.id,
        domain=row.domain,
        https=row.https,
        observed_at=row.observed_at,
        third_party_requests=signals.get("third_party_requests", 0),
        tracker_count=len(signals.get("trackers", [])),
        trackers_checked=bool(signals.get("trackers_checked", False)),
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
    db.commit()
    return ScanCreated(id=scan.id, domain=scan.domain)


@router.get("/scans", response_model=ScanList)
def list_scans(
    limit: int = Query(100, ge=1, le=500),
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Scan)
        .where(Scan.install_id == install_id)
        .order_by(Scan.observed_at.desc(), Scan.id.desc())
        .limit(limit)
    ).all()
    return ScanList(scans=[_to_out(r) for r in rows])


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
    return ScanDetail(**_to_out(row).model_dump(), signals=Signals.model_validate(row.signals or {}))


@router.delete("/me", response_model=Deleted)
def delete_my_data(
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    result = db.execute(delete(Scan).where(Scan.install_id == install_id))
    db.execute(delete(Install).where(Install.install_id == install_id))
    db.commit()
    return Deleted(deleted_scans=result.rowcount or 0)

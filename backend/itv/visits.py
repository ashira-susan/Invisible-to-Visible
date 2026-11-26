"""Loading visits together with their tracker rows and computed Privacy Scores."""
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Scan, ScanTracker
from .scoring import score_visit

DERIVED = (
    "trackers_checked", "inpage_checked", "third_party_requests", "tracker_count",
    "cookies_first_party", "cookies_third_party", "cookies_by_trackers",
    "fp_canvas", "fp_webgl", "fp_audio", "fp_font", "geolocation_calls",
)


@dataclass
class Visit:
    scan: Scan
    trackers: list[dict] = field(default_factory=list)
    privacy: dict = field(default_factory=dict)

    @property
    def site(self) -> str:
        return self.scan.site or self.scan.domain

    @property
    def score(self) -> int | None:
        return self.privacy.get("score")


def derived_values(scan: Scan) -> dict:
    return {name: getattr(scan, name) for name in DERIVED}


def tracker_dict(row: ScanTracker) -> dict:
    return {"domain": row.domain, "category": row.category, "company": row.company, "known_fingerprinter": row.known_fingerprinter}


def build(scans: list[Scan], tracker_rows: list[ScanTracker]) -> list[Visit]:
    by_scan: dict[int, list[dict]] = {}
    for row in tracker_rows:
        by_scan.setdefault(row.scan_id, []).append(tracker_dict(row))
    visits = []
    for scan in scans:
        trackers = sorted(by_scan.get(scan.id, []), key=lambda t: t["domain"])
        visits.append(Visit(scan=scan, trackers=trackers, privacy=score_visit(derived_values(scan), trackers)))
    return visits


def load(db: Session, install_id: str, *, since=None, site: str | None = None, ids: list[int] | None = None, limit: int | None = None) -> list[Visit]:
    """One install's visits, newest first, each with its tracker rows and score."""
    conditions = [Scan.install_id == install_id]
    if since is not None:
        conditions.append(Scan.observed_at >= since)
    if site is not None:
        conditions.append((Scan.site == site) | ((Scan.site.is_(None)) & (Scan.domain == site)))
    if ids is not None:
        conditions.append(Scan.id.in_(ids))
    query = select(Scan).where(*conditions).order_by(Scan.observed_at.desc(), Scan.id.desc())
    if limit is not None:
        query = query.limit(limit)
    scans = db.scalars(query).all()
    if not scans:
        return []
    return build(scans, _tracker_rows(db, [s.id for s in scans]))


def _tracker_rows(db: Session, scan_ids: list[int]) -> list[ScanTracker]:
    """The tracker rows of many visits, a few hundred ids per query (never one query per visit)."""
    rows: list[ScanTracker] = []
    for start in range(0, len(scan_ids), 500):
        chunk = scan_ids[start:start + 500]
        rows.extend(db.scalars(select(ScanTracker).where(ScanTracker.scan_id.in_(chunk))).all())
    return rows

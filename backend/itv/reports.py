"""Reports built from the stored visits: sites day by day, one site, trackers, trends, export.

Everything is scoped to the install named in X-Install-ID. Days are the user's local days:
the caller passes `offset_minutes` (minutes ahead of UTC; in JavaScript `-new Date().getTimezoneOffset()`),
so no time-zone database is needed on the server. Visits where tracking could not be observed
(`trackers_checked` false) are counted as visits but never given a score, never counted as
"no trackers", and never averaged into a site's score.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from . import visits as loader
from .api import install_id_header
from .db import get_db
from .models import Install
from .scoring import band_for, load_weights, median_and_range

router = APIRouter(prefix="/api/v1")

SITE_SCORE_VISITS = 10  # a site's score is the median of its latest 10 scored visits
OffsetQuery = Query(0, ge=-840, le=840, description="Minutes ahead of UTC (JavaScript: -new Date().getTimezoneOffset()).")


def current_time() -> datetime:
    return datetime.now(timezone.utc)


def local_day(moment: datetime, offset: int) -> date:
    return (moment + timedelta(minutes=offset)).date()


def window_start(now: datetime, days: int, offset: int) -> datetime:
    """UTC instant at which the oldest local day of the window begins."""
    first = local_day(now, offset) - timedelta(days=days - 1)
    return datetime(first.year, first.month, first.day, tzinfo=timezone.utc) - timedelta(minutes=offset)


def _summary(scores: list[int]) -> dict:
    median, low, high = median_and_range(scores)
    band = band_for(median)
    return {"score": median, "score_min": low, "score_max": high, "band": band["key"] if band else None}


# ---- response models -------------------------------------------------------------------

class SiteDay(BaseModel):
    site: str
    visits: int
    checked_visits: int          # visits where tracking could be observed
    score: int | None            # median Privacy Score of the checked visits that day; null if none
    score_min: int | None
    score_max: int | None
    band: str | None
    distinct_trackers: int       # across the checked visits
    third_party_requests: int    # across the checked visits
    last_visit: datetime


class DayOut(BaseModel):
    day: str
    visits: int
    checked_visits: int
    sites: list[SiteDay]


class SitesResponse(BaseModel):
    window_days: int
    offset_minutes: int
    scoring_version: str
    days: list[DayOut]


class RecentVisit(BaseModel):
    id: int
    observed_at: datetime
    score: int | None
    band: str | None
    trackers_checked: bool
    inpage_checked: bool


class SiteTracker(BaseModel):
    domain: str
    company: str | None
    category: str
    known_fingerprinter: bool
    visits_seen: int             # out of `checked_visits`


class SiteDetail(BaseModel):
    site: str
    scoring_version: str
    visits: int
    checked_visits: int
    scored_visits: int           # how many visits the score is the median of (at most 10)
    partial_visits: int          # of those, how many had no page-script check
    score: int | None
    score_min: int | None
    score_max: int | None
    band: str | None
    label: str
    first_visit: datetime
    last_visit: datetime
    recent: list[RecentVisit]
    trackers: list[SiteTracker]


class TrackerOut(BaseModel):
    domain: str
    company: str | None
    category: str
    known_fingerprinter: bool
    visits_seen: int
    sites_seen: int
    first_seen: datetime
    last_seen: datetime


class CompanyOut(BaseModel):
    company: str
    trackers: int
    visits_seen: int
    sites_seen: int


class TrackersResponse(BaseModel):
    window_days: int
    offset_minutes: int
    checked_visits: int          # the denominator: visits where trackers could be observed
    unchecked_visits: int        # visits that say nothing about trackers
    trackers: list[TrackerOut]
    companies: list[CompanyOut]


class TrendDay(BaseModel):
    day: str
    visits: int
    checked_visits: int
    unchecked_visits: int
    median_score: int | None
    score_min: int | None
    score_max: int | None
    distinct_trackers: int


class TrendsResponse(BaseModel):
    window_days: int
    offset_minutes: int
    scoring_version: str
    days: list[TrendDay]


# ---- endpoints -------------------------------------------------------------------------

def _window(db, install_id, days, offset, now):
    return loader.load(db, install_id, since=window_start(now, days, offset))


@router.get("/sites", response_model=SitesResponse)
def sites_by_day(
    days: int = Query(7, ge=1, le=366),
    offset_minutes: int = OffsetQuery,
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
    now: datetime = Depends(current_time),
):
    grouped: dict[date, dict[str, list[loader.Visit]]] = defaultdict(lambda: defaultdict(list))
    for v in _window(db, install_id, days, offset_minutes, now):
        grouped[local_day(v.scan.observed_at, offset_minutes)][v.site].append(v)

    out = []
    for day in sorted(grouped, reverse=True):
        sites = []
        for site, vs in grouped[day].items():
            checked = [v for v in vs if v.scan.trackers_checked]
            sites.append(SiteDay(
                site=site, visits=len(vs), checked_visits=len(checked),
                **_summary([v.score for v in checked]),
                distinct_trackers=len({t["domain"] for v in checked for t in v.trackers}),
                third_party_requests=sum(v.scan.third_party_requests for v in checked),
                last_visit=max(v.scan.observed_at for v in vs),
            ))
        sites.sort(key=lambda s: (-s.visits, s.site))
        day_visits = [v for vs in grouped[day].values() for v in vs]
        out.append(DayOut(day=day.isoformat(), visits=len(day_visits),
                          checked_visits=sum(1 for v in day_visits if v.scan.trackers_checked), sites=sites))
    return SitesResponse(window_days=days, offset_minutes=offset_minutes, scoring_version=load_weights()["version"], days=out)


@router.get("/sites/{site}", response_model=SiteDetail)
def site_detail(
    site: str,
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
):
    vs = loader.load(db, install_id, site=site.lower())
    if not vs:
        raise HTTPException(status_code=404, detail="No visits to that site.")
    checked = [v for v in vs if v.scan.trackers_checked]
    scored = [v for v in checked if v.score is not None][:SITE_SCORE_VISITS]   # newest first
    summary = _summary([v.score for v in scored])

    seen: dict[str, dict] = {}
    for v in checked:                                  # newest first, so the latest category and company win
        for t in v.trackers:
            entry = seen.setdefault(t["domain"], {**t, "visits_seen": 0})
            entry["visits_seen"] += 1
    trackers = sorted(seen.values(), key=lambda t: (-t["visits_seen"], t["domain"]))[:100]

    band = band_for(summary["score"])
    return SiteDetail(
        site=site.lower(), scoring_version=load_weights()["version"],
        visits=len(vs), checked_visits=len(checked), scored_visits=len(scored),
        partial_visits=sum(1 for v in scored if not v.scan.inpage_checked),
        **summary, label=band["label"] if band else "Not enough evidence",
        first_visit=min(v.scan.observed_at for v in vs), last_visit=max(v.scan.observed_at for v in vs),
        recent=[RecentVisit(id=v.scan.id, observed_at=v.scan.observed_at, score=v.score,
                            band=v.privacy.get("band"), trackers_checked=v.scan.trackers_checked,
                            inpage_checked=v.scan.inpage_checked) for v in vs[:10]],
        trackers=[SiteTracker(**t) for t in trackers],
    )


@router.get("/trackers", response_model=TrackersResponse)
def trackers_seen(
    days: int = Query(30, ge=1, le=366),
    offset_minutes: int = OffsetQuery,
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
    now: datetime = Depends(current_time),
):
    window = _window(db, install_id, days, offset_minutes, now)
    checked = [v for v in window if v.scan.trackers_checked]
    by_domain: dict[str, dict] = {}
    for v in checked:                                  # newest first
        for t in v.trackers:
            e = by_domain.setdefault(t["domain"], {**t, "visits": set(), "sites": set(), "first_seen": v.scan.observed_at, "last_seen": v.scan.observed_at})
            e["visits"].add(v.scan.id)
            e["sites"].add(v.site)
            e["first_seen"] = min(e["first_seen"], v.scan.observed_at)
            e["last_seen"] = max(e["last_seen"], v.scan.observed_at)
    trackers = sorted(by_domain.values(), key=lambda e: (-len(e["visits"]), e["domain"]))

    by_company: dict[str, dict] = {}
    for e in by_domain.values():
        if e["company"]:
            c = by_company.setdefault(e["company"], {"trackers": 0, "visits": set(), "sites": set()})
            c["trackers"] += 1
            c["visits"] |= e["visits"]
            c["sites"] |= e["sites"]
    companies = sorted(by_company.items(), key=lambda kv: (-len(kv[1]["visits"]), kv[0]))

    return TrackersResponse(
        window_days=days, offset_minutes=offset_minutes,
        checked_visits=len(checked), unchecked_visits=len(window) - len(checked),
        trackers=[TrackerOut(domain=e["domain"], company=e["company"], category=e["category"],
                             known_fingerprinter=e["known_fingerprinter"], visits_seen=len(e["visits"]),
                             sites_seen=len(e["sites"]), first_seen=e["first_seen"], last_seen=e["last_seen"])
                  for e in trackers[:200]],
        companies=[CompanyOut(company=name, trackers=c["trackers"], visits_seen=len(c["visits"]), sites_seen=len(c["sites"]))
                   for name, c in companies[:100]],
    )


@router.get("/trends", response_model=TrendsResponse)
def trends(
    days: int = Query(30, ge=1, le=366),
    offset_minutes: int = OffsetQuery,
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
    now: datetime = Depends(current_time),
):
    grouped: dict[date, list[loader.Visit]] = defaultdict(list)
    for v in _window(db, install_id, days, offset_minutes, now):
        grouped[local_day(v.scan.observed_at, offset_minutes)].append(v)

    today = local_day(now, offset_minutes)
    out = []
    for back in range(days - 1, -1, -1):          # every day of the window, oldest first, so a chart has no gaps
        day = today - timedelta(days=back)
        vs = grouped.get(day, [])
        checked = [v for v in vs if v.scan.trackers_checked]
        s = _summary([v.score for v in checked])
        out.append(TrendDay(day=day.isoformat(), visits=len(vs), checked_visits=len(checked),
                            unchecked_visits=len(vs) - len(checked), median_score=s["score"],
                            score_min=s["score_min"], score_max=s["score_max"],
                            distinct_trackers=len({t["domain"] for v in checked for t in v.trackers})))
    return TrendsResponse(window_days=days, offset_minutes=offset_minutes, scoring_version=load_weights()["version"], days=out)


@router.get("/export")
def export_everything(
    install_id: str = Depends(install_id_header),
    db: Session = Depends(get_db),
    now: datetime = Depends(current_time),
):
    """Everything stored for this install, as a JSON download: the install record, every visit
    with its raw signals as received, the derived columns, its tracker rows, and the Privacy Score
    computed from them (the score is not stored; it is included for convenience)."""
    install = db.get(Install, install_id)
    vs = sorted(loader.load(db, install_id), key=lambda v: (v.scan.observed_at, v.scan.id))   # oldest first
    document = {
        "export_version": "1",
        "exported_at": now,
        "scoring_version": load_weights()["version"],
        "retention_days": config.RETENTION_DAYS,
        "install": None if install is None else {"install_id": install.install_id, "first_seen": install.first_seen, "last_seen": install.last_seen},
        "scans": [{
            "id": v.scan.id, "domain": v.scan.domain, "site": v.site, "https": v.scan.https,
            "referrer_origin": v.scan.referrer_origin, "observed_at": v.scan.observed_at,
            "received_at": v.scan.received_at, "signals": v.scan.signals,
            "derived": loader.derived_values(v.scan), "trackers": v.trackers, "privacy": v.privacy,
        } for v in vs],
    }
    return JSONResponse(
        # dates as 2026-11-13T12:00:00Z, the same way every other endpoint writes them
        content=jsonable_encoder(document, custom_encoder={datetime: lambda d: d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")}),
        headers={"Content-Disposition": 'attachment; filename="invisible-to-visible-export.json"'},
    )

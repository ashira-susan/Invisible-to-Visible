"""The data contract between the extension and the backend (schema version 1).

This file is the single source of truth. docs/schemas/scan-summary.v1.schema.json
is generated from it (python tools/export_schema.py).

Privacy rules enforced here, not just documented:
  * unknown fields are rejected (extra="forbid"), so a URL, page title or cookie
    value cannot be sent by accident;
  * the site is a bare hostname, never a URL;
  * the referrer is an origin only (scheme + host [+ port]), never a path.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

SCHEMA_VERSION = "1"

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
HOSTNAME_PATTERN = "^" + _LABEL + r"(?:\." + _LABEL + ")*$"
ORIGIN_PATTERN = r"^https?://" + _LABEL + r"(?:\." + _LABEL + r")*(?::[0-9]{1,5})?$"

Hostname = Annotated[
    str, StringConstraints(min_length=1, max_length=253, pattern=HOSTNAME_PATTERN)
]
Origin = Annotated[str, StringConstraints(max_length=300, pattern=ORIGIN_PATTERN)]
Count = Annotated[int, Field(ge=0, le=100_000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TrackerCategory(str, Enum):
    advertising = "advertising"
    analytics = "analytics"
    social = "social"
    fingerprinting = "fingerprinting"
    content = "content"
    other = "other"


Company = Annotated[str, StringConstraints(min_length=1, max_length=100)]


class TrackerSeen(StrictModel):
    """A known tracker the page contacted. `domain` is the listed tracker domain
    (doubleclick.net), not the exact subdomain that was requested."""

    domain: Hostname
    category: TrackerCategory = TrackerCategory.other
    company: Company | None = None
    known_fingerprinter: bool = False  # the tracker list marks it as using fingerprinting


class CookieCounts(StrictModel):
    first_party: Count = 0
    third_party: Count = 0


class FingerprintingCounts(StrictModel):
    canvas: Count = 0
    webgl: Count = 0
    audio: Count = 0
    font: Count = 0


class Signals(StrictModel):
    """What the page did. Missing values mean "none seen", except that
    `trackers_checked` tells you whether anyone was looking: False means the user only
    allowed site names, so an empty tracker list is "unknown", not "clean"."""

    trackers_checked: bool = False
    third_party_requests: Count = 0
    trackers: list[TrackerSeen] = Field(default_factory=list, max_length=200)
    cookies: CookieCounts = Field(default_factory=CookieCounts)
    fingerprinting: FingerprintingCounts = Field(default_factory=FingerprintingCounts)
    geolocation_calls: Count = 0


class Site(StrictModel):
    domain: Hostname
    https: bool
    referrer_origin: Origin | None = None


class ScanSummary(StrictModel):
    """One page visit, summarised on the device. Identity travels in the
    X-Install-ID header, not in the body."""

    schema_version: Literal["1"]
    observed_at: datetime
    site: Site
    signals: Signals = Field(default_factory=Signals)

    @field_validator("observed_at")
    @classmethod
    def _aware_and_not_in_future(cls, v: datetime) -> datetime:
        if v.tzinfo is None or v.utcoffset() is None:
            raise ValueError(
                "observed_at must include a timezone, e.g. 2026-10-30T09:15:00Z"
            )
        if v > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("observed_at is in the future")
        return v


# ---- API responses -------------------------------------------------------

class ScanCreated(BaseModel):
    id: int
    domain: str


class ScanOut(BaseModel):
    id: int
    domain: str
    https: bool
    observed_at: datetime
    third_party_requests: int = 0
    tracker_count: int = 0
    trackers_checked: bool = False


class ScanDetail(ScanOut):
    signals: Signals


class ScanList(BaseModel):
    scans: list[ScanOut]


class Deleted(BaseModel):
    deleted_scans: int

"""Shows how the Privacy Score is distributed over the visits stored in a database.

Read-only. Run it from the backend folder to check the weights against your own browsing:

    python tools/score_distribution.py                  # backend/data/itv.db
    python tools/score_distribution.py path\\to\\itv.db

If nearly every visit lands at 0 or at 100 the weights are too strong or too weak, and the
numbers in itv/knowledge/privacy_score.json (and its version) should be adjusted.
Only hostnames, counts and tracker names are printed, the same data the dashboard shows.
"""
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from itv import config, visits as loader  # noqa: E402
from itv.models import Install  # noqa: E402
from itv.scoring import load_weights, median_and_range  # noqa: E402


def main(argv=None, out=print) -> int:
    argv = sys.argv[1:] if argv is None else argv
    path = Path(argv[0]) if argv else config.DATA_DIR / "itv.db"
    if not path.is_file():
        out(f"No database at {path}")
        return 1
    engine = create_engine(f"sqlite:///file:{path.as_posix()}?mode=ro&uri=true")
    with Session(engine) as db:
        installs = db.scalars(select(Install.install_id)).all()
        visits = [v for install in installs for v in loader.load(db, install)]

    scored = [v for v in visits if v.score is not None]
    out(f"Visits: {len(visits)}   scored: {len(scored)}   not scored (tracking could not be observed): {len(visits) - len(scored)}")
    out(f"Scored without a page-script check: {sum(1 for v in scored if not v.scan.inpage_checked)}")
    if not scored:
        return 0
    out(f"Weights version: {load_weights()['version']}")

    out("\nScore histogram (scored visits)")
    buckets = Counter(min(v.score // 10, 9) for v in scored)
    for b in range(9, -1, -1):
        lo, hi = b * 10, b * 10 + 9 if b < 9 else 100
        n = buckets.get(b, 0)
        out(f"  {lo:3d}-{hi:<3d} {'#' * round(40 * n / len(scored)):<40} {n}")
    at_floor = sum(1 for v in scored if v.score == 0)
    at_top = sum(1 for v in scored if v.score == 100)
    out(f"  exactly 0: {at_floor} ({100 * at_floor // len(scored)}%)   exactly 100: {at_top} ({100 * at_top // len(scored)}%)")

    bands = Counter(v.privacy["band"] for v in scored)
    out("\nBands: " + ", ".join(f"{k} {n}" for k, n in sorted(bands.items())))

    points = defaultdict(float)
    for v in scored:
        for f in v.privacy["factors"]:
            points[f["id"]] += f["points"]
    out("\nAverage points per scored visit, by factor (what drives the score)")
    for fid, total in sorted(points.items(), key=lambda kv: -kv[1]):
        out(f"  {fid:<32} {total / len(scored):5.1f}")

    sites = defaultdict(list)
    for v in scored:
        sites[v.site].append(v.score)
    out("\nSites by number of scored visits (median, lowest-highest)")
    for site, scores in sorted(sites.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:15]:
        median, low, high = median_and_range(scores)
        out(f"  {site:<34} visits {len(scores):3d}   median {median:3d}   {low}-{high}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

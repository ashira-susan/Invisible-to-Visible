import sqlite3

from itv.migrations import upgrade
from tests.test_migration import INSTALL, engine_for
from tools import score_distribution


def make(path):
    upgrade(engine_for(path))
    conn = sqlite3.connect(path)
    conn.execute("INSERT INTO installs VALUES (?, '2026-10-01 09:00:00', '2026-10-01 09:00:00')", (INSTALL,))
    rows = [("www.bbc.com", 49, 9), ("www.bbc.com", 40, 9), ("wikipedia.org", 100, 0), ("blind.example", None, 0)]
    for i, (domain, _score, n) in enumerate(rows):
        checked = domain != "blind.example"
        conn.execute(
            "INSERT INTO scans (install_id, domain, https, observed_at, received_at, signals, site, trackers_checked, inpage_checked, third_party_requests, tracker_count) VALUES (?, ?, 1, ?, ?, '{}', ?, ?, 1, ?, ?)",
            (INSTALL, domain, f"2026-10-01 10:0{i}:00", "2026-10-01 10:30:00", domain.replace("www.", ""), int(checked), 150 * n // 9, n))
        for j in range(n):
            conn.execute("INSERT INTO scan_trackers (scan_id, domain, category, company, known_fingerprinter) VALUES (?, ?, 'advertising', NULL, 0)", (i + 1, f"t{j}.test"))
    conn.commit()
    conn.close()


def test_the_distribution_report_runs_read_only_and_never_scores_unchecked_visits(tmp_path):
    db = tmp_path / "itv.db"
    make(db)
    before = db.read_bytes()
    lines = []
    assert score_distribution.main([str(db)], out=lines.append) == 0
    text = "\n".join(lines)
    assert "Visits: 4   scored: 3   not scored" in text and "exactly 100: 1" in text
    assert "trackers.advertising" in text and "bbc.com" in text and "blind.example" not in text.split("Sites by number")[1]
    assert db.read_bytes() == before


def test_a_missing_database_is_reported_not_created(tmp_path):
    lines = []
    assert score_distribution.main([str(tmp_path / "nope.db")], out=lines.append) == 1
    assert not (tmp_path / "nope.db").exists()

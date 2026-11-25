import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from itv import models  # noqa: F401  (registers the tables)
from itv import config, retention
from itv.db import Base, enable_sqlite_foreign_keys, get_db
from itv.main import app

INSTALL_A = "5f1d3c52-8a0e-4d0b-9c1a-7d2e4b6f8a10"
INSTALL_B = "0b7e9a44-3c5d-4f6a-8b2c-1e9d7a5c3f20"


@pytest.fixture(autouse=True)
def private_data_dir(tmp_path, monkeypatch):
    """No test may touch the real backend/data folder (it can hold migration backups)."""
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(config, "RETENTION_DAYS", 90)
    return tmp_path / "data"


@pytest.fixture()
def client():
    """A test client backed by a throwaway in-memory database."""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    enable_sqlite_foreign_keys(engine)
    Base.metadata.create_all(engine)
    retention.reset_throttle()
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    test_client.engine = engine            # for tests that look inside the database
    test_client.session_factory = Session
    yield test_client
    app.dependency_overrides.clear()


def headers(install_id: str = INSTALL_A) -> dict:
    return {"X-Install-ID": install_id}


def scan_body(domain: str = "example.com", observed_at: str = "2026-10-01T09:15:00Z", https: bool = True) -> dict:
    return {
        "schema_version": "1",
        "observed_at": observed_at,
        "site": {"domain": domain, "https": https},
    }

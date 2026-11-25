"""Database engine and session handling (SQLite by default)."""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import config


class Base(DeclarativeBase):
    pass


def enable_sqlite_foreign_keys(engine) -> None:
    """SQLite ignores foreign keys unless every new connection asks for them."""
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def make_engine(url: str | None = None):
    url = url or config.DATABASE_URL
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    enable_sqlite_foreign_keys(engine)
    return engine


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Create the data folder, then create or upgrade the tables (see migrations.py)."""
    from . import models  # noqa: F401  (registers the tables on Base)
    from .migrations import upgrade

    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    upgrade(engine, backup_dir=config.DATA_DIR)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

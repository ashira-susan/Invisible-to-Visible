# ======================================================
# PriviLens X
# Database Configuration
# ======================================================

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import declarative_base


# ===========================================
# DATABASE URL
# ===========================================

DATABASE_URL = "sqlite:///./users.db"


# ===========================================
# DATABASE ENGINE
# ===========================================

engine = create_engine(

    DATABASE_URL,

    connect_args={
        "check_same_thread": False
    }

)


# ===========================================
# SESSION
# ===========================================

SessionLocal = sessionmaker(

    autocommit=False,

    autoflush=False,

    bind=engine

)


# ===========================================
# BASE MODEL
# ===========================================

Base = declarative_base()


# ===========================================
# DATABASE DEPENDENCY
# ===========================================

def get_db():

    db = SessionLocal()

    try:

        yield db

    finally:

        db.close()
# ======================================================
# CREATE TABLES
# ======================================================

import models

Base.metadata.create_all(bind=engine)
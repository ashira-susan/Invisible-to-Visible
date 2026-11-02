# ======================================================
# PriviLens X
# Database Models
# ======================================================

from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import DateTime

from datetime import datetime

from database import Base


# ======================================================
# USER TABLE
# ======================================================

class User(Base):

    __tablename__ = "users"

    id = Column(

        Integer,

        primary_key=True,

        index=True

    )

    name = Column(

        String,

        nullable=False

    )

    email = Column(

        String,

        unique=True,

        nullable=False,

        index=True

    )

    password = Column(

        String,

        nullable=False

    )

    created_at = Column(

        DateTime,

        default=datetime.utcnow

    )

    last_login = Column(

        DateTime,

        nullable=True

    )
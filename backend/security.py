import secrets
# ======================================================
# PriviLens X
# Security Module
# ======================================================

from passlib.context import CryptContext

from jose import jwt
from jose import JWTError

from datetime import datetime
from datetime import timedelta


# ===========================================
# PASSWORD HASHING
# ===========================================

pwd_context = CryptContext(

    schemes=["bcrypt"],

    deprecated="auto"

)


# ===========================================
# JWT CONFIGURATION
# ===========================================

SECRET_KEY = secrets.token_urlsafe(32)

ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 60


# ===========================================
# HASH PASSWORD
# ===========================================

def hash_password(password: str):

    return pwd_context.hash(password)


# ===========================================
# VERIFY PASSWORD
# ===========================================

def verify_password(

    plain_password: str,

    hashed_password: str

):

    return pwd_context.verify(

        plain_password,

        hashed_password

    )


# ===========================================
# CREATE ACCESS TOKEN
# ===========================================

def create_access_token(data: dict):

    to_encode = data.copy()

    expire = datetime.utcnow() + timedelta(

        minutes=ACCESS_TOKEN_EXPIRE_MINUTES

    )

    to_encode.update({

        "exp": expire

    })

    return jwt.encode(

        to_encode,

        SECRET_KEY,

        algorithm=ALGORITHM

    )


# ===========================================
# VERIFY ACCESS TOKEN
# ===========================================

def verify_access_token(token: str):

    try:

        payload = jwt.decode(

            token,

            SECRET_KEY,

            algorithms=[ALGORITHM]

        )

        return payload

    except JWTError:

        return None
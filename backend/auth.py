# ======================================================
# PriviLens X
# Authentication API
# ======================================================

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException

from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User

from security import (
    hash_password,
    verify_password,
    create_access_token
)


# ======================================================
# ROUTER
# ======================================================

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)


# ======================================================
# REQUEST MODELS
# ======================================================

class SignupRequest(BaseModel):

    name: str

    email: str

    password: str


class LoginRequest(BaseModel):

    email: str

    password: str

# ======================================================
# SIGNUP API
# ======================================================

@router.post("/signup")

def signup(

    user: SignupRequest,

    db: Session = Depends(get_db)

):

    # ===========================================
    # CHECK IF EMAIL ALREADY EXISTS
    # ===========================================

    existing_user = db.query(User).filter(

        User.email == user.email

    ).first()

    if existing_user:

        raise HTTPException(

            status_code=400,

            detail="Email already registered."

        )

    # ===========================================
    # HASH PASSWORD
    # ===========================================

    hashed_password = hash_password(

        user.password

    )

    # ===========================================
    # CREATE NEW USER
    # ===========================================

    new_user = User(

        name=user.name,

        email=user.email,

        password=hashed_password

    )

    # ===========================================
    # SAVE TO DATABASE
    # ===========================================

    db.add(new_user)

    db.commit()

    db.refresh(new_user)

    # ===========================================
    # SUCCESS RESPONSE
    # ===========================================

    return {

        "status": "success",

        "message": "Account created successfully.",

        "user":{

            "id": new_user.id,

            "name": new_user.name,

            "email": new_user.email

        }

    }# ======================================================
# LOGIN API
# ======================================================

@router.post("/login")

def login(

    user: LoginRequest,

    db: Session = Depends(get_db)

):

    # ===========================================
    # FIND USER
    # ===========================================

    db_user = db.query(User).filter(

        User.email == user.email

    ).first()

    if not db_user:

        raise HTTPException(

            status_code=401,

            detail="Invalid email or password."

        )

    # ===========================================
    # VERIFY PASSWORD
    # ===========================================

    if not verify_password(

        user.password,

        db_user.password

    ):

        raise HTTPException(

            status_code=401,

            detail="Invalid email or password."

        )

    # ===========================================
    # UPDATE LAST LOGIN
    # ===========================================

    from datetime import datetime

    db_user.last_login = datetime.utcnow()

    db.commit()

    # ===========================================
    # GENERATE JWT TOKEN
    # ===========================================

    token = create_access_token(

        {

            "user_id": db_user.id,

            "email": db_user.email

        }

    )

    # ===========================================
    # SUCCESS RESPONSE
    # ===========================================

    return {

        "status": "success",

        "message": "Login successful.",

        "access_token": token,

        "token_type": "bearer",

        "user": {

            "id": db_user.id,

            "name": db_user.name,

            "email": db_user.email

        }

    }
# ==========================================================
# HISTORY API
# ==========================================================

from fastapi import APIRouter
from history_manager import history_manager

router = APIRouter()


# ----------------------------------------------------------
# Get Latest Analysis
# ----------------------------------------------------------

@router.get("/dashboard/latest")
def latest():

    data = history_manager.get_latest()

    if data is None:

        return {
            "status": "empty"
        }

    return data


# ----------------------------------------------------------
# Get Full History
# ----------------------------------------------------------

@router.get("/dashboard/history")
def history():

    return history_manager.get_all()
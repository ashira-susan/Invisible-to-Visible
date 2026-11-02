"""App entry point.  Run from the backend/ folder:

    python -m uvicorn itv.main:app --reload

Keep the default host (127.0.0.1). Do not use --host 0.0.0.0: the API has no
login in v1, so it must only be reachable from this computer.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import router
from .config import DASHBOARD_DIR
from .db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Invisible to Visible", version=__version__, lifespan=lifespan)

# Only our own extension (any install of it) may call the API cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Install-ID"],
)

app.include_router(router)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app/")


# Registered last so it never shadows an API route.
if DASHBOARD_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=DASHBOARD_DIR, html=True), name="dashboard")

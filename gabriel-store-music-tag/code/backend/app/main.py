"""FastAPI application entrypoint.

Single-container design: this app serves the JSON API under /api and, when a
built React frontend is present at STATIC_DIR, serves it as an SPA for all
other routes.
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .db import init_db
from .api import scan, tracks

app = FastAPI(title="Music Tag", version="1.0.0")


@app.on_event("startup")
def _startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(scan.router)
app.include_router(tracks.router)
app.include_router(tracks.stats_router)


# --- Static SPA (frontend build) ------------------------------------------
# Mounted last so /api routes take precedence. Only mounts if the build exists,
# which keeps the backend runnable standalone during development.
if config.STATIC_DIR.exists():
    assets = config.STATIC_DIR / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = config.STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(config.STATIC_DIR / "index.html")

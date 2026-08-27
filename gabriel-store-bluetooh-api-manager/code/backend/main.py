"""FastAPI entrypoint: REST API + WebSocket + static React frontend, one process."""
import logging
import os
from contextlib import asynccontextmanager

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .adapters.bluetooth import ble
from .api import routes, ws
from .cleanup import cleanup
from .core.config import settings
from .scheduler import scheduler
from .tts import tts


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start continuous BLE discovery + the play scheduler + TTS worker + cleanup.
    await ble.start()
    scheduler.start()
    tts.start()
    cleanup.start()
    try:
        yield
    finally:
        await scheduler.stop()
        await ble.stop()


app = FastAPI(
    title="Bluetooth API Manager",
    description="Discover Bluetooth devices, watch their data, and control them over an API.",
    version="1.6.0",
    lifespan=lifespan,
)

# Open on the local network; the app has no auth by design (trusted LAN).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes.router)
app.include_router(ws.router)


class SPAStaticFiles(StaticFiles):
    """Falls back to index.html for unknown paths, so client-side routes
    (e.g. /player) work on a hard refresh or a directly-typed/bookmarked
    URL, not just when reached via in-app navigation."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


# Serve the built React frontend at the root, if present. Registered last so it
# never shadows /api or /ws.
if settings.STATIC_DIR and os.path.isdir(settings.STATIC_DIR):
    app.mount("/", SPAStaticFiles(directory=settings.STATIC_DIR, html=True), name="frontend")
else:
    @app.get("/")
    async def no_frontend() -> JSONResponse:
        return JSONResponse(
            {
                "message": "Bluetooth API Manager backend is running.",
                "frontend": "not built — see /docs for the API",
                "docs": "/docs",
            }
        )

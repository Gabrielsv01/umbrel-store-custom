"""FastAPI entrypoint: REST API + WebSocket + static React frontend, one process."""
import logging
import os
from contextlib import asynccontextmanager

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .adapters.bluetooth import ble
from .api import routes, ws
from .core.config import settings
from .scheduler import scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start continuous BLE discovery + the play scheduler as the server comes up.
    await ble.start()
    scheduler.start()
    try:
        yield
    finally:
        await scheduler.stop()
        await ble.stop()


app = FastAPI(
    title="Bluetooth API Manager",
    description="Discover Bluetooth devices, watch their data, and control them over an API.",
    version="1.3.3",
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

# Serve the built React frontend at the root, if present. Registered last so it
# never shadows /api or /ws.
if settings.STATIC_DIR and os.path.isdir(settings.STATIC_DIR):
    app.mount("/", StaticFiles(directory=settings.STATIC_DIR, html=True), name="frontend")
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

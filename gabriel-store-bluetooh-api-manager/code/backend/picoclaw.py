"""Thin WebSocket client for a separately-running PicoClaw agent gateway
(github.com/sipeed/picoclaw), speaking its native "Pico Protocol" chat
channel. Proxied through our own backend (see api/ws.py's /ws/agent route)
so PICOCLAW_TOKEN never reaches the browser and so container-to-container
networking is handled server-side.
"""
from __future__ import annotations

import websockets

from .core.config import settings


def configured() -> bool:
    return bool(settings.PICOCLAW_URL and settings.PICOCLAW_TOKEN)


def _ws_url(session_id: str) -> str:
    base = settings.PICOCLAW_URL
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    return f"{base}/pico/ws?session_id={session_id}"


async def connect(session_id: str):
    if not configured():
        raise ValueError("PicoClaw não está configurado (defina PICOCLAW_URL e PICOCLAW_TOKEN)")
    headers = {"Authorization": f"Bearer {settings.PICOCLAW_TOKEN}"}
    return await websockets.connect(_ws_url(session_id), additional_headers=headers, open_timeout=10)

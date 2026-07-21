"""REST API — this is the interface other systems call.

Everything here is a thin wrapper over the BLE manager, so the behaviour is
identical whether a request comes from the web UI or an external caller.
Interactive docs are served by FastAPI at /docs.
"""
from __future__ import annotations

import os
import uuid as uuidlib
from typing import Optional

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..adapters.audio import audio
from ..adapters.bluetooth import ble
from ..adapters.classic import classic
from ..adapters.files import files
from ..core.config import settings
from ..core.events import bus

router = APIRouter(prefix="/api", tags=["bluetooth"])


async def _save_upload(subdir: str, upload: UploadFile) -> str:
    dest_dir = os.path.join(settings.DATA_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    safe = os.path.basename(upload.filename or "upload.bin")
    path = os.path.join(dest_dir, f"{uuidlib.uuid4().hex[:8]}_{safe}")
    async with aiofiles.open(path, "wb") as fh:
        while chunk := await upload.read(1 << 16):
            await fh.write(chunk)
    return path


class WriteBody(BaseModel):
    char_uuid: str
    # Provide exactly one of `hex` or `text`.
    hex: Optional[str] = None
    text: Optional[str] = None
    response: bool = True


class NotifyBody(BaseModel):
    char_uuid: str
    enable: bool = True


class CharBody(BaseModel):
    char_uuid: str


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/adapter")
async def adapter_status() -> dict:
    devices = ble.list_devices()
    return {
        "scanning": ble._scanning,
        "devices_seen": len(devices),
        "connected": sum(1 for d in devices if d["connected"]),
        "adapter": await ble.adapter_info(),
    }


@router.get("/stats")
async def stats() -> dict:
    """One-stop observability snapshot for the UI status bar / monitoring."""
    devices = ble.list_devices()
    return {
        "adapter": await ble.adapter_info(),
        "scanning": ble._scanning,
        "devices_seen": len(devices),
        "connected": sum(1 for d in devices if d["connected"]),
        "audio": audio.status(),
        "events": bus.stats(),
    }


@router.get("/devices")
async def list_devices() -> list[dict]:
    return ble.list_devices()


@router.post("/devices/{address}/connect")
async def connect(address: str) -> dict:
    try:
        return await ble.connect(address)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/devices/{address}/disconnect")
async def disconnect(address: str) -> dict:
    return await ble.disconnect(address)


@router.get("/devices/{address}/services")
async def services(address: str) -> list[dict]:
    try:
        return ble.get_services(address)
    except KeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/devices/{address}/read")
async def read_char(address: str, body: CharBody) -> dict:
    try:
        return await ble.read_char(address, body.char_uuid)
    except KeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/devices/{address}/write")
async def write_char(address: str, body: WriteBody) -> dict:
    if (body.hex is None) == (body.text is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of 'hex' or 'text'")
    try:
        data = bytes.fromhex(body.hex) if body.hex is not None else body.text.encode()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex payload")
    try:
        await ble.write_char(address, body.char_uuid, data, response=body.response)
        return {"ok": True, "bytes": len(data)}
    except KeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/devices/{address}/notify")
async def notify(address: str, body: NotifyBody) -> dict:
    try:
        if body.enable:
            await ble.start_notify(address, body.char_uuid)
        else:
            await ble.stop_notify(address, body.char_uuid)
        return {"ok": True, "notifying": body.enable}
    except KeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/events")
async def recent_events() -> list[dict]:
    """Recent events (same stream the WebSocket pushes) for polling clients."""
    return bus.history()


# ---- Bluetooth Classic (speakers/headsets: pair & connect) --------------
@router.get("/classic/devices")
async def classic_devices() -> list[dict]:
    return await classic.devices()


@router.post("/classic/scan")
async def classic_scan(seconds: int = 15) -> list[dict]:
    return await classic.scan(seconds=min(max(seconds, 3), 60))


@router.post("/classic/{address}/pair")
async def classic_pair(address: str) -> dict:
    return await classic.pair(address)


@router.post("/classic/{address}/trust")
async def classic_trust(address: str) -> dict:
    return await classic.trust(address)


@router.post("/classic/{address}/connect")
async def classic_connect(address: str) -> dict:
    return await classic.connect(address)


@router.post("/classic/{address}/pair-connect")
async def classic_pair_connect(address: str) -> dict:
    """Scan (holding discovery on), pair, trust and connect in one reliable step."""
    return await classic.pair_connect(address)


@router.post("/classic/{address}/disconnect")
async def classic_disconnect(address: str) -> dict:
    return await classic.disconnect(address)


# ---- Phase 2: audio streaming (A2DP) ------------------------------------
@router.get("/audio/status")
async def audio_status() -> dict:
    return audio.status()


@router.get("/audio/queue")
async def audio_queue() -> dict:
    return audio.status()


@router.post("/audio/play")
async def audio_play(
    device: str = Form(...),
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
) -> dict:
    """Add a track (uploaded file or URL) to the queue and start playing.

    `device` is the speaker's Bluetooth address (AA:BB:CC:DD:EE:FF); it must be
    paired. Calling this repeatedly queues tracks — they play in order without
    waiting. Streamed via bluez-alsa (A2DP).
    """
    if (file is None) == (url is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of 'file' or 'url'")
    source = url if url is not None else await _save_upload("audio", file)
    try:
        return audio.enqueue(source, device=device)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/audio/skip")
async def audio_skip() -> dict:
    return await audio.skip()


@router.post("/audio/stop")
async def audio_stop() -> dict:
    return await audio.stop()


# ---- Phase 3: file transfer (OBEX Object Push) --------------------------
@router.post("/files/send")
async def files_send(
    address: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    path = await _save_upload("uploads", file)
    try:
        return await files.send_file(address, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))

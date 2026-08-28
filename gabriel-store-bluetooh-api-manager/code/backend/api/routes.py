"""REST API — this is the interface other systems call.

Everything here is a thin wrapper over the BLE manager, so the behaviour is
identical whether a request comes from the web UI or an external caller.
Interactive docs are served by FastAPI at /docs.
"""
from __future__ import annotations

import json
import os
import uuid as uuidlib
from typing import Optional

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..adapters.audio import audio
from ..adapters.bluetooth import ble
from ..adapters.classic import classic
from ..adapters.files import files
from ..core.config import settings
from ..core.events import bus
from ..cleanup import cleanup
from ..scheduler import scheduler
from ..tts import tts
from ..navidrome import DEFAULT_URL, navidrome
from ..music_tag import music_tag

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


class NameBody(BaseModel):
    name: str


class QueueMoveBody(BaseModel):
    direction: int


class NavidromeConfig(BaseModel):
    url: str
    username: str
    password: str


class NavidromeAddBody(BaseModel):
    device: str
    tracks: list[dict]


class NavidromePlayNowBody(BaseModel):
    device: str
    track: dict


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


@router.post("/adapter/name")
async def rename_adapter(body: NameBody) -> dict:
    """Rename the local Bluetooth adapter (the name other devices see)."""
    try:
        return await classic.set_adapter_name(body.name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


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


@router.get("/devices/{address}/values")
async def device_values(address: str) -> dict:
    """Snapshot of the latest read/notified value per characteristic.

    Lets an external system poll one GET for the current state instead of
    holding a WebSocket. Each entry: {hex, text, length, ts}.
    """
    return ble.get_values(address)


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


# ---- Storage / cleanup ---------------------------------------------------
@router.get("/storage")
async def storage_usage() -> dict:
    return cleanup.usage()


@router.post("/cleanup")
async def storage_cleanup() -> dict:
    """Delete old generated/uploaded audio not referenced by a schedule or queue."""
    return cleanup.sweep()


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


@router.post("/classic/{address}/rename")
async def classic_rename(address: str, body: NameBody) -> dict:
    """Give a device a friendly name (persistent BlueZ alias)."""
    try:
        return await classic.set_device_alias(address, body.name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/classic/{address}/disconnect")
async def classic_disconnect(address: str) -> dict:
    return await classic.disconnect(address)


@router.post("/classic/{address}/forget")
async def classic_forget(address: str) -> dict:
    """Remove a device's bond/link key. Use to recover from a stale pairing that
    fails authentication; then re-pair with the speaker in pairing mode."""
    return await classic.remove(address)


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


@router.post("/audio/play-now")
async def audio_play_now(
    device: str = Form(...),
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
) -> dict:
    """Like /audio/play, but jumps the queue and preempts whatever is
    currently playing so this track starts immediately."""
    if (file is None) == (url is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of 'file' or 'url'")
    source = url if url is not None else await _save_upload("audio", file)
    try:
        return await audio.play_now(source, device=device)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/audio/skip")
async def audio_skip() -> dict:
    return await audio.skip()


@router.post("/audio/pause")
async def audio_pause() -> dict:
    return await audio.pause()


@router.post("/audio/resume")
async def audio_resume() -> dict:
    return await audio.resume()


@router.post("/audio/previous")
async def audio_previous() -> dict:
    return await audio.previous()


@router.post("/audio/seek")
async def audio_seek(position: float = Form(...)) -> dict:
    return await audio.seek(position)


@router.post("/audio/repeat")
async def audio_repeat(mode: str = Form(...)) -> dict:
    try:
        return audio.set_repeat(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/audio/shuffle")
async def audio_shuffle(enabled: bool = Form(...)) -> dict:
    return audio.set_shuffle(enabled)


@router.delete("/audio/queue/{item_id}")
async def audio_remove(item_id: int) -> dict:
    try:
        return audio.remove(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/audio/queue/{item_id}/move")
async def audio_move(item_id: int, body: QueueMoveBody) -> dict:
    if body.direction not in (-1, 1):
        raise HTTPException(status_code=400, detail="direction must be -1 or 1")
    try:
        return audio.move(item_id, body.direction)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ---- Music Tag (proxied — its API has no CORS for cross-origin fetches) --
class MusicTagPatchBody(BaseModel):
    """Mirrors Music Tag's own TrackPatch: unset fields are left unchanged."""
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    albumartist: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    track_no: Optional[str] = None
    disc_no: Optional[str] = None


@router.get("/music-tag/status")
async def music_tag_status() -> dict:
    return {"configured": bool(settings.MUSIC_TAG_URL), "url": settings.MUSIC_TAG_URL}


@router.get("/agent/status")
async def agent_status() -> dict:
    return {"configured": bool(settings.PICOCLAW_URL and settings.PICOCLAW_TOKEN)}


@router.get("/music-tag/search")
async def music_tag_search(q: str = "") -> list[dict]:
    try:
        return await music_tag.search(q)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/music-tag/tracks/{track_id}")
async def music_tag_get_track(track_id: int) -> dict:
    try:
        return await music_tag.get_track(track_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/music-tag/tracks/{track_id}")
async def music_tag_update_track(track_id: int, body: MusicTagPatchBody) -> dict:
    changes = body.model_dump(exclude_unset=True)
    try:
        return await music_tag.update_track(track_id, changes)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


# ---- Navidrome ----------------------------------------------------------
@router.get("/navidrome/status")
async def navidrome_status() -> dict:
    return {"configured": navidrome.configured, "url": navidrome.base_url or DEFAULT_URL}


@router.post("/navidrome/configure")
async def navidrome_configure(body: NavidromeConfig) -> dict:
    try:
        return await navidrome.configure(body.url, body.username, body.password)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/navidrome/disconnect")
async def navidrome_disconnect() -> dict:
    navidrome.clear()
    return {"ok": True}


@router.get("/navidrome/search")
async def navidrome_search(q: str = "") -> list[dict]:
    try:
        return await navidrome.search(q)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/navidrome/playlists")
async def navidrome_playlists() -> list[dict]:
    try:
        return await navidrome.playlists()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/navidrome/playlists/{playlist_id}")
async def navidrome_playlist(playlist_id: str) -> dict:
    try:
        return await navidrome.playlist(playlist_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/navidrome/queue")
async def navidrome_queue(body: NavidromeAddBody) -> dict:
    try:
        return await navidrome.add_tracks(body.tracks, body.device)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/navidrome/play-now")
async def navidrome_play_now(body: NavidromePlayNowBody) -> dict:
    try:
        return await navidrome.play_now(body.track, body.device)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


# ---- Scheduler (play at a given time/day) -------------------------------
@router.get("/schedules")
async def list_schedules() -> dict:
    return scheduler.list()


@router.post("/schedules")
async def create_schedule(
    device: str = Form(...),
    time: str = Form(..., description="HH:MM (24h), server timezone"),
    repeat: str = Form("once", description="once | daily | weekly"),
    days: str = Form("", description="weekdays for 'weekly', CSV 0=Mon..6=Sun"),
    date: Optional[str] = Form(None, description="YYYY-MM-DD, required for 'once'"),
    title: Optional[str] = Form(None, description="optional friendly name"),
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
) -> dict:
    if (file is None) == (url is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of 'file' or 'url'")
    source = url if url is not None else await _save_upload("audio", file)
    label = source if url is not None else os.path.basename(source)
    try:
        day_list = [int(d) for d in days.split(",") if d.strip() != ""]
    except ValueError:
        raise HTTPException(status_code=400, detail="days must be CSV of 0..6")
    try:
        return scheduler.add(device=device, source=source, label=label, at=time,
                             repeat=repeat, days=day_list, date=date, title=title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---- Text-to-speech (Piper / Kokoro) ------------------------------------
@router.get("/tts/engines")
async def tts_engines() -> list[dict]:
    return tts.engines()


@router.get("/tts/voices")
async def tts_voices(engine: str = "piper") -> list[str]:
    try:
        return await tts.voices(engine=engine)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"{engine} service unreachable: {exc}")


@router.get("/tts")
async def tts_status() -> dict:
    return tts.status()


@router.post("/tts")
async def tts_submit(
    text: str = Form(...),
    voice: str = Form(...),
    device: Optional[str] = Form(None),
    mode: str = Form("play", description="play (alto-falante) | schedule (agendar) | browser (só gerar, sem destino)"),
    engine: str = Form("piper", description="piper | kokoro"),
    length_scale: Optional[float] = Form(None, description="Piper speech rate: 1.0 normal, >1 slower, <1 faster"),
    noise_scale: Optional[float] = Form(None, description="Piper expressiveness / variability"),
    noise_w: Optional[float] = Form(None, description="Piper cadence (timing) variability"),
    sentence_silence: Optional[float] = Form(None, description="Piper pause between sentences (seconds)"),
    speed: Optional[float] = Form(None, description="Kokoro speech rate: 1.0 normal, >1 faster, <1 slower"),
    volume_multiplier: Optional[float] = Form(None, description="Kokoro output volume multiplier, 0-10 (default 1.0)"),
    allow_voice_tags: bool = Form(False, description="Kokoro: [voice:nome] in the text switches speaker"),
    ssml: bool = Form(False, description="Kokoro: interpret the input as SSML (implies allow_voice_tags)"),
    normalization_options: Optional[str] = Form(None, description="Kokoro: JSON object of normalization toggles"),
    time: Optional[str] = Form(None),
    repeat: str = Form("once"),
    days: str = Form(""),
    date: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
) -> dict:
    """Generate speech from text and either play it now (speaker or browser-only) or schedule it."""
    if mode in ("play", "schedule") and not device:
        raise HTTPException(status_code=400, detail="escolha um alto-falante")
    sched = None
    if mode == "schedule":
        if not time:
            raise HTTPException(status_code=400, detail="schedule mode needs a time (HH:MM)")
        try:
            day_list = [int(d) for d in days.split(",") if d.strip() != ""]
        except ValueError:
            raise HTTPException(status_code=400, detail="days must be CSV of 0..6")
        sched = {"time": time, "repeat": repeat, "days": day_list, "date": date, "title": title}
    if engine == "kokoro":
        norm = None
        if normalization_options:
            try:
                norm = json.loads(normalization_options)
            except ValueError:
                raise HTTPException(status_code=400, detail="normalization_options deve ser JSON válido")
        if ssml:
            allow_voice_tags = True  # required by the Kokoro API for the [voice:]/[rate:] spans it emits
        params = {
            "speed": speed, "volume_multiplier": volume_multiplier,
            "allow_voice_tags": allow_voice_tags, "ssml": ssml,
            "normalization_options": norm,
        }
    else:
        params = {"length_scale": length_scale, "noise_scale": noise_scale,
                  "noise_w": noise_w, "sentence_silence": sentence_silence}
    return tts.submit(text=text, voice=voice, device=device, mode=mode, engine=engine,
                      sched=sched, params=params)


@router.get("/tts/jobs/{job_id}/audio")
async def tts_job_audio(job_id: str):
    """Stream a generated job's WAV — used by the browser preview player."""
    job = tts.get_job(job_id)
    if job is None or not job.get("file"):
        raise HTTPException(status_code=404, detail="áudio ainda não foi gerado")
    return FileResponse(job["file"], media_type="audio/wav", filename=f"{job_id}.wav")


@router.post("/tts/jobs/{job_id}/play")
async def tts_job_play(job_id: str, device: str = Form(...)) -> dict:
    """Send an already-generated job (from the "Gerar"/"Tocar no navegador"
    flow) to a Bluetooth speaker, without re-running text-to-speech."""
    try:
        return tts.play_job(job_id, device)
    except KeyError:
        raise HTTPException(status_code=404, detail="job not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/tts/jobs/{job_id}")
async def tts_job_delete(job_id: str) -> dict:
    if not tts.delete_job(job_id):
        raise HTTPException(status_code=404, detail="job not found")
    return {"ok": True}


@router.delete("/schedules/{sid}")
async def delete_schedule(sid: int) -> dict:
    if not scheduler.remove(sid):
        raise HTTPException(status_code=404, detail="schedule not found")
    return {"ok": True}


@router.post("/schedules/{sid}/toggle")
async def toggle_schedule(sid: int, enabled: bool = True) -> dict:
    item = scheduler.toggle(sid, enabled)
    if item is None:
        raise HTTPException(status_code=404, detail="schedule not found")
    return item


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

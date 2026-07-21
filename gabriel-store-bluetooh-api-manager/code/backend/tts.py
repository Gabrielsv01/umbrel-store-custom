"""Text-to-speech generation queue (Piper).

Submits text jobs to the separate `piper` container, saves each result as a WAV
in /data/tts, then hands it off to the EXISTING machinery (DRY):
  - mode "play"     -> audio.enqueue(wav, device)   (play now, through the queue)
  - mode "schedule" -> scheduler.add(source=wav, …) (play at a given time)

A background worker generates one job at a time, so you can submit many texts.
"""
from __future__ import annotations

import asyncio
import os
import uuid as uuidlib
from collections import deque
from typing import Any, Deque, Dict, List, Optional

import aiofiles
import httpx

from .adapters.audio import audio
from .core.config import settings
from .core.events import bus
from .scheduler import scheduler

PIPER_URL = os.getenv("PIPER_URL", "http://127.0.0.1:5158")


class TTSService:
    def __init__(self) -> None:
        self._dir = os.path.join(settings.DATA_DIR, "tts")
        self._pending: Deque[Dict[str, Any]] = deque()
        self._jobs: Deque[Dict[str, Any]] = deque(maxlen=50)  # recent job status
        self._task: Optional[asyncio.Task] = None
        self._wake = asyncio.Event()

    async def voices(self) -> List[str]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{PIPER_URL}/voices")
            resp.raise_for_status()
            return resp.json()

    def status(self) -> Dict[str, Any]:
        return {"jobs": list(self._jobs), "queued": len(self._pending)}

    def submit(self, *, text: str, voice: str, device: str, mode: str,
               sched: Optional[Dict[str, Any]] = None,
               params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        job = {
            "id": uuidlib.uuid4().hex[:8],
            "text": text,
            "preview": (text[:60] + "…") if len(text) > 60 else text,
            "voice": voice,
            "device": device,
            "mode": mode,
            "sched": sched,
            # Piper tuning: length_scale, noise_scale, noise_w, sentence_silence.
            "params": {k: v for k, v in (params or {}).items() if v is not None},
            "status": "queued",
        }
        self._pending.append(job)
        self._jobs.appendleft(job)
        bus.publish("tts_queued", id=job["id"], preview=job["preview"], mode=mode)
        self._ensure_loop()
        self._wake.set()
        return job

    # ---- worker ----------------------------------------------------------
    def _ensure_loop(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            if not self._pending:
                self._wake.clear()
                await self._wake.wait()
                continue
            job = self._pending.popleft()
            await self._generate(job)

    async def _generate(self, job: Dict[str, Any]) -> None:
        job["status"] = "generating"
        bus.publish("tts_generating", id=job["id"])
        try:
            os.makedirs(self._dir, exist_ok=True)
            path = os.path.join(self._dir, f"{job['id']}.wav")
            payload = {"text": job["text"], "voice": job["voice"], **job.get("params", {})}
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(f"{PIPER_URL}/synthesize", json=payload)
                resp.raise_for_status()
                async with aiofiles.open(path, "wb") as fh:
                    await fh.write(resp.content)

            job["file"] = path
            if job["mode"] == "schedule" and job.get("sched"):
                s = job["sched"]
                scheduler.add(
                    device=job["device"], source=path,
                    label=s.get("title") or job["preview"],
                    at=s["time"], repeat=s.get("repeat", "once"),
                    days=s.get("days", []), date=s.get("date"),
                    title=s.get("title") or job["preview"],
                )
                job["status"] = "scheduled"
            else:
                audio.enqueue(path, job["device"])
                job["status"] = "queued-to-play"
            bus.publish("tts_done", id=job["id"], mode=job["mode"], file=path)
        except Exception as exc:  # noqa: BLE001
            job["status"] = "error"
            job["error"] = str(exc)[:200]
            bus.publish("error", where="tts", id=job["id"], message=str(exc)[:300])

    def start(self) -> None:
        self._ensure_loop()


tts = TTSService()

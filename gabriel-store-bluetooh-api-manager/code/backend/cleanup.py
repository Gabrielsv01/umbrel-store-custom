"""Periodic cleanup of generated/uploaded audio so /data doesn't grow forever.

Deletes files in the audio dirs that are older than the retention window AND not
referenced by anything still needed — i.e. not a schedule's source (a scheduled
or recurring track must survive) and not currently queued/playing.
"""
from __future__ import annotations

import asyncio
import glob
import os
import time
from typing import Any, Dict

from .adapters.audio import audio
from .core.config import settings
from .core.events import bus
from .scheduler import scheduler

RETENTION_DAYS = float(os.getenv("AUDIO_RETENTION_DAYS", "7"))
SWEEP_INTERVAL = 3600  # hourly


class CleanupService:
    def __init__(self) -> None:
        self._dirs = [os.path.join(settings.DATA_DIR, d) for d in ("tts", "audio", "uploads")]
        self._retention = RETENTION_DAYS * 86400
        self._task = None

    def _keep(self) -> set[str]:
        keep: set[str] = set()
        for item in scheduler._items:  # schedules reference their audio by path
            if item.get("source"):
                keep.add(item["source"])
        st = audio.status()
        if st.get("current"):
            keep.add(st["current"]["source"])
        for q in st.get("queue", []):
            keep.add(q["source"])
        return keep

    def _files(self):
        for d in self._dirs:
            for f in glob.glob(os.path.join(d, "*")):
                if os.path.isfile(f):
                    yield f

    def usage(self) -> Dict[str, Any]:
        files = list(self._files())
        return {
            "files": len(files),
            "bytes": sum(os.path.getsize(f) for f in files),
            "retention_days": RETENTION_DAYS,
        }

    def sweep(self) -> Dict[str, Any]:
        keep = self._keep()
        cutoff = time.time() - self._retention
        removed, freed = 0, 0
        for f in self._files():
            if f in keep:
                continue
            try:
                if os.path.getmtime(f) < cutoff:
                    size = os.path.getsize(f)
                    os.remove(f)
                    removed += 1
                    freed += size
            except OSError:
                pass
        if removed:
            bus.publish("cleanup", removed=removed, freed=freed)
        return {"removed": removed, "freed": freed}

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_INTERVAL)
            try:
                self.sweep()
            except Exception as exc:  # noqa: BLE001
                bus.publish("error", where="cleanup", message=str(exc))

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())


cleanup = CleanupService()

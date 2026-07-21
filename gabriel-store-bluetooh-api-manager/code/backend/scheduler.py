"""Cron-like scheduler: play a track at a given time/day.

Reuses the audio queue — when a schedule fires, the track is simply enqueued and
plays through the normal player. Schedules persist to /data (survive restarts).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from .adapters.audio import audio
from .core.config import settings
from .core.events import bus

REPEATS = {"once", "daily", "weekly"}


class Scheduler:
    def __init__(self) -> None:
        self._path = os.path.join(settings.DATA_DIR, "schedules.json")
        self._items: List[Dict[str, Any]] = []
        self._counter = 0
        self._task: Optional[asyncio.Task] = None
        self._load()

    # ---- persistence -----------------------------------------------------
    def _load(self) -> None:
        try:
            with open(self._path) as fh:
                data = json.load(fh)
            self._items = data.get("items", [])
            self._counter = data.get("counter", 0)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            self._items = []
            self._counter = 0

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        tmp = self._path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump({"items": self._items, "counter": self._counter}, fh, indent=2)
        os.replace(tmp, self._path)

    # ---- API -------------------------------------------------------------
    def list(self) -> Dict[str, Any]:
        now = datetime.now()
        return {
            "now": now.strftime("%Y-%m-%d %H:%M:%S"),
            "weekday": now.weekday(),  # 0 = Monday
            "tz": (time.tzname[0] if time.tzname else "UTC"),
            "items": self._items,
        }

    def add(self, *, device: str, source: str, label: str, at: str,
            repeat: str, days: List[int], date: Optional[str],
            title: Optional[str] = None) -> Dict[str, Any]:
        if repeat not in REPEATS:
            raise ValueError(f"repeat must be one of {sorted(REPEATS)}")
        try:
            datetime.strptime(at, "%H:%M")
        except ValueError:
            raise ValueError("time must be HH:MM (24h)")
        if repeat == "once":
            if not date:
                raise ValueError("'once' requires a date (YYYY-MM-DD)")
            datetime.strptime(date, "%Y-%m-%d")
        if repeat == "weekly" and not days:
            raise ValueError("'weekly' requires at least one weekday (0=Mon..6=Sun)")

        self._counter += 1
        item = {
            "id": self._counter,
            "title": (title or "").strip(),
            "device": device,
            "source": source,
            "label": label,
            "time": at,
            "repeat": repeat,
            "days": sorted(set(days)),
            "date": date,
            "enabled": True,
            "last_fired": None,
        }
        self._items.append(item)
        self._save()
        bus.publish("schedule_added", id=item["id"], at=at, repeat=repeat)
        return item

    def remove(self, sid: int) -> bool:
        before = len(self._items)
        self._items = [i for i in self._items if i["id"] != sid]
        if len(self._items) != before:
            self._save()
            return True
        return False

    def toggle(self, sid: int, enabled: bool) -> Optional[Dict[str, Any]]:
        for item in self._items:
            if item["id"] == sid:
                item["enabled"] = enabled
                self._save()
                return item
        return None

    # ---- loop ------------------------------------------------------------
    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        while True:
            try:
                self._tick()
            except Exception as exc:  # noqa: BLE001
                bus.publish("error", where="scheduler", message=str(exc))
            await asyncio.sleep(20)

    def _tick(self) -> None:
        now = datetime.now()
        minute = now.strftime("%Y-%m-%d %H:%M")
        hhmm = now.strftime("%H:%M")
        today = now.strftime("%Y-%m-%d")
        weekday = now.weekday()
        changed = False

        for item in self._items:
            if not item["enabled"] or item.get("last_fired") == minute:
                continue
            if item["time"] != hhmm:
                continue
            rep = item["repeat"]
            match = (
                rep == "daily"
                or (rep == "weekly" and weekday in item["days"])
                or (rep == "once" and item["date"] == today)
            )
            if not match:
                continue
            audio.enqueue(item["source"], item["device"])
            item["last_fired"] = minute
            bus.publish("schedule_fired", id=item["id"],
                        device=item["device"], label=item["label"])
            if rep == "once":
                item["enabled"] = False
            changed = True

        if changed:
            self._save()


scheduler = Scheduler()

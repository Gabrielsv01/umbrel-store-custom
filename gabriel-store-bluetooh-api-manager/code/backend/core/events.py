"""In-memory async event bus.

Every meaningful thing that happens in the manager (a device is discovered,
GATT data arrives, a connection changes, an error is raised) is published here
as a single event. The WebSocket hub and the "Logs" tab both consume from this
one source, so we never duplicate the event-fan-out logic.

Each event also carries a severity `level` (info/warn/error) and is mirrored to
the standard Python logger, so `docker logs` and the UI show the same picture.
"""
import asyncio
import logging
import time
from collections import Counter, deque
from typing import Any, AsyncIterator, Deque, Dict, Optional

from .config import settings

logger = logging.getLogger("btmgr.events")
_LOG_LEVELS = {"info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}


class EventBus:
    def __init__(self, history: int = 500) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._history: Deque[Dict[str, Any]] = deque(maxlen=history)
        self._seq = 0
        self._started = time.time()
        self._by_type: Counter = Counter()
        self._by_level: Counter = Counter()

    @staticmethod
    def _infer_level(type_: str) -> str:
        return "error" if type_ == "error" else "info"

    def _make_event(self, type_: str, level: str, data: Dict[str, Any]) -> Dict[str, Any]:
        self._seq += 1
        return {
            "seq": self._seq,
            "ts": time.time(),
            "type": type_,
            "level": level,
            "data": data,
        }

    def publish(self, type_: str, level: Optional[str] = None, **data: Any) -> Dict[str, Any]:
        """Publish an event to all current subscribers. Non-blocking."""
        level = level or self._infer_level(type_)
        event = self._make_event(type_, level, data)
        self._history.append(event)
        self._by_type[type_] += 1
        self._by_level[level] += 1
        logger.log(_LOG_LEVELS.get(level, logging.INFO), "%s %s", type_, data)
        for queue in list(self._subscribers):
            # Drop for slow consumers rather than blocking the producer.
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass
        return event

    def history(self) -> list[Dict[str, Any]]:
        return list(self._history)

    def stats(self) -> Dict[str, Any]:
        return {
            "uptime_seconds": round(time.time() - self._started, 1),
            "total_events": self._seq,
            "events_by_type": dict(self._by_type),
            "events_by_level": dict(self._by_level),
        }

    async def subscribe(self) -> AsyncIterator[Dict[str, Any]]:
        """Yield events as they arrive. Replays recent history first."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        for event in self._history:
            queue.put_nowait(event)
        self._subscribers.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._subscribers.discard(queue)


# Single shared instance used across the app.
bus = EventBus(history=settings.EVENT_HISTORY)

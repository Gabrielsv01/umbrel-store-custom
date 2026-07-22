"""Library scanner: walks the music volume and upserts the catalog.

Incremental: a file is only re-read when its size or mtime changed since the
last scan. Runs in a background thread; progress is exposed via `scan_status`.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

from sqlmodel import select

from .. import config
from ..db import get_session
from ..models import Track
from . import tagger

# Shared, mutable scan status. A single scan runs at a time (guarded by _lock).
scan_status: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "scanned": 0,
    "added": 0,
    "updated": 0,
    "removed": 0,
    "errors": 0,
    "total": 0,
    "current": None,
}
_lock = threading.Lock()


def _iter_audio_files(roots: list[Path]):
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in config.AUDIO_EXTENSIONS:
                yield p


def is_scanning() -> bool:
    return scan_status["running"]


def run_scan() -> None:
    """Entry point for the background task. No-ops if already running."""
    if not _lock.acquire(blocking=False):
        return
    try:
        _do_scan()
    finally:
        _lock.release()


def _do_scan() -> None:
    scan_status.update(
        running=True, started_at=time.time(), finished_at=None,
        scanned=0, added=0, updated=0, removed=0, errors=0, total=0, current=None,
    )
    seen_paths: set[str] = set()

    with get_session() as session:
        existing = {t.path: t for t in session.exec(select(Track)).all()}

        files = list(_iter_audio_files(config.MUSIC_DIRS))
        scan_status["total"] = len(files)

        for path in files:
            spath = str(path)
            seen_paths.add(spath)
            scan_status["current"] = spath
            scan_status["scanned"] += 1
            try:
                st = path.stat()
                track = existing.get(spath)
                # Skip unchanged files (incremental).
                if track and track.size == st.st_size and track.mtime == st.st_mtime:
                    continue

                tags = tagger.read_tags(path)
                now = time.time()
                if track is None:
                    track = Track(path=spath, added_at=now)
                    scan_status["added"] += 1
                else:
                    scan_status["updated"] += 1
                    if track.added_at is None:  # backfill pre-existing rows
                        track.added_at = now

                track.filename = path.name
                track.size = st.st_size
                track.mtime = st.st_mtime
                track.format = tags["format"]
                track.duration = tags["duration"]
                track.bitrate = tags["bitrate"]
                track.title = tags["title"]
                track.artist = tags["artist"]
                track.album = tags["album"]
                track.albumartist = tags["albumartist"]
                track.year = tags["year"]
                track.genre = tags["genre"]
                track.track_no = tags["track_no"]
                track.disc_no = tags["disc_no"]
                track.has_artwork = tags["has_artwork"]
                track.last_scanned = time.time()
                session.add(track)
            except Exception:
                scan_status["errors"] += 1

        # Remove catalog entries whose files disappeared.
        for spath, track in existing.items():
            if spath not in seen_paths:
                session.delete(track)
                scan_status["removed"] += 1

        session.commit()

    scan_status.update(running=False, finished_at=time.time(), current=None)

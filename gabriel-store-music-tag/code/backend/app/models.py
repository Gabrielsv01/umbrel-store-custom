"""Database models."""
from typing import Optional

from sqlmodel import SQLModel, Field


class Track(SQLModel, table=True):
    """One indexed audio file and its current tag values."""

    id: Optional[int] = Field(default=None, primary_key=True)

    # Filesystem identity + change-detection fingerprint.
    path: str = Field(index=True, unique=True)
    filename: str
    format: str = ""            # e.g. "MP3", "FLAC"
    size: int = 0              # bytes
    mtime: float = 0.0         # filesystem modification time

    # Technical info (read-only, from the audio stream).
    duration: Optional[float] = None   # seconds
    bitrate: Optional[int] = None      # bits/s

    # Editable tags.
    title: Optional[str] = Field(default=None, index=True)
    artist: Optional[str] = Field(default=None, index=True)
    album: Optional[str] = Field(default=None, index=True)
    albumartist: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    track_no: Optional[str] = None
    disc_no: Optional[str] = None

    has_artwork: bool = False
    last_scanned: Optional[float] = None
    # Epoch seconds when this track was first seen by a scan (i.e. added to the
    # library). Stable across tag edits, unlike the filesystem mtime.
    added_at: Optional[float] = Field(default=None, index=True)

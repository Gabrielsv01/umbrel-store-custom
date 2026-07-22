"""API request/response schemas."""
from typing import Optional
from pydantic import BaseModel


class TrackOut(BaseModel):
    id: int
    path: str
    filename: str
    format: str
    size: int
    duration: Optional[float] = None
    bitrate: Optional[int] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    albumartist: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    track_no: Optional[str] = None
    disc_no: Optional[str] = None
    has_artwork: bool = False
    added_at: Optional[float] = None


class TrackList(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[TrackOut]


class TrackPatch(BaseModel):
    """Editable fields. Unset fields are left unchanged; null clears the tag."""
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    albumartist: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    track_no: Optional[str] = None
    disc_no: Optional[str] = None


class BulkPatch(BaseModel):
    ids: list[int]
    changes: TrackPatch


class ScanStatus(BaseModel):
    running: bool
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    scanned: int = 0
    added: int = 0
    updated: int = 0
    removed: int = 0
    errors: int = 0
    total: int = 0
    current: Optional[str] = None


class Facet(BaseModel):
    """A distinct tag value and how many tracks carry it."""
    value: str
    count: int


class Stats(BaseModel):
    tracks: int
    artists: int
    albums: int
    with_artwork: int
    music_dirs: list[str]

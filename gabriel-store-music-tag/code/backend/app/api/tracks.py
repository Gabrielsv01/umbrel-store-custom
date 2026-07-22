"""Track catalog + tag editing endpoints."""
import re
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, File
from sqlmodel import select, func, or_, col

from .. import config
from ..db import get_session
from ..models import Track
from ..schemas import TrackOut, TrackList, TrackPatch, BulkPatch, Stats, Facet
from ..services import tagger

router = APIRouter(prefix="/api/tracks", tags=["tracks"])

ALLOWED_ARTWORK_MIME = {"image/jpeg": "image/jpeg", "image/png": "image/png"}

_RELATIVE_RE = re.compile(r"(\d+)([dhm])")


def _parse_bound(value: str, is_end: bool) -> tuple[float, bool]:
    """Parse a date bound into (epoch_seconds, exclusive_upper).

    Accepts:
      * relative windows: "1d" (1 day ago), "24h", "30m"
      * a date: "2026-07-21" (as an upper bound it means the whole day)
      * a full ISO datetime: "2026-07-21T14:30:00"
    """
    value = value.strip()
    m = _RELATIVE_RE.fullmatch(value)
    if m:
        n = int(m.group(1))
        delta = {"d": timedelta(days=n), "h": timedelta(hours=n), "m": timedelta(minutes=n)}[m.group(2)]
        return (datetime.now(timezone.utc) - delta).timestamp(), False
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid date '{value}'. Use YYYY-MM-DD, an ISO datetime, or a relative window like '1d'.",
        )
    # A date-only upper bound covers the entire day (exclusive of next midnight).
    if is_end and len(value) == 10:
        return (dt + timedelta(days=1)).timestamp(), True
    return dt.timestamp(), False


def _backup(path: Path) -> None:
    """Keep a one-time backup copy before the first write, if enabled."""
    if not config.BACKUP_ON_WRITE:
        return
    backup_dir = config.DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    dest = backup_dir / path.name
    if not dest.exists():
        shutil.copy2(path, dest)


def _apply_changes(track: Track, changes: dict) -> None:
    """Write `changes` to the file, then mirror them into the DB row."""
    path = Path(track.path)
    if not path.exists():
        raise HTTPException(status_code=410, detail=f"File no longer exists: {track.path}")
    _backup(path)
    try:
        tagger.write_tags(path, changes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to write tags: {exc}")

    for field, value in changes.items():
        setattr(track, field, value if value != "" else None)
    st = path.stat()
    track.size = st.st_size
    track.mtime = st.st_mtime
    track.last_scanned = time.time()


@router.get("", response_model=TrackList)
def list_tracks(
    search: str | None = None,
    artist: str | None = None,
    album: str | None = None,
    genre: str | None = None,
    has_artwork: bool | None = None,
    added_from: str | None = Query(
        None, description="Only tracks added at/after this date. YYYY-MM-DD, ISO datetime, or relative like '1d'."
    ),
    added_to: str | None = Query(
        None, description="Only tracks added at/before this date (a plain date covers the whole day)."
    ),
    sort: str = Query("artist", pattern="^(artist|album|title|filename|year|genre|added_at)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    with get_session() as session:
        stmt = select(Track)
        count_stmt = select(func.count()).select_from(Track)

        conds = []
        if search:
            like = f"%{search}%"
            conds.append(or_(
                col(Track.title).ilike(like),
                col(Track.artist).ilike(like),
                col(Track.album).ilike(like),
                col(Track.filename).ilike(like),
            ))
        if artist:
            conds.append(col(Track.artist) == artist)
        if album:
            conds.append(col(Track.album) == album)
        if genre:
            conds.append(col(Track.genre) == genre)
        if has_artwork is not None:
            conds.append(col(Track.has_artwork) == has_artwork)
        if added_from:
            ts, _ = _parse_bound(added_from, is_end=False)
            conds.append(col(Track.added_at) >= ts)
        if added_to:
            ts, exclusive = _parse_bound(added_to, is_end=True)
            conds.append(col(Track.added_at) < ts if exclusive else col(Track.added_at) <= ts)
        for c in conds:
            stmt = stmt.where(c)
            count_stmt = count_stmt.where(c)

        total = session.exec(count_stmt).one()
        sort_col = getattr(Track, sort)
        stmt = stmt.order_by(sort_col.desc() if order == "desc" else sort_col.asc())
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        items = session.exec(stmt).all()

    return TrackList(
        total=total, page=page, page_size=page_size,
        items=[TrackOut.model_validate(t, from_attributes=True) for t in items],
    )


@router.get("/{track_id}", response_model=TrackOut)
def get_track(track_id: int):
    with get_session() as session:
        track = session.get(Track, track_id)
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
        return TrackOut.model_validate(track, from_attributes=True)


@router.patch("/{track_id}", response_model=TrackOut)
def update_track(track_id: int, patch: TrackPatch):
    changes = patch.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")
    with get_session() as session:
        track = session.get(Track, track_id)
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
        _apply_changes(track, changes)
        session.add(track)
        session.commit()
        session.refresh(track)
        return TrackOut.model_validate(track, from_attributes=True)


@router.post("/bulk", response_model=list[TrackOut])
def bulk_update(payload: BulkPatch):
    changes = payload.changes.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated: list[TrackOut] = []
    with get_session() as session:
        for track_id in payload.ids:
            track = session.get(Track, track_id)
            if not track:
                continue
            _apply_changes(track, changes)
            session.add(track)
            updated.append(track)
        session.commit()
        return [TrackOut.model_validate(t, from_attributes=True) for t in updated]


@router.get("/{track_id}/artwork")
def get_artwork(track_id: int):
    with get_session() as session:
        track = session.get(Track, track_id)
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
    result = tagger.read_artwork(Path(track.path))
    if result is None:
        raise HTTPException(status_code=404, detail="No artwork")
    data, mime = result
    return Response(content=data, media_type=mime)


@router.put("/{track_id}/artwork", response_model=TrackOut)
async def put_artwork(track_id: int, file: UploadFile = File(...)):
    mime = ALLOWED_ARTWORK_MIME.get(file.content_type or "")
    if mime is None:
        raise HTTPException(status_code=415, detail="Artwork must be JPEG or PNG")
    with get_session() as session:
        track = session.get(Track, track_id)
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
        path = Path(track.path)
        if not path.exists():
            raise HTTPException(status_code=410, detail="File no longer exists")
        _backup(path)
        data = await file.read()
        try:
            tagger.write_artwork(path, data, mime)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Failed to write artwork: {exc}")
        track.has_artwork = True
        st = path.stat()
        track.size, track.mtime = st.st_size, st.st_mtime
        session.add(track)
        session.commit()
        session.refresh(track)
        return TrackOut.model_validate(track, from_attributes=True)


stats_router = APIRouter(prefix="/api", tags=["stats"])


def _facets(column, extra_filter=None) -> list[Facet]:
    """Distinct non-empty values of `column` with per-value track counts."""
    with get_session() as session:
        stmt = (
            select(column, func.count())
            .where(col(column).is_not(None), col(column) != "")
            .group_by(column)
            .order_by(func.count().desc())
        )
        if extra_filter is not None:
            stmt = stmt.where(extra_filter)
        rows = session.exec(stmt).all()
    return [Facet(value=value, count=count) for value, count in rows]


@stats_router.get("/artists", response_model=list[Facet])
def list_artists():
    return _facets(Track.artist)


@stats_router.get("/albums", response_model=list[Facet])
def list_albums(artist: str | None = None):
    extra = (col(Track.artist) == artist) if artist else None
    return _facets(Track.album, extra)


@stats_router.get("/genres", response_model=list[Facet])
def list_genres():
    return _facets(Track.genre)


@stats_router.get("/stats", response_model=Stats)
def get_stats():
    with get_session() as session:
        tracks = session.exec(select(func.count()).select_from(Track)).one()
        artists = session.exec(
            select(func.count(func.distinct(Track.artist)))
        ).one()
        albums = session.exec(
            select(func.count(func.distinct(Track.album)))
        ).one()
        with_art = session.exec(
            select(func.count()).select_from(Track).where(col(Track.has_artwork) == True)  # noqa: E712
        ).one()
    return Stats(
        tracks=tracks, artists=artists, albums=albums,
        with_artwork=with_art, music_dirs=[str(d) for d in config.MUSIC_DIRS],
    )

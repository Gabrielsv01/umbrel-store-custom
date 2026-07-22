"""Cross-format tag reading and writing via mutagen.

Two strategies cover every supported format:

* "easy" interface — MP3, MP4/M4A, FLAC, OGG Vorbis, Opus, WMA, WavPack, APE.
  mutagen normalises common tag names (title, artist, ...) across these.
* raw ID3 frames — WAV and AIFF carry an ID3 chunk but have no Easy* wrapper,
  so we read/write ID3 frames directly on the WAVE/AIFF container.

Artwork is always handled per-format since it is not exposed by the easy API.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Optional

from mutagen import File as MutagenFile
from mutagen.aiff import AIFF
from mutagen.flac import FLAC, Picture
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TPE2, TDRC, TCON, TRCK, TPOS
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggvorbis import OggVorbis
from mutagen.oggopus import OggOpus
from mutagen.wave import WAVE

# Editable fields -> "easy" tag key (for Easy* formats).
EASY_FIELDS = {
    "title": "title",
    "artist": "artist",
    "album": "album",
    "albumartist": "albumartist",
    "year": "date",
    "genre": "genre",
    "track_no": "tracknumber",
    "disc_no": "discnumber",
}

# Editable fields -> ID3 frame class (for WAV/AIFF containers).
ID3_FRAMES = {
    "title": TIT2,
    "artist": TPE1,
    "album": TALB,
    "albumartist": TPE2,
    "year": TDRC,
    "genre": TCON,
    "track_no": TRCK,
    "disc_no": TPOS,
}

_ID3_CONTAINERS = (WAVE, AIFF)


def _first(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, list):
        return str(value[0]) if value else None
    return str(value)


# --- Common editable tags --------------------------------------------------

def _read_id3_common(id3: Optional[ID3]) -> dict:
    out = {}
    for field, frame_cls in ID3_FRAMES.items():
        frame = id3.get(frame_cls.__name__) if id3 else None
        out[field] = str(frame.text[0]) if frame and frame.text else None
    return out


def _write_id3_common(id3: ID3, changes: dict) -> None:
    for field, value in changes.items():
        frame_cls = ID3_FRAMES.get(field)
        if frame_cls is None:
            continue
        key = frame_cls.__name__
        if value in (None, ""):
            id3.delall(key)
        else:
            id3.setall(key, [frame_cls(encoding=3, text=[str(value)])])


def read_tags(path: Path) -> dict:
    """Return editable tags + technical info + has_artwork for one file."""
    audio = MutagenFile(str(path), easy=True)
    if audio is None:
        raise ValueError(f"Unsupported or unreadable audio file: {path}")

    if isinstance(audio, _ID3_CONTAINERS):
        tags = _read_id3_common(audio.tags)
    elif audio.tags is not None:
        tags = {f: _first(audio.get(k)) for f, k in EASY_FIELDS.items()}
    else:
        tags = {f: None for f in EASY_FIELDS}

    info = getattr(audio, "info", None)
    tags["duration"] = round(getattr(info, "length", 0.0), 2) if info else None
    tags["bitrate"] = getattr(info, "bitrate", None) if info else None
    tags["format"] = type(audio).__name__.replace("Easy", "")
    tags["has_artwork"] = _has_artwork(path)
    return tags


def write_tags(path: Path, changes: dict) -> None:
    """Write editable-field `changes` back to the file. None/"" clears a tag."""
    audio = MutagenFile(str(path), easy=True)
    if audio is None:
        raise ValueError(f"Unsupported or unreadable audio file: {path}")
    if audio.tags is None:
        audio.add_tags()

    if isinstance(audio, _ID3_CONTAINERS):
        _write_id3_common(audio.tags, changes)
    else:
        for field, value in changes.items():
            key = EASY_FIELDS.get(field)
            if key is None:
                continue
            if value in (None, ""):
                audio.tags.pop(key, None)
            else:
                audio.tags[key] = str(value)
    audio.save()


# --- Artwork ---------------------------------------------------------------

def _has_artwork(path: Path) -> bool:
    try:
        return read_artwork(path) is not None
    except Exception:
        return False


def read_artwork(path: Path) -> Optional[tuple[bytes, str]]:
    """Return (image_bytes, mime_type) for the embedded cover, or None."""
    audio = MutagenFile(str(path))
    if audio is None:
        return None

    if isinstance(audio, MP4):
        covers = audio.tags.get("covr") if audio.tags else None
        if covers:
            cover = covers[0]
            mime = "image/png" if cover.imageformat == MP4Cover.FORMAT_PNG else "image/jpeg"
            return bytes(cover), mime
        return None

    if isinstance(audio, FLAC):
        if audio.pictures:
            pic = audio.pictures[0]
            return pic.data, pic.mime or "image/jpeg"
        return None

    if isinstance(audio, (OggVorbis, OggOpus)):
        b64 = audio.get("metadata_block_picture")
        if b64:
            pic = Picture(base64.b64decode(b64[0]))
            return pic.data, pic.mime or "image/jpeg"
        return None

    # ID3-backed: MP3, WAV, AIFF. Their .tags is an ID3 instance.
    id3 = audio.tags if isinstance(audio.tags, ID3) else None
    if id3 is None:
        return None
    apics = id3.getall("APIC")
    if apics:
        return apics[0].data, apics[0].mime or "image/jpeg"
    return None


def write_artwork(path: Path, image_bytes: bytes, mime: str) -> None:
    """Embed `image_bytes` as the cover, replacing any existing artwork."""
    audio = MutagenFile(str(path))
    if audio is None:
        raise ValueError(f"Unsupported audio file: {path}")

    if isinstance(audio, MP4):
        fmt = MP4Cover.FORMAT_PNG if mime == "image/png" else MP4Cover.FORMAT_JPEG
        audio["covr"] = [MP4Cover(image_bytes, imageformat=fmt)]
        audio.save()
        return

    if isinstance(audio, FLAC):
        audio.clear_pictures()
        pic = Picture()
        pic.type = 3  # front cover
        pic.mime = mime
        pic.data = image_bytes
        audio.add_picture(pic)
        audio.save()
        return

    if isinstance(audio, (OggVorbis, OggOpus)):
        pic = Picture()
        pic.type = 3
        pic.mime = mime
        pic.data = image_bytes
        audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
        audio.save()
        return

    # ID3-backed: MP3, WAV, AIFF. Operate on the container's ID3 tags so the
    # file structure (RIFF/AIFF chunks) stays valid.
    if audio.tags is None:
        audio.add_tags()
    id3 = audio.tags
    id3.delall("APIC")
    id3.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=image_bytes))
    audio.save()

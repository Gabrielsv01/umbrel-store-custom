"""Application configuration, driven by environment variables."""
import os
from pathlib import Path

# Directories that hold the user's music (mounted read-write so we can write
# tags back to the files). MUSIC_DIRS is a comma-separated list and takes
# precedence; MUSIC_DIR is the single-dir fallback for backward compatibility.
def _parse_music_dirs() -> list[Path]:
    raw = os.getenv("MUSIC_DIRS") or os.getenv("MUSIC_DIR", "/music")
    dirs, seen = [], set()
    for part in raw.split(","):
        p = part.strip()
        if p and p not in seen:
            seen.add(p)
            dirs.append(Path(p))
    return dirs


MUSIC_DIRS = _parse_music_dirs()

# Directory for the app's own state (SQLite catalog, backups).
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))

DB_PATH = DATA_DIR / "catalog.db"

# Where the built React frontend lives inside the image (single-container mode).
STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static"))

# HTTP port. Matches the Umbrel manifest.
PORT = int(os.getenv("PORT", "5124"))

# Audio extensions we index. Lower-case, with leading dot.
AUDIO_EXTENSIONS = {
    ".mp3", ".flac", ".m4a", ".mp4", ".aac", ".ogg", ".oga",
    ".opus", ".wav", ".wma", ".aiff", ".aif", ".ape", ".wv",
}

# When True, the first time a file is edited we keep a copy under DATA_DIR/backups.
BACKUP_ON_WRITE = os.getenv("BACKUP_ON_WRITE", "false").lower() == "true"

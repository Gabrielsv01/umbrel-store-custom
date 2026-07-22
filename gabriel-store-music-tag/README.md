# Music Tag

Scan all audio files inside your mapped volumes and edit their metadata — from a
web UI or a REST API. Single Docker container: a FastAPI backend that also serves
the React frontend.

Supports MP3, FLAC, M4A/AAC, OGG Vorbis, Opus, WAV and AIFF (via
[mutagen](https://mutagen.readthedocs.io)). Tag edits are written straight back
to the files.

## Features

- **Incremental scan** of one or more mapped music directories (only re-reads changed files).
- **Browse, search & filter** the catalog (title/artist/album text search, plus dropdown filters for artist/album/genre and an added-date range), sortable, paginated.
- **Edit tags**: title, artist, album, album artist, year, genre, track/disc no.
- **Cover artwork**: view and replace (JPEG/PNG).
- **Bulk edit**: apply changes to many selected tracks at once.
- **REST API** with interactive docs at `/docs`.

## Layout

```
gabriel-store-music-tag/
  umbrel-app.yml        # Umbrel manifest
  docker-compose.yml    # Umbrel deployment (published image)
  icon.svg
  code/
    Dockerfile          # multi-stage: build React -> serve via FastAPI
    backend/            # FastAPI + mutagen + SQLite
    frontend/           # React + Vite + TanStack Query
```

## Configuration (env vars)

| Variable          | Default  | Description                                                        |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `MUSIC_DIRS`      | `/music` | Comma-separated library folders to scan (e.g. `/music,/larissa-music`). Mount each read-write. |
| `DATA_DIR`        | `/data`  | SQLite catalog + optional backups.                                 |
| `PORT`            | `5150`   | HTTP port (UI + API).                                              |
| `BACKUP_ON_WRITE` | `false`  | Keep a one-time backup copy of a file before its first edit.       |

## Run locally

Using the published image:

```bash
docker run -d --name music-tag -p 5150:5150 \
  -e MUSIC_DIRS=/music \
  -v /path/to/your/music:/music \
  -v music-tag-data:/data \
  gabrielsv01/music-tag:1.0.0
# open http://localhost:5150  -- click "Scan library"
```

Or build from source:

```bash
cd code
docker build -t music-tag .
```

## API

Base path `/api`. Full interactive docs at `/docs`.

| Method | Path                       | Description                                            |
| ------ | -------------------------- | ------------------------------------------------------ |
| POST   | `/api/scan`                | Start an incremental scan (background).                |
| GET    | `/api/scan/status`         | Current scan progress.                                 |
| GET    | `/api/tracks`              | List/filter/search (see params below).                 |
| GET    | `/api/tracks/{id}`         | One track.                                             |
| PATCH  | `/api/tracks/{id}`         | Edit tags (send only changed fields; `null` clears).   |
| POST   | `/api/tracks/bulk`         | `{ ids: [], changes: {} }` — edit many at once.        |
| GET    | `/api/tracks/{id}/artwork` | Cover image bytes.                                     |
| PUT    | `/api/tracks/{id}/artwork` | Upload cover (multipart `file`, JPEG/PNG).             |
| GET    | `/api/stats`               | Library counts.                                        |
| GET    | `/api/artists`             | Distinct artists with track counts.                    |
| GET    | `/api/albums`              | Distinct albums (optional `?artist=`).                 |
| GET    | `/api/genres`              | Distinct genres with track counts.                     |

### `GET /api/tracks` parameters

`search`, `artist`, `album`, `genre`, `has_artwork`, `added_from`, `added_to`,
`sort` (`artist|album|title|filename|year|genre|added_at`), `order` (`asc|desc`),
`page`, `page_size` (max 500). Filters combine with AND.

### Filtering by date

`added_from` / `added_to` filter by **when a track was added to the library**
(first seen by a scan — stable across tag edits, unlike the filesystem mtime).
Accepts a date (`2026-07-21`), a full ISO datetime, or a relative window (`1d`,
`24h`, `30m`). A plain date as `added_to` covers the whole day.

```
# tracks added from yesterday through today
GET /api/tracks?added_from=2026-07-21&added_to=2026-07-22
# same thing, relative
GET /api/tracks?added_from=1d
# jazz tracks by a given artist, newest first
GET /api/tracks?genre=Jazz&artist=Miles%20Davis&sort=added_at&order=desc
```

## Publishing the image (for the Umbrel Store)

The Umbrel `docker-compose.yml` references a published multi-arch image
(`linux/amd64` + `linux/arm64`). Build & push both tags:

```bash
cd code
docker buildx build --platform linux/amd64,linux/arm64 \
  -t gabrielsv01/music-tag:1.0.0 -t gabrielsv01/music-tag:latest --push .
```

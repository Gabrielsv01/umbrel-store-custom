# Music Tag

Scan all audio files inside your mapped volumes and edit their metadata — from a
web UI or a REST API. Single Docker container: a FastAPI backend that also serves
the React frontend.

Supports MP3, FLAC, M4A/AAC, OGG Vorbis, Opus, WAV and AIFF (via
[mutagen](https://mutagen.readthedocs.io)). Tag edits are written straight back
to the files.

## Features

- **Incremental scan** of one or more mapped music directories (only re-reads changed files).
- **Browse, search & filter** the catalog (title/artist/album, plus dropdown filters for artist/album/genre and an added-date range), sortable, paginated.
- **Edit tags**: title, artist, album, album artist, year, genre, track/disc no.
- **Cover artwork**: view, replace (JPEG/PNG).
- **Bulk edit**: apply changes to many selected tracks at once.
- **REST API** with interactive docs at \`/docs\`.

## Layout

\`\`\`
gabriel-store-music-tag/
  umbrel-app.yml        # Umbrel manifest
  docker-compose.yml    # Umbrel deployment (published image)
  icon.svg
  code/
    Dockerfile          # multi-stage: build React -> serve via FastAPI
    docker-compose.yml  # local dev / standalone (builds from source)
    backend/            # FastAPI + mutagen + SQLite
    frontend/           # React + Vite + TanStack Query
\`\`\`

## Configuration (env vars)

| Variable          | Default   | Description                                       |
| ----------------- | --------- | ------------------------------------------------- |
| \`MUSIC_DIR\`       | \`/music\`  | Library folder (mount read-write to save tags).   |
| \`DATA_DIR\`        | \`/data\`   | SQLite catalog + optional backups.                |
| \`PORT\`            | \`5124\`    | HTTP port (UI + API).                             |
| \`BACKUP_ON_WRITE\` | \`false\`   | Keep a one-time backup copy before first edit.    |

## Run locally

\`\`\`bash
cd code
MUSIC_HOST_DIR=/path/to/your/music docker compose up --build
# open http://localhost:5124  -- click "Scan library"
\`\`\`

## API

Base path \`/api\`. Full interactive docs at \`/docs\`.

| Method | Path                        | Description                          |
| ------ | --------------------------- | ------------------------------------ |
| POST   | \`/api/scan\`                 | Start an incremental scan (background). |
| GET    | \`/api/scan/status\`          | Current scan progress.               |
| GET    | \`/api/tracks\`               | List/search (search, sort, order, page, page_size). |
| GET    | \`/api/tracks/{id}\`          | One track.                           |
| PATCH  | \`/api/tracks/{id}\`          | Edit tags (send only changed fields; null clears). |
| POST   | \`/api/tracks/bulk\`          | { ids: [], changes: {} } -- edit many. |
| GET    | \`/api/tracks/{id}/artwork\`  | Cover image bytes.                   |
| PUT    | \`/api/tracks/{id}/artwork\`  | Upload cover (multipart file, JPEG/PNG). |
| GET    | \`/api/stats\`                | Library counts.                      |

## Publishing the image (for the Umbrel Store)

The Umbrel \`docker-compose.yml\` references a published image. Build & push:

\`\`\`bash
cd code
docker build -t gabrielsv01/music-tag:1.0.0 .
docker push gabrielsv01/music-tag:1.0.0
\`\`\`

# Bluetooth API Manager

A single-container manager for the Bluetooth adapter on your Umbrel host. It
discovers devices, lets you watch the data they transmit, and exposes a REST +
WebSocket API so other systems can drive the adapter.

## Status

| Phase | Scope | State |
|-------|-------|-------|
| 0 | Skeleton: Docker/Umbrel manifests, FastAPI serving the React UI | ✅ done |
| 1 | BLE core: device discovery, live GATT data, REST + WebSocket API, web UI | ✅ done |
| 2 | Audio streaming over A2DP (file upload + URL) | ✅ done |
| 3 | File transfer over OBEX Object Push | ✅ done |
| 4 | Observability: levels, `/api/stats`, adapter info, status bar, Logs tools | ✅ done |

## Architecture

One container, front and back separated in code (KISS deploy, DRY logic):

- **backend/** — FastAPI. `adapters/bluetooth.py` is the single Bluetooth layer
  (built on `bleak`, which talks to the host's BlueZ over D-Bus). `core/events.py`
  is one event bus that feeds both the WebSocket and the Logs view.
- **frontend/** — React + Vite. Built in a Docker stage and served as static
  files by FastAPI. Tabs: Devices, Live Data, Logs.

The web UI and any external caller use the **same** REST API. Interactive docs
are at `/docs`.

## Host requirements

Bluetooth lives on the host, not in the container, so this app needs:

- A working Bluetooth adapter and the **BlueZ** stack (`bluetoothd`) on the host.
- `network_mode: host` and the system D-Bus socket (both set in
  `docker-compose.yml`).
- `privileged: true` for HCI scanning / A2DP.

> Audio streaming (Phase 2) additionally needs an audio server (PulseAudio/
> PipeWire) on the host — many headless Umbrel installs don't have one, so treat
> it as best-effort.

## Key API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/devices` | List discovered/connected devices (name, RSSI, …) |
| POST | `/api/devices/{addr}/connect` | Connect to a device |
| GET | `/api/devices/{addr}/services` | List GATT services & characteristics |
| POST | `/api/devices/{addr}/read` | Read a characteristic |
| POST | `/api/devices/{addr}/write` | Write a characteristic (`hex` or `text`) |
| POST | `/api/devices/{addr}/notify` | Enable/disable notifications |
| GET | `/api/audio/sinks` | List audio output sinks (Bluetooth ones flagged) |
| POST | `/api/audio/play` | Play an uploaded file **or** a `url` to a sink |
| POST | `/api/audio/stop` | Stop playback |
| POST | `/api/files/send` | Send a file to a device over OBEX (multipart) |
| GET | `/api/stats` | Observability snapshot: adapter, counts, audio, event stats |
| WS | `/ws` | Live event stream (devices, GATT data, logs) |

### Audio & file transfer (Phases 2–3) — host notes

- **Audio (A2DP):** the Bluetooth speaker must be exposed as a PulseAudio sink
  by an audio server **on the host**. Mount the Pulse socket and set
  `PULSE_SERVER` (see the commented lines in `docker-compose.yml`). Without a
  host audio server, `/api/audio/sinks` returns an error (shown in the UI).
- **File transfer (OBEX):** the container starts its own session D-Bus + `obexd`
  (`entrypoint.sh`). The target device must be **paired** and accept incoming
  files (Object Push).

## Local development

```bash
# Backend (needs a Linux host with BlueZ for real Bluetooth)
cd code/backend
pip install -r requirements.txt
PORT=5157 STATIC_DIR= python -m uvicorn backend.main:app --reload --port 5157
#   run from the code/ dir so `backend` is importable:  cd code && uvicorn backend.main:app --reload

# Frontend (proxies /api and /ws to the backend)
cd code/frontend
npm install
npm run dev
```

## Build & run the container

```bash
cd code
docker build -t gabrielsv01/bluetooth-api-manager:1.0.0 .
# or just: docker compose up --build   (from the app root)
```

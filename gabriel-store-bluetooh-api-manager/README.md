# Bluetooth API Manager

A self-contained manager for the Bluetooth adapter on your Umbrel host. It
discovers devices, lets you watch the data they transmit, and exposes a REST +
WebSocket API so other systems can drive the adapter. It also supports
Bluetooth Classic pairing, A2DP playback, OBEX file transfer and Piper text to
speech.

## Status

| Phase | Scope | State |
|-------|-------|-------|
| 0 | Skeleton: Docker/Umbrel manifests, FastAPI serving the React UI | ✅ done |
| 1 | BLE core: device discovery, live GATT data, REST + WebSocket API, web UI | ✅ done |
| 2 | Audio streaming over A2DP (file upload + URL) | ✅ done |
| 3 | File transfer over OBEX Object Push | ✅ done |
| 4 | Observability: levels, `/api/stats`, adapter info, status bar, Logs tools | ✅ done |

## Architecture

The app uses two containers and a private Bluetooth stack. The main container
owns the adapter and starts its own system D-Bus, `bluetoothd`, `bluez-alsa` and
`obexd`; the Piper container provides text-to-speech generation.

Front and back remain separated in code (KISS deploy, DRY logic):

- **backend/** — FastAPI. `adapters/bluetooth.py` is the single Bluetooth layer
  (built on `bleak`, which talks to the container's BlueZ over its private
  system D-Bus). `core/events.py` is one event bus that feeds both the WebSocket
  and the Logs view.
- **frontend/** — React + Vite. Built in a Docker stage and served as static
  files by FastAPI. Tabs: Devices, Live Data, Logs.
- **piper/** — HTTP TTS worker using Piper and a persisted voice model.

The web UI and any external caller use the **same** REST API. Interactive docs
are at `/docs`.

## Host requirements

The container owns the Bluetooth adapter, so the host needs:

- A working USB or built-in Bluetooth adapter visible to the container.
- `network_mode: host` and `privileged: true` (already configured in
  `docker-compose.yml`).
- The host's Bluetooth service disabled to avoid competing with the container's
  `bluetoothd`:

  ```bash
  sudo systemctl disable --now bluetooth
  ```

The app does not require the host's system D-Bus, PulseAudio or PipeWire. The
container provides its own D-Bus and bluez-alsa audio path. Audio playback is
best-effort and requires a paired A2DP speaker/headset.

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

### Audio, file transfer & text to speech

- **Audio (A2DP):** the container connects to the paired speaker with
  `bluetoothctl`, decodes the source with `ffmpeg` and streams it through its
  own bluez-alsa PCM. No host audio server or PulseAudio socket is required.
  After a successful play, the last-used speaker is checked periodically and
  reconnected when idle. The interval defaults to 20 seconds and can be
  disabled with `AUDIO_KEEPALIVE_INTERVAL=0`.
- **File transfer (OBEX):** the container starts its own session D-Bus and
  `obexd` (`entrypoint.sh`). The target device must be paired and accept
  incoming files through Object Push.
- **Text to speech:** the `piper` service downloads and persists the configured
  voice model in the app data directory. The main service calls it over
  `http://127.0.0.1:5158`.

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

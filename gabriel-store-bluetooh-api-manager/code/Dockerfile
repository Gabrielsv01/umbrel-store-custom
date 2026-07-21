# ---------- Stage 1: build the React frontend ----------
FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: python runtime ----------
FROM python:3.12-slim AS runtime

# System deps:
#  - bluez / bluez-tools: bluetoothctl, obexctl (Classic pairing, OBEX file push)
#  - dbus: talk to the host's bluetoothd over the system bus
#  - ffmpeg: decode/transcode audio for A2DP streaming
#  - pulseaudio-utils: route audio to a host PulseAudio server (best-effort)
RUN apt-get update && apt-get install -y --no-install-recommends \
        bluez \
        bluez-tools \
        bluez-obexd \
        bluez-alsa-utils \
        alsa-utils \
        dbus \
        dbus-x11 \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Static frontend built in stage 1, served by FastAPI.
COPY --from=frontend /frontend/dist ./frontend_dist

ENV PORT=5157 \
    STATIC_DIR=/app/frontend_dist \
    DATA_DIR=/data \
    PYTHONUNBUFFERED=1

RUN mkdir -p /data
EXPOSE 5157

CMD ["./entrypoint.sh"]

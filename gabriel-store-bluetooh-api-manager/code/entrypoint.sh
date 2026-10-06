#!/usr/bin/env bash
set -e

# Shares the HOST's Bluetooth stack (Option A) instead of running a private one.
#
# The host's bluetoothd owns the adapter and its D-Bus system bus is bind-mounted
# into the container at /run/dbus (see docker-compose.yml), so bluetoothctl and
# dbus_fast/bleak here talk to that same bus (both fall back to the standard
# /var/run/dbus/system_bus_socket path when DBUS_SYSTEM_BUS_ADDRESS is unset — we
# deliberately do NOT set it, nor start our own dbus-daemon/bluetoothd).
#
# bluez-alsa still runs IN the container (the host normally doesn't have it) and
# registers its A2DP endpoint against the host's bluetoothd over that shared bus.
# OBEX keeps its own private session bus below — unrelated to the system bus.
DATA_DIR="${DATA_DIR:-/data}"

# supervise <name> <cmd...> — keep a daemon alive, backing off on repeated exits.
supervise() {
  local name="$1"; shift
  (
    local n=0
    while [ "$n" -lt 1000 ]; do
      "$@" || true
      n=$((n + 1))
      sleep 5
    done
  ) &
}

first_exec() {  # echo the first existing executable from the arguments
  for p in "$@"; do [ -x "$p" ] && { echo "$p"; return 0; }; done
  command -v "$(basename "$1")" 2>/dev/null || true
}

mkdir -p "$DATA_DIR/received"

# --- install the org.bluealsa D-Bus policy onto the HOST, if missing/stale -----
# The host has no bluez-alsa package, so it ships no policy allowing anyone to
# own `org.bluealsa` on its system bus — without this, bluealsad's startup fails
# with "Couldn't acquire D-Bus name" and crash-loops forever. /etc/dbus-1/system.d
# is bind-mounted from the host (see docker-compose.yml), so writing here lands
# on the host's real filesystem. ReloadConfig makes the already-running host
# dbus-daemon pick it up immediately, with no service restart needed.
POLICY_SRC=/opt/bluealsa-dbus-policy.conf
POLICY_DST=/etc/dbus-1/system.d/org.bluealsa.conf
if [ -f "$POLICY_SRC" ] && ! cmp -s "$POLICY_SRC" "$POLICY_DST" 2>/dev/null; then
  cp "$POLICY_SRC" "$POLICY_DST"
  dbus-send --system --type=method_call --dest=org.freedesktop.DBus \
    / org.freedesktop.DBus.ReloadConfig >/dev/null 2>&1 || true
fi

# Power the adapter on once the host's bluetoothd/hci0 shows up (best-effort, non-blocking).
(
  for _ in $(seq 1 30); do
    if bluetoothctl show >/dev/null 2>&1; then
      bluetoothctl power on >/dev/null 2>&1 || true
      bluetoothctl --timeout 1 scan on >/dev/null 2>&1 || true
      break
    fi
    sleep 2
  done
) &

# --- bluez-alsa A2DP source (audio to speakers) -------------------------
BLUEALSAD="$(first_exec /usr/bin/bluealsad /usr/sbin/bluealsad /usr/bin/bluealsa /usr/sbin/bluealsa)"
[ -n "$BLUEALSAD" ] && supervise bluealsad "$BLUEALSAD" -p a2dp-source

# --- session bus + obexd (file transfer) --------------------------------
if command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)"
  export DBUS_SESSION_BUS_ADDRESS
  OBEXD="$(first_exec /usr/libexec/bluetooth/obexd /usr/lib/bluetooth/obexd)"
  [ -n "$OBEXD" ] && supervise obexd "$OBEXD" -n -p bluetooth,opp,ftp -r "$DATA_DIR/received"
fi

exec python -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-5157}"

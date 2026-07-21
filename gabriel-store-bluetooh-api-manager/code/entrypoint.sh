#!/usr/bin/env bash
set -e

# Self-contained Bluetooth + audio stack (Option B).
#
# Instead of talking to the host's bluetoothd, we run our OWN private stack
# inside the container so that bluez-alsa (which must own the `org.bluealsa`
# name on the system bus) works with our own D-Bus policy. This makes the app
# fully isolated — but it means the container owns the Bluetooth adapter, so the
# host's own bluetooth service must be disabled (systemctl disable --now bluetooth).
#
# Everything (BLE via bleak, OBEX, and A2DP audio) uses the private system bus.
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

# --- private system bus -------------------------------------------------
mkdir -p /run/dbus "$DATA_DIR/received"
dbus-uuidgen --ensure=/etc/machine-id 2>/dev/null || true
dbus-daemon --system --fork
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"

# --- bluetoothd (owns the adapter) --------------------------------------
BLUETOOTHD="$(first_exec /usr/libexec/bluetooth/bluetoothd /usr/lib/bluetooth/bluetoothd)"
[ -n "$BLUETOOTHD" ] && supervise bluetoothd "$BLUETOOTHD" --nodetach --experimental

# Power the adapter on once bluetoothd/hci0 shows up (best-effort, non-blocking).
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

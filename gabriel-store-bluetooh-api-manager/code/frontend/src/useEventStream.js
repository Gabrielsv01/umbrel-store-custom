import { useEffect, useRef, useState } from "react";

// Connects to the backend WebSocket and keeps the latest state derived from the
// event stream: a map of devices, a rolling log, and live GATT data readings.
export function useEventStream() {
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState({});
  const [log, setLog] = useState([]);
  const [gattData, setGattData] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    let closed = false;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) setTimeout(connect, 2000); // auto-reconnect
      };
      ws.onmessage = (msg) => {
        const event = JSON.parse(msg.data);
        // Keep high-frequency telemetry out of the log: device_update (once per
        // second per device) and gatt_data have dedicated views (Devices / Live
        // Data), and would otherwise flood the log and evict the audio/error
        // events we actually investigate.
        if (event.type !== "device_update" && event.type !== "gatt_data") {
          setLog((prev) => [...prev.slice(-499), event]);
        }

        switch (event.type) {
          case "device_update":
            setDevices((prev) => ({
              ...prev,
              [event.data.device.address]: event.data.device,
            }));
            break;
          case "device_connected":
          case "device_disconnected":
            setDevices((prev) => {
              const d = prev[event.data.address];
              if (!d) return prev;
              return {
                ...prev,
                [event.data.address]: {
                  ...d,
                  connected: event.type === "device_connected",
                },
              };
            });
            break;
          case "gatt_data":
            setGattData((prev) => [
              { ...event.data, ts: event.ts },
              ...prev.slice(0, 199),
            ]);
            break;
          default:
            break;
        }
      };
    }

    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  // Drop devices not seen in a while (and not connected) — BLE devices using
  // Resolvable Private Addresses (RPAs), like phones or Echo/Alexa speakers,
  // rotate their address periodically; without this, every rotation leaves a
  // permanent "ghost" entry under its old address and the list fills up with
  // duplicates of the same physical device. Matches the backend's own
  // STALE_DEVICE_SECONDS (adapters/bluetooth.py).
  useEffect(() => {
    const STALE_SECONDS = 120;
    const prune = () => {
      const now = Date.now() / 1000;
      setDevices((prev) => {
        let changed = false;
        const next = {};
        for (const [addr, d] of Object.entries(prev)) {
          if (d.connected || now - d.last_seen < STALE_SECONDS) {
            next[addr] = d;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    const t = setInterval(prune, 15000);
    return () => clearInterval(t);
  }, []);

  return { connected, devices, log, gattData };
}

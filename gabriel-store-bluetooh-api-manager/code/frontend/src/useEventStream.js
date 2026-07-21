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
        setLog((prev) => [...prev.slice(-499), event]);

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

  return { connected, devices, log, gattData };
}
